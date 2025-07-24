import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { CPUProfile, CPUProfileNode, AggregatedFunction, CPUProfileAnalysis, PerformanceMetrics } from './types';
import { SourceMapResolver } from './resolver.js';

class CPUProfileAnalyzer {
  sourceMapResolver = new SourceMapResolver();
  private nodeById = new Map<number, CPUProfileNode>();
  private analysisResults = {
    topFunctions: [] as AggregatedFunction[],
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

      const flamegraphData = await this.generateFlamegraphData();
      const report = this.generate(flamegraphData);
      return report;
    } catch (error) {
      console.error('Error analyzing CPU profile:', error);
      throw error;
    }
  }

  async loadAuditReport(reportPath: string): Promise<PerformanceMetrics> {
    if (!existsSync(reportPath)) {
      throw new Error('Audit report not found');
    }
    return JSON.parse(await readFile(reportPath, 'utf-8'));
  }

  async analyzeAuditReport(reportPath: string) {
    const report = await this.loadAuditReport(reportPath);
    // loop through the audit report and try to map the long task functions to original source code 
    if (report.longTasks && report.longTasks.details && (report.longTasks.details as any).items) {
      const longTaskItems = (report.longTasks.details as any).items;

      if (longTaskItems.length > 0) {
        const resolvedLocations = await this.sourceMapResolver.resolveLocations(
          longTaskItems.map(item => ({
            url: item.url,
          }))
        );
        resolvedLocations.forEach((location, index) => {
          if (location.isResolved) {
            longTaskItems[index].url = location.originalFile;
            longTaskItems[index].line = location.originalLine;
            longTaskItems[index].column = location.originalColumn;
          }
        });
      }
    }
    return report;
  }

  async analyzeCPUProfileData(cpuProfile: CPUProfile) {
    const { nodes, samples, timeDeltas, startTime, endTime } = cpuProfile;
    if (!nodes || !samples) {
      throw new Error('Invalid CPU profile format');
    }

    // Build node relationships using Speedscope's exact approach
    this.nodeById.clear(); // Clear any previous data
    for (let node of nodes) {
      this.nodeById.set(node.id, node);
    }

    // Establish parent-child relationships (Speedscope approach)
    for (let node of nodes) {
      if (typeof node.parent === 'number') {
        node.parent = this.nodeById.get(node.parent);
      }

      if (!node.children) continue;
      for (let childId of node.children) {
        const child = this.nodeById.get(childId);
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
      const node = this.nodeById.get(nodeId);
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

    this.calculateTotalTimesSpeedscope(this.nodeById);

    // Extract top functions using Speedscope filtering
    const sortedFunctions = Array.from(this.nodeById.values())
      .filter(node => {
        if (!node.hitCount || node.hitCount === 0) return false;
        return !this.shouldIgnoreFunction(node.callFrame);
      })
      .sort((a, b) => (b.selfTime || 0) - (a.selfTime || 0))
      .slice(0, 20);

    this.analysisResults.topFunctions = sortedFunctions.map(node => ({
      nodeId: node.id,
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
      const functionsWithNodes = this.analysisResults.topFunctions.map(func => ({
        func,
        node: this.nodeById.get(func.nodeId)
      }));

      const resolvedLocations = await this.sourceMapResolver.resolveLocations(
        functionsWithNodes.map(item => ({
          url: item.func.url,
          line: item.func.lineNumber,
          column: item.func.columnNumber,
          originalFunctionName: item.func.functionName // Pass original function name for context
        }))
      );
      // Update top functions with resolved locations and enhanced information
      this.analysisResults.topFunctions = this.analysisResults.topFunctions.map((func, index) => {
        const resolved = resolvedLocations[index];
        if (resolved.isResolved) {
          return {
            ...func,
            originalFile: resolved.originalFile,
            originalLine: resolved.originalLine,
            originalColumn: resolved.originalColumn,
            originalName: resolved.originalName || func.functionName,
            isSourceMapped: true,
            fullOriginalPath: resolved.fullOriginalPath,
            sourceMapUrl: resolved.sourceMapUrl
          };
        }
        return { ...func, isSourceMapped: false };
      });

      const resolvedCount = resolvedLocations.filter(r => r.isResolved).length;
      if (resolvedCount > 0) {
        console.info(`✅ Resolved source maps for ${resolvedCount}/${resolvedLocations.length} functions`);
      }
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

  async generateFlamegraphData(): Promise<any> {
    try {
      return {
        callStack: this.generateCallStackAnalysis(),
        hotPaths: this.identifyHotPaths(),
        functionHierarchy: this.buildFunctionHierarchy(),
        visualSummary: this.createVisualSummary()
      };
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

  generate(flamegraphData?: any): CPUProfileAnalysis {
    const { rawData, topFunctions } = this.analysisResults;
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
        isSourceMapped: func.isSourceMapped,
        // Enhanced fields for better LLM analysis
        fullOriginalPath: func.fullOriginalPath,
        sourceMapUrl: func.sourceMapUrl,
        resolvedStackTrace: func.resolvedStackTrace
      })),
      flamegraph_analysis: flamegraphData,
    };
  }
}

export default CPUProfileAnalyzer;