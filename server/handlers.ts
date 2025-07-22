import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { PerformanceMetrics, TestConfig } from '../common/types.js';
import { formatResultsForLLM, generateAnalysisPrompt } from './formatters.js';
import { PerformanceStorage } from './storage.js';
import CPUProfileAnalyzer from '../runner/analyzer.js';
import { AuditRunner } from '../runner/audit.js';

export class PerformanceHandlers {
  private resultsCache = new Map<string, PerformanceMetrics>();
  private storage: PerformanceStorage;

  constructor() {
    this.storage = new PerformanceStorage();
  }

  async runPerformanceAudit(config: TestConfig) {
    const cacheKey = `${config.url}-${JSON.stringify(config)}`;

    if (this.resultsCache.has(cacheKey)) {
      return {
        content: [
          {
            type: 'text',
            text: `Retrieved cached performance audit results for ${config.url}`,
          },
          {
            type: 'text',
            text: JSON.stringify(this.resultsCache.get(cacheKey), null, 2),
          },
        ],
      };
    }

    try {
      const report = new AuditRunner(config);
      const results = await report.runAudit(config.url);

      // Cache and store results
      this.resultsCache.set(cacheKey, results);
      await this.storage.storeResults(results);

      return {
        content: [
          {
            type: 'text',
            text: `Performance audit completed for ${config.url}`,
          },
          {
            type: 'text',
            text: formatResultsForLLM(results),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Performance audit failed: ${error}`);
    }
  }

  async getPerformanceHistory(args: any) {
    try {
      const history = await this.storage.getHistory(args.url, args.days || 30);
      if (history.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No historical data found for ${args.url}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Historical performance data for ${args.url} (last ${args.days || 30} days)`,
          },
          {
            type: 'text',
            text: JSON.stringify(history, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error retrieving historical data for ${args.url}: ${error}`,
          },
        ],
      };
    }
  }

  async comparePerformance(args: any) {
    try {
      const baselineHistory = await this.storage.getHistory(args.baselineUrl, 7);
      const targetHistory = await this.storage.getHistory(args.targetUrl, 7);

      if (baselineHistory.length === 0 || targetHistory.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Insufficient data for comparison. Need recent performance data for both URLs.`,
            },
          ],
        };
      }

      const baseline = baselineHistory[baselineHistory.length - 1];
      const target = targetHistory[targetHistory.length - 1];

      const comparison = this.generateComparison(baseline, target, args.metrics || ['fcp', 'lcp', 'cls', 'ttfb']);

      return {
        content: [
          {
            type: 'text',
            text: `Performance comparison between ${args.baselineUrl} and ${args.targetUrl}`,
          },
          {
            type: 'text',
            text: comparison,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Performance comparison failed: ${error}`);
    }
  }

  async analyzePerformanceTrends(args: any) {
    const data = this.resultsCache.get(args.data);

    if (!data) {
      throw new Error('Performance data not found');
    }

    return {
      content: [
        {
          type: 'text',
          text: 'Performance analysis and optimization suggestions:',
        },
        {
          type: 'text',
          text: generateAnalysisPrompt(data),
        },
      ],
    };
  }

  private generateComparison(baseline: PerformanceMetrics, target: PerformanceMetrics, metrics: string[]): string {
    let comparison = `PERFORMANCE COMPARISON\n\n`;
    comparison += `Baseline: ${baseline.url} (Score: ${baseline.performanceScore})\n`;
    comparison += `Target: ${target.url} (Score: ${target.performanceScore})\n\n`;

    const scoreDiff = target.performanceScore - baseline.performanceScore;
    comparison += `Overall Score Difference: ${scoreDiff > 0 ? '+' : ''}${scoreDiff}\n\n`;

    comparison += `CORE WEB VITALS COMPARISON:\n`;

    if (metrics.includes('fcp')) {
      const fcpDiff = target.coreWebVitals.fcp.value - baseline.coreWebVitals.fcp.value;
      comparison += `- FCP: ${baseline.coreWebVitals.fcp.value}ms → ${target.coreWebVitals.fcp.value}ms (${fcpDiff > 0 ? '+' : ''}${fcpDiff}ms)\n`;
    }

    if (metrics.includes('lcp')) {
      const lcpDiff = target.coreWebVitals.lcp.value - baseline.coreWebVitals.lcp.value;
      comparison += `- LCP: ${baseline.coreWebVitals.lcp.value}ms → ${target.coreWebVitals.lcp.value}ms (${lcpDiff > 0 ? '+' : ''}${lcpDiff}ms)\n`;
    }

    if (metrics.includes('cls')) {
      const clsDiff = target.coreWebVitals.cls.value - baseline.coreWebVitals.cls.value;
      comparison += `- CLS: ${baseline.coreWebVitals.cls.value} → ${target.coreWebVitals.cls.value} (${clsDiff > 0 ? '+' : ''}${clsDiff.toFixed(3)})\n`;
    }

    if (metrics.includes('ttfb')) {
      const ttfbDiff = target.coreWebVitals.ttfb.value - baseline.coreWebVitals.ttfb.value;
      comparison += `- TTFB: ${baseline.coreWebVitals.ttfb.value}ms → ${target.coreWebVitals.ttfb.value}ms (${ttfbDiff > 0 ? '+' : ''}${ttfbDiff}ms)\n`;
    }

    return comparison;
  }

  async analyzePerformanceData(args: any) {
    const { cpuProfilePath, traceEventsPath } = args;
    try {
      const analyzer = new CPUProfileAnalyzer();
      // Perform the analysis using the existing analyzer methods
      let traceEvents = null;
      const cpuProfile = JSON.parse(await readFile(cpuProfilePath, 'utf8'));
      if (traceEventsPath && existsSync(traceEventsPath)) {
        const traceData = JSON.parse(await readFile(traceEventsPath, 'utf8'));
        traceEvents = traceData.traceEvents || traceData;
      }

      analyzer.analyzeCPUProfileData(cpuProfile);
      if (traceEvents) {
        analyzer.analyzeTraceEvents(traceEvents);
      }

      const report = analyzer.generateLLMReport();
      return {
        content: [
          {
            type: 'text',
            text: this.formatStructuredAnalysis(report),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Performance data analysis failed: ${error.message}`);
    }
  }

  private formatStructuredAnalysis(report: any): string {
    let output = `COMPREHENSIVE PERFORMANCE ANALYSIS\n\n`;

    // Executive Summary
    output += `EXECUTIVE SUMMARY\n`;
    output += `Performance Score: ${report.executive_summary.performance_score}/100\n`;
    output += `Total Execution Time: ${report.executive_summary.total_execution_time_ms}ms\n`;
    output += `Total Samples: ${report.executive_summary.total_samples}\n`;
    output += `Sample Interval: ${report.executive_summary.sample_interval_ms}ms\n\n`;

    // Top Bottleneck
    if (report.executive_summary.top_bottleneck) {
      output += `Primary Bottleneck: ${report.executive_summary.top_bottleneck.function}\n`;
      output += `Impact: ${report.executive_summary.top_bottleneck.impact}\n\n`;
    }

    // Critical Issues
    if (report.critical_performance_issues.length > 0) {
      output += `CRITICAL PERFORMANCE ISSUES (${report.critical_performance_issues.length})\n`;
      report.critical_performance_issues.forEach((issue, index) => {
        output += `${index + 1}. Function: ${issue.function}\n`;
        output += `   Severity: ${issue.severity}\n`;
        output += `   Impact: ${issue.impact}\n`;
        output += `   Location: ${issue.location}\n\n`;
      });
    }

    // High Impact Functions
    output += `HIGH IMPACT FUNCTIONS\n`;
    report.high_impact_functions.slice(0, 10).forEach((func, index) => {
      output += `${index + 1}. ${func.function}\n`;
      output += `   File: ${func.file}\n`;
      output += `   Execution Time: ${func.execution_time_ms}ms\n`;
      output += `   CPU Percentage: ${func.cpu_percentage}%\n`;
      output += `   Call Count: ${func.call_count}\n`;
      output += `   Location: ${func.location}\n\n`;
    });

    // Script Performance
    if (report.script_performance) {
      output += `SCRIPT PERFORMANCE ANALYSIS\n`;
      if (report.script_performance.long_running_tasks && report.script_performance.long_running_tasks.length > 0) {
        output += `Long Running Tasks (${report.script_performance.long_running_tasks.length}):\n`;
        report.script_performance.long_running_tasks.slice(0, 10).forEach((task, index) => {
          output += `  ${index + 1}. ${task.name} - ${task.duration}ms\n`;
        });
        output += `\n`;
      }
      if (report.script_performance.script_execution_analysis && report.script_performance.script_execution_analysis.length > 0) {
        output += `Script Execution Analysis (${report.script_performance.script_execution_analysis.length}):\n`;
        report.script_performance.script_execution_analysis.slice(0, 10).forEach((script, index) => {
          output += `  ${index + 1}. ${script.type} - ${script.duration}ms\n`;
        });
        output += `\n`;
      }
    }

    // Optimization Opportunities
    if (report.optimization_opportunities && report.optimization_opportunities.length > 0) {
      output += `OPTIMIZATION OPPORTUNITIES (${report.optimization_opportunities.length})\n`;
      report.optimization_opportunities.forEach((rec, index) => {
        output += `${index + 1}. ${rec}\n`;
      });
      output += `\n`;
    }

    // LLM Analysis Prompt (if available)
    if (report.llm_analysis_prompt) {
      output += `AI ANALYSIS INSIGHTS\n`;
      output += `${report.llm_analysis_prompt}\n\n`;
    }
    return output;
  }


}
