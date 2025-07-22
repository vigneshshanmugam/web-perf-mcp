#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { program } from "commander";
import { AuditRunner } from './audit.js';
import CPUProfileAnalyzer from "./analyzer.js";

program
  .command("audit")
  .description(
    "Run comprehensive performance audits using Lighthouse and Playwright"
  )
  .requiredOption("--url <url>", "URL to audit")
  .option("--device <device>", "Device type (desktop|mobile)", "desktop")
  .option("--runs <runs>", "Number of test runs", "1")
  .option("--network <network>", "Network throttling (fast3g|slow3g|none)", "fast3g")
  .option("--profile", "Enable CPU profiling", false)
  .option("--headless", "Run in headless mode", true)
  .option("--output <file>", "Save results to file")
  .action(async (options) => {
    const runner = new AuditRunner({
      runs: parseInt(options.runs) || 1,
      device: options.device,
      networkThrottling: options.network,
      cpuProfiling: options.profile,
      headless: options.headless,
    });
    try {
      const results = await runner.runAudit(options.url);
      console.log(JSON.stringify(results, null, 2));
      if (options.output) {
        await writeFile(options.output, JSON.stringify(results, null, 2));
        console.error(`Results saved to ${options.output}`);
      }
    } catch (error) {
      console.error("Performance audit failed:", error);
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze CPU profile and trace data")
  .requiredOption("--trace <trace>", "Performance trace to analyze")
  .requiredOption("--profile <profile>", "CPU profile to analyze")
  .option("--output <output>", "Output file for analysis report", "analysis-report.json")
  .action(async (options) => {
    try {
      const analyzer = new CPUProfileAnalyzer();
      const report = await analyzer.analyzeCPUProfile(options.profile, options.trace);
      analyzer.saveReport(report, options.output);

      console.log('\n=== QUICK ANALYSIS ===');
      console.log(`Performance Score: ${report.executive_summary.performance_score}/100`);
      console.log(`Total Execution Time: ${report.executive_summary.total_execution_time_ms}ms`);
      console.log(`Critical Issues Found: ${report.critical_performance_issues.length}`);
      console.log(`Top CPU Consumer: ${report.high_impact_functions[0]?.function || 'N/A'}`);

    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);