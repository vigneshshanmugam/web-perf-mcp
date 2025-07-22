import { readFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from 'node:path';
import { AggregatedFunction, CPUProfile } from './types';

class CPUProfileAnalyzer {
  analysisResults = {
    summary: {},
    longTasks: [],
    topFunctions: [],
    performanceBottlenecks: [],
    scriptAnalysis: [],
    recommendations: [],
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

      this.analyzeCPUProfileData(cpuProfile);
      if (traceEvents) {
        this.analyzeTraceEvents(traceEvents);
      }
      const report = this.generateLLMReport();

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

  analyzeCPUProfileData(cpuProfile: CPUProfile) {
    const { nodes, samples, timeDeltas, startTime, endTime } = cpuProfile;
    if (!nodes || !samples) {
      throw new Error('Invalid CPU profile format');
    }

    const totalSamples = samples.length;
    const sampleInterval = cpuProfile.sampleInterval || 1000; // microseconds
    const totalTime = timeDeltas ? timeDeltas.reduce((sum, delta) => sum + delta, 0) : totalSamples * sampleInterval;

    this.analysisResults.rawData = {
      totalSamples,
      totalTime: totalTime / 1000, // Convert to milliseconds
      sampleInterval: sampleInterval / 1000, // Convert to milliseconds
      duration: endTime && startTime ? (endTime - startTime) / 1000 : totalTime / 1000
    };

    // Build node map for quick lookup
    const nodeMap = new Map();
    nodes.forEach(node => {
      nodeMap.set(node.id, {
        ...node,
        selfTime: 0,
        totalTime: 0,
        hitCount: 0,
        children: node.children || []
      });
    });

    // Calculate hit counts and times for each function
    samples.forEach((sampleNodeId, index) => {
      const timeDelta = timeDeltas ? timeDeltas[index] : sampleInterval;

      if (nodeMap.has(sampleNodeId)) {
        const node = nodeMap.get(sampleNodeId);
        node.hitCount++;
        node.selfTime += timeDelta;
      }
    });

    // Calculate total time including children
    this.calculateTotalTimes(nodeMap, nodes);

    // Extract top functions by self time, excluding Lighthouse internal functions
    const sortedFunctions = Array.from(nodeMap.values())
      .filter(node => {
        if (node.hitCount === 0) return false;
        const url = node.callFrame.url || '';
        if (url.includes('_lighthouse-eval.js')) return false;
        return true;
      })
      .sort((a, b) => b.selfTime - a.selfTime)
      .slice(0, 20);

    this.analysisResults.topFunctions = sortedFunctions.map(node => ({
      functionName: node.callFrame.functionName || '(anonymous)',
      url: node.callFrame.url || '(unknown)',
      lineNumber: node.callFrame.lineNumber || 0,
      columnNumber: node.callFrame.columnNumber || 0,
      selfTime: Math.round(node.selfTime / 1000), // Convert to ms
      totalTime: Math.round(node.totalTime / 1000), // Convert to ms
      hitCount: node.hitCount,
      percentage: ((node.selfTime / totalTime) * 100).toFixed(2)
    }));

    // Identify performance bottlenecks
    this.identifyBottlenecks(nodeMap, totalTime);
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

    // Calculate for all root nodes
    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        calculateTotal(node.id);
      }
    });
  }

  identifyBottlenecks(nodeMap, totalTime) {
    const bottlenecks = [];
    const threshold = totalTime * 0.05; // Functions taking >5% of total time

    Array.from(nodeMap.values())
      .filter((node: unknown) => (node as { selfTime: number }).selfTime > threshold)
      .forEach((node: any) => {
        const callFrame = node.callFrame;
        const issue = {
          type: 'HIGH_CPU_USAGE',
          functionName: callFrame.functionName || '(anonymous)',
          file: this.getFileNameFromUrl(callFrame.url),
          location: `${callFrame.url}:${callFrame.lineNumber}:${callFrame.columnNumber}`,
          selfTime: Math.round(node.selfTime / 1000),
          percentage: ((node.selfTime / totalTime) * 100).toFixed(2),
          severity: this.getSeverity(node.selfTime / totalTime)
        };

        bottlenecks.push(issue);
      });

    this.analysisResults.performanceBottlenecks = bottlenecks;
  }

  analyzeTraceEvents(traceEvents) {
    // Analyze long tasks (>50ms)
    const longTasks = traceEvents
      .filter(event =>
        event.ph === 'X' && // Complete events
        event.dur > 50000 && // >50ms in microseconds
        event.cat && event.cat.includes('devtools.timeline')
      )
      .map(event => ({
        name: event.name,
        duration: Math.round(event.dur / 1000), // Convert to ms
        startTime: Math.round(event.ts / 1000),
        category: event.cat,
        args: event.args
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);

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

    this.analysisResults.longTasks = longTasks;
    this.analysisResults.scriptAnalysis = scriptEvents.slice(0, 15);
  }


  getSeverity(percentage) {
    if (percentage > 0.2) return 'CRITICAL';
    if (percentage > 0.1) return 'HIGH';
    if (percentage > 0.05) return 'MEDIUM';
    return 'LOW';
  }

  getFileNameFromUrl(url) {
    if (!url) return 'unknown';
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || 'unknown';
    } catch {
      return url.split('/').pop() || 'unknown';
    }
  }

  generateLLMReport() {
    const { rawData, topFunctions, performanceBottlenecks, longTasks, scriptAnalysis } = this.analysisResults;

    return {
      executive_summary: {
        total_execution_time_ms: rawData.totalTime,
        total_samples: rawData.totalSamples,
        sample_interval_ms: rawData.sampleInterval,
        top_bottleneck: performanceBottlenecks[0] || null,
        performance_score: this.calculatePerformanceScore()
      },
      critical_performance_issues: performanceBottlenecks.filter(b => b.severity === 'CRITICAL'),
      high_impact_functions: topFunctions.slice(0, 10).map(func => ({
        function: func.functionName,
        file: this.getFileNameFromUrl(func.url),
        execution_time_ms: func.selfTime,
        cpu_percentage: func.percentage,
        call_count: func.hitCount,
        location: `${func.url}:${func.lineNumber}`
      })),
      script_performance: {
        long_running_tasks: longTasks || [],
        script_execution_analysis: scriptAnalysis || []
      },
      llm_analysis_prompt: this.generateLLMPrompt()
    };
  }

  calculatePerformanceScore() {
    const { performanceBottlenecks } = this.analysisResults;
    let score = 100;

    performanceBottlenecks.forEach(bottleneck => {
      const impact = parseFloat(bottleneck.percentage);
      if (bottleneck.severity === 'CRITICAL') score -= impact * 2;
      else if (bottleneck.severity === 'HIGH') score -= impact * 1.5;
      else if (bottleneck.severity === 'MEDIUM') score -= impact;
    });

    return Math.max(0, Math.round(score));
  }

  generateLLMPrompt() {
    return {
      instruction: "Please analyze this CPU performance profile and provide specific, actionable recommendations for optimization.",
      context: `This data represents ${this.analysisResults.rawData.totalTime}ms of CPU execution time with ${this.analysisResults.rawData.totalSamples} samples.`,
      focus_areas: [
        "Identify the most critical performance bottlenecks",
        "Suggest specific code optimization techniques",
        "Recommend architectural improvements",
        "Prioritize optimizations by impact vs effort",
        "Identify potential memory leaks or inefficient algorithms"
      ],
      output_format: "Provide a structured analysis with: 1) Executive Summary, 2) Critical Issues (with specific line numbers where possible), 3) Optimization Recommendations (prioritized), 4) Implementation Steps"
    };
  }

  saveReport(report, outputPath) {
    const formattedReport = {
      ...report,
      generated_at: new Date().toISOString(),
      analysis_metadata: {
        version: '1.0.0',
        analyzer: 'CPU Profile Analyzer',
        data_source: 'Lighthouse CPU Profile + Trace Events'
      }
    };

    writeFileSync(outputPath, JSON.stringify(formattedReport, null, 2));
    console.log(`LLM-friendly performance report saved to: ${outputPath}`);
    return formattedReport;
  }
}

export default CPUProfileAnalyzer;