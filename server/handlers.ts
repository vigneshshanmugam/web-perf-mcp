import { TestConfig } from '../runner/types.js';
import CPUProfileAnalyzer from '../runner/analyzer.js';
import { AuditRunner } from '../runner/audit.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Formatter from '../runner/formatter.js';

export class PerformanceHandlers {
  private resultsCache = new Map<string, string>();


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
      const runner = new AuditRunner(config);
      const report = await runner.runAudit(config.url);

      // Cache and store results
      this.resultsCache.set(cacheKey, report);

      return {
        content: [
          {
            type: 'text',
            text: `Performance audit completed for ${config.url}`,
          },
          {
            type: 'text',
            text: report,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Performance audit failed: ${error}`);
    }
  }

  async analyzePerformanceData(args: any) {
    const { cpuProfilePath, traceEventsPath } = args;
    try {
      const analyzer = new CPUProfileAnalyzer();
      const report = await analyzer.analyzeCPUProfile(cpuProfilePath, traceEventsPath);
      const formatter = new Formatter();
      const formattedAnalysis = await formatter.formatStructuredAnalysis(report);
      return {
        content: [
          {
            type: 'text',
            text: formattedAnalysis,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Performance data analysis failed: ${error.message}`);
    }
  }

}
