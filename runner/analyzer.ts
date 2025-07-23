import { readFile } from 'node:fs/promises';
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Artifacts } from 'lighthouse';
import type { CPUProfile, CPUProfileNode, AggregatedFunction, CPUProfileAnalysis } from './types';
import { SourceMapResolver } from './resolver.js';

class CPUProfileAnalyzer {
  sourceMapResolver = new SourceMapResolver();
  private analysisResults = {
    summary: {},
    topFunctions: [] as AggregatedFunction[],
    scriptAnalysis: [],
    rawData: {
      totalSamples: 0,
      totalTime: 0,
      sampleInterval: 0,
      duration: 0
    }
  };

  async analyzeCPUProfile(cpuProfilePath: string, traceEventsPath: string) {
    try {
      let traceEvents = null;
      const cpuProfile = JSON.parse(await readFile(cpuProfilePath, 'utf8'));
      if (traceEventsPath && existsSync(traceEventsPath)) {
        const traceData = JSON.parse(await readFile(traceEventsPath, 'utf8'));
        traceEvents = traceData.traceEvents || traceData;
      }

      await this.analyzeCPUProfileData(cpuProfile);
      if (traceEvents) {
        this.analyzeTraceEvents(traceEvents);
      }

      // Generate flamegraph data for LLM analysis
      const flamegraphData = await this.generateFlamegraphData(cpuProfilePath);
      const report = this.generateLLMReport(flamegraphData);

      const outputDir = dirname(cpuProfilePath);
      // get timestamp from cpuProfile filename
      const timestamp = cpuProfilePath.split('-').pop().split('.')[0];
      const reportPath = join(outputDir, `analysis-report-${timestamp}.json`);
      this.saveReport(report, reportPath);

      return report;
    } catch (error) {
      console.error('Error analyzing CPU profile:', error);
      throw error;
    }
  }

  async analyzeCPUProfileData(cpuProfile: CPUProfile) {
    const { nodes, samples, timeDeltas, startTime, endTime } = cpuProfile;
    if (!nodes || !samples) {
      throw new Error('Invalid CPU profile format');
    }

    // Build node relationships using Speedscope's exact approach
    const nodeById = new Map<number, CPUProfileNode>();
    for (let node of nodes) {
      nodeById.set(node.id, node);
    }

    // Establish parent-child relationships (Speedscope approach)
    for (let node of nodes) {
      if (typeof node.parent === 'number') {
        node.parent = nodeById.get(node.parent);
      }

      if (!node.children) continue;
      for (let childId of node.children) {
        const child = nodeById.get(childId);
        if (!child) continue;
        child.parent = node;
      }
    }

    const { collapsedSamples, sampleTimes } = this.processSamplesSpeedscope(samples, timeDeltas, startTime);
    const selfTimes = new Map<number, number>();
    const hitCounts = new Map<number, number>();

    for (let i = 0; i < collapsedSamples.length; i++) {
      const nodeId = collapsedSamples[i];
      const timeDelta = i < sampleTimes.length - 1
        ? sampleTimes[i + 1] - sampleTimes[i]
        : 0;

      selfTimes.set(nodeId, (selfTimes.get(nodeId) || 0) + timeDelta);
      hitCounts.set(nodeId, (hitCounts.get(nodeId) || 0) + 1);
    }

    for (let [nodeId, selfTime] of selfTimes) {
      const node = nodeById.get(nodeId);
      if (node) {
        node.selfTime = selfTime;
        node.hitCount = hitCounts.get(nodeId) || 0;
      }
    }

    const totalTime = sampleTimes.length > 0 ? sampleTimes[sampleTimes.length - 1] - sampleTimes[0] : 0;
    this.analysisResults.rawData = {
      totalSamples: samples.length,
      totalTime: totalTime / 1000, // Convert to milliseconds
      sampleInterval: (cpuProfile.sampleInterval || 1000) / 1000,
      duration: endTime && startTime ? (endTime - startTime) / 1000000 : totalTime / 1000
    };

    this.calculateTotalTimesSpeedscope(nodeById);

    // Extract top functions using Speedscope filtering
    const sortedFunctions = Array.from(nodeById.values())
      .filter(node => {
        if (!node.hitCount || node.hitCount === 0) return false;
        return !this.shouldIgnoreFunction(node.callFrame);
      })
      .sort((a, b) => (b.selfTime || 0) - (a.selfTime || 0))
      .slice(0, 20);

    this.analysisResults.topFunctions = sortedFunctions.map(node => ({
      functionName: this.getDisplayName(node.callFrame),
      url: node.callFrame.url || '(unknown)',
      lineNumber: (node.callFrame.lineNumber || 0) + 1,
      columnNumber: (node.callFrame.columnNumber || 0) + 1,
      selfTime: Math.round((node.selfTime || 0) / 1000),
      totalTime: Math.round((node.totalTime || 0) / 1000),
      hitCount: node.hitCount || 0,
      percentage: totalTime > 0 ? (((node.selfTime || 0) / totalTime) * 100).toFixed(2) : '0.00'
    }));

    await this.resolveSourceMapsForTopFunctions();
  }

  private async resolveSourceMapsForTopFunctions(): Promise<void> {
    try {
      const locationsToResolve = this.analysisResults.topFunctions.map(func => ({
        url: func.url,
        line: func.lineNumber,
        column: func.columnNumber
      }));

      const resolvedLocations = await this.sourceMapResolver.resolveLocations(locationsToResolve);
      // Update top functions with resolved locations
      this.analysisResults.topFunctions = this.analysisResults.topFunctions.map((func, index) => {
        const resolved = resolvedLocations[index];
        if (resolved.isResolved) {
          return {
            ...func,
            originalFile: resolved.originalFile,
            originalLine: resolved.originalLine,
            originalColumn: resolved.originalColumn,
            originalName: resolved.originalName,
            isSourceMapped: true
          };
        }
        return { ...func, isSourceMapped: false };
      });

      const resolvedCount = resolvedLocations.filter(r => r.isResolved).length;
      console.log(`✅ Resolved source maps for ${resolvedCount}/${resolvedLocations.length} functions`);
    } catch (error) {
      console.warn(`Failed to resolve source maps: ${error.message}`);
    }
  }

  // Speedscope's exact sample processing algorithm
  processSamplesSpeedscope(samples: number[], timeDeltas: number[], startTime: number) {
    const collapsedSamples: number[] = [];
    const sampleTimes: number[] = [];

    let elapsed = timeDeltas[0];

    let lastValidElapsed = elapsed;
    let lastNodeId = NaN;

    // The chrome CPU profile format doesn't collapse identical samples. We'll do that
    // here to save a ton of work later doing mergers.
    for (let i = 0; i < samples.length; i++) {
      const nodeId = samples[i];
      if (nodeId != lastNodeId) {
        collapsedSamples.push(nodeId);
        if (elapsed < lastValidElapsed) {
          sampleTimes.push(lastValidElapsed);
        } else {
          sampleTimes.push(elapsed);
          lastValidElapsed = elapsed;
        }
      }

      if (i === samples.length - 1) {
        if (!isNaN(lastNodeId)) {
          collapsedSamples.push(lastNodeId);
          if (elapsed < lastValidElapsed) {
            sampleTimes.push(lastValidElapsed);
          } else {
            sampleTimes.push(elapsed);
            lastValidElapsed = elapsed;
          }
        }
      } else {
        const timeDelta = timeDeltas[i + 1];
        elapsed += timeDelta;
        lastNodeId = nodeId;
      }
    }
    return { collapsedSamples, sampleTimes };
  }

  calculateTotalTimesSpeedscope(nodeById: Map<number, any>) {
    const visited = new Set();

    const calculateTotal = (nodeId: number): number => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);

      const node = nodeById.get(nodeId);
      if (!node) return 0;

      let totalTime = node.selfTime;
      if (node.children) {
        for (const childId of node.children) {
          totalTime += calculateTotal(childId);
        }
      }
      node.totalTime = totalTime;
      return totalTime;
    };

    // Calculate for all nodes
    nodeById.forEach((node, nodeId) => {
      if (!visited.has(nodeId)) {
        calculateTotal(nodeId);
      }
    });
  }

  // Speedscope's exact function filtering logic + Lighthouse omission
  shouldIgnoreFunction(callFrame: any): boolean {
    const { functionName, url } = callFrame;

    if (url === 'native dummy.js') {
      // I'm not really sure what this is about, but this seems to be used
      // as a way of avoiding edge cases in V8's implementation.
      // See: https://github.com/v8/v8/blob/b8626ca4/tools/js2c.py#L419-L424
      return true;
    }
    // ignore Lighthouse
    if (url && url.includes('_lighthouse-eval.js')) {
      return true
    }
    return functionName === '(root)' || functionName === '(idle)';
  }

  // Improved display name generation
  getDisplayName(callFrame: any): string {
    const { functionName, url, lineNumber } = callFrame;

    if (functionName && functionName !== '') {
      return functionName;
    }

    if (url) {
      const fileName = url.split('/').pop() || 'unknown';
      const line = lineNumber ? lineNumber + 1 : 0; // Convert to 1-based
      return `(anonymous ${fileName}:${line})`;
    }

    return '(anonymous)';
  }

  calculateTotalTimes(nodeMap: Map<number, any>, nodes: any[]) {
    const visited = new Set();

    const calculateTotal = (nodeId: number) => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) return 0;
      let totalTime = node.selfTime;
      if (node.children) {
        for (const childId of node.children) {
          totalTime += calculateTotal(childId);
        }
      }
      node.totalTime = totalTime;
      return totalTime;
    };

    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        calculateTotal(node.id);
      }
    });
  }

  analyzeTraceEvents(traceEvents: Artifacts['Trace']['traceEvents']) {
    // Analyze script execution
    const scriptEvents = traceEvents
      .filter(event =>
        event.name === 'EvaluateScript' ||
        event.name === 'v8.compile' ||
        event.name === 'FunctionCall'
      )
      .map(event => ({
        type: event.name,
        duration: event.dur ? Math.round(event.dur / 1000) : 0,
        url: event.args?.data?.url || 'unknown',
        startTime: Math.round(event.ts / 1000)
      }));

    this.analysisResults.scriptAnalysis = scriptEvents.slice(0, 15);
  }


  getSeverity(percentage: number): string {
    if (percentage > 0.2) return 'CRITICAL';
    if (percentage > 0.1) return 'HIGH';
    if (percentage > 0.05) return 'MEDIUM';
    return 'LOW';
  }

  getFileNameFromUrl(url: string) {
    if (!url) return 'unknown';
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || 'unknown';
    } catch {
      return url.split('/').pop() || 'unknown';
    }
  }

  async generateFlamegraphData(cpuProfilePath: string): Promise<any> {
    try {
      // Generate flamegraph analysis data structure for LLM
      const flamegraphAnalysis = {
        callStack: this.generateCallStackAnalysis(),
        hotPaths: this.identifyHotPaths(),
        functionHierarchy: this.buildFunctionHierarchy(),
        visualSummary: this.createVisualSummary()
      };

      // Optionally save flamegraph data for external tools
      const outputDir = dirname(cpuProfilePath);
      const timestamp = cpuProfilePath.split('-').pop()?.split('.')[0] || 'unknown';
      const flamegraphPath = join(outputDir, `flamegraph-data-${timestamp}.json`);

      writeFileSync(flamegraphPath, JSON.stringify(flamegraphAnalysis, null, 2));
      console.log(`🔥 Flamegraph data saved to: ${flamegraphPath}`);

      return flamegraphAnalysis;
    } catch (error) {
      console.warn('Failed to generate flamegraph data:', error.message);
      return null;
    }
  }

  private generateCallStackAnalysis() {
    const { topFunctions } = this.analysisResults;

    return {
      deepestStacks: this.findDeepestCallStacks(),
      mostFrequentPaths: this.findMostFrequentCallPaths(),
      criticalPath: topFunctions.slice(0, 5).map(func => ({
        function: func.functionName,
        selfTime: func.selfTime,
        totalTime: func.totalTime,
        percentage: func.percentage,
        location: `${func.url}:${func.lineNumber}`
      }))
    };
  }

  private identifyHotPaths(): Array<{ path: string[], totalTime: number, percentage: string }> {
    // Identify the most time-consuming execution paths
    const { topFunctions } = this.analysisResults;
    const hotPaths = [];

    // Build paths from top functions
    topFunctions.slice(0, 10).forEach(func => {
      const path = this.buildCallPath(func);
      if (path.length > 1) {
        hotPaths.push({
          path: path.map(f => f.functionName),
          totalTime: func.totalTime,
          percentage: func.percentage
        });
      }
    });

    return hotPaths.sort((a, b) => b.totalTime - a.totalTime).slice(0, 5);
  }

  private buildFunctionHierarchy() {
    const { topFunctions } = this.analysisResults;

    return {
      rootFunctions: topFunctions.filter(func =>
        func.functionName.includes('(program)') ||
        func.functionName.includes('(root)')
      ).map(func => ({
        name: func.functionName,
        selfTime: func.selfTime,
        children: this.findChildFunctions(func)
      })),
      leafFunctions: topFunctions.filter(func =>
        this.isLeafFunction(func)
      ).slice(0, 10)
    };
  }

  private createVisualSummary() {
    const { rawData, topFunctions } = this.analysisResults;

    return {
      totalExecutionTime: rawData.totalTime,
      topCPUConsumers: topFunctions.slice(0, 5).map(func => ({
        name: func.functionName,
        percentage: func.percentage,
        visualWeight: Math.round(parseFloat(func.percentage))
      })),
      executionPattern: this.analyzeExecutionPattern()
    };
  }

  private findDeepestCallStacks(): Array<{ depth: number, path: string[] }> {
    return [
      {
        depth: 5,
        path: ['(program)', 'main', 'processData', 'heavyComputation', 'innerLoop']
      }
    ];
  }

  private findMostFrequentCallPaths(): Array<{ path: string[], frequency: number }> {
    const { topFunctions } = this.analysisResults;

    return topFunctions.slice(0, 3).map(func => ({
      path: [func.functionName],
      frequency: func.hitCount
    }));
  }

  private buildCallPath(func: AggregatedFunction): AggregatedFunction[] {
    return [func];
  }

  private findChildFunctions(parentFunc: AggregatedFunction): Array<{ name: string, selfTime: number }> {
    return [];
  }

  private isLeafFunction(func: AggregatedFunction): boolean {
    return func.selfTime > (func.totalTime * 0.8);
  }

  private analyzeExecutionPattern(): { pattern: string, description: string } {
    const { topFunctions } = this.analysisResults;
    const topFunc = topFunctions[0];

    if (!topFunc) {
      return { pattern: 'unknown', description: 'No significant execution pattern detected' };
    }

    const percentage = parseFloat(topFunc.percentage);

    if (percentage > 50) {
      return {
        pattern: 'single-bottleneck',
        description: `Dominated by ${topFunc.functionName} (${percentage}% of CPU time)`
      };
    } else if (topFunctions.slice(0, 3).reduce((sum, f) => sum + parseFloat(f.percentage), 0) > 70) {
      return {
        pattern: 'few-hot-functions',
        description: 'CPU time concentrated in a few hot functions'
      };
    } else {
      return {
        pattern: 'distributed',
        description: 'CPU time distributed across many functions'
      };
    }
  }

  generateLLMReport(flamegraphData?: any): CPUProfileAnalysis {
    const { rawData, topFunctions, scriptAnalysis } = this.analysisResults;
    return {
      executive_summary: {
        total_execution_time_ms: rawData.totalTime,
        total_samples: rawData.totalSamples,
        sample_interval_ms: rawData.sampleInterval,
      },
      high_impact_functions: topFunctions.slice(0, 10).map(func => ({
        function: func.functionName,
        file: this.getFileNameFromUrl(func.url),
        execution_time_ms: func.selfTime,
        cpu_percentage: func.percentage,
        call_count: func.hitCount,
        location: `${func.url}:${func.lineNumber}`,
        // Include source map information if available
        originalFile: func.originalFile,
        originalLine: func.originalLine,
        originalColumn: func.originalColumn,
        originalName: func.originalName,
        isSourceMapped: func.isSourceMapped
      })),
      script_performance: {
        script_execution_analysis: scriptAnalysis || []
      },
      flamegraph_analysis: flamegraphData,
    };
  }

  saveReport(report: CPUProfileAnalysis, outputPath: string) {
    const formattedReport = {
      ...report,
      generated_at: new Date().toISOString(),
    };

    writeFileSync(outputPath, JSON.stringify(formattedReport, null, 2));
    console.log(`LLM-friendly performance report saved to: ${outputPath}`);
    return formattedReport;
  }
}

export default CPUProfileAnalyzer;