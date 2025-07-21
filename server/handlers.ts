import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { PerformanceMetrics, TestConfig } from '../common/types.js';
import { formatResultsForLLM, generateAnalysisPrompt } from './formatters.js';
import { PerformanceStorage } from './storage.js';

const execAsync = promisify(exec);

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

    const auditScript = path.join(process.cwd(), 'dist', 'runner', 'index.js');
    const args = [
      `--url "${config.url}"`,
      `--device ${config.device || 'desktop'}`,
      `--network ${config.networkThrottling || 'fast3g'}`,
      `--runs ${config.runs || 5}`,
      config.cpuProfiling ? '--cpu-profile' : ''
    ].filter(Boolean);

    const command = `node ${auditScript} ${args.join(' ')}`;

    try {
      const { stdout } = await execAsync(command);
      const results: PerformanceMetrics = JSON.parse(stdout);

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
}
