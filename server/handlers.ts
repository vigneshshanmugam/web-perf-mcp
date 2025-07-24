import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { TestConfig } from '../runner/types.js';
import CPUProfileAnalyzer from '../runner/analyzer.js';
import { AuditRunner, outputDir } from '../runner/audit.js';
import Formatter from '../runner/formatter.js';

export class PerformanceHandlers {
  async runAudit(config: TestConfig) {
    try {
      const runner = new AuditRunner(config);
      const report = await runner.runAudit(config.url);
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

  async analyzeData(args: any) {
    const { cpuProfilePath, traceEventsPath } = args;
    try {
      const analyzer = new CPUProfileAnalyzer();
      const report = await analyzer.analyzeCPUProfile(cpuProfilePath, traceEventsPath);
      const auditReportPath = join(outputDir, 'report.json');
      if (!existsSync(auditReportPath)) {
        throw new Error('Audit report not found, run audit first');
      }
      const auditReport = await analyzer.loadAuditReport(auditReportPath);
      const formatter = new Formatter();
      const formattedAnalysis = await formatter.formatAnalysis(report, auditReport);
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
