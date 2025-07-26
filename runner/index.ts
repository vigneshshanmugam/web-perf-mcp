#!/usr/bin/env node

import { join } from "node:path";
import { program } from "commander";
import { AuditRunner, outputDir } from './audit.js';
import CPUProfileAnalyzer from "./analyzer.js";
import Formatter from "./formatter.js";

program
  .command("audit")
  .description(
    "Run comprehensive performance audits using Lighthouse and Playwright"
  )
  .requiredOption("--url <url>", "URL to audit")
  .option("--device <device>", "Device type (desktop|mobile)", "desktop")
  .option("--profile", "Enable CPU profiling", true)
  .option("--headless", "Run in headless mode", true)
  .action(async (options) => {
    const runner = new AuditRunner({
      device: options.device,
      profile: options.profile,
      headless: options.headless,
    });
    try {
      const report = await runner.runAudit(options.url);
      console.log(report);
    } catch (error) {
      console.error("Performance audit failed:", error);
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze CPU profile and trace data")
  .requiredOption("--profile <profile>", "CPU profile to analyze")
  .option("--trace <trace>", "Performance trace to analyze")
  .action(async (options) => {
    try {
      const analyzer = new CPUProfileAnalyzer();
      const cpuReport = await analyzer.analyzeCPUProfile(options.profile, options.trace);
      const auditReportPath = join(outputDir, 'report.json');
      const auditReport = await analyzer.analyzeAuditReport(auditReportPath);
      const formatter = new Formatter();
      const formattedAnalysis = formatter.formatAnalysis(cpuReport, auditReport);
      console.log(formattedAnalysis);
    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);