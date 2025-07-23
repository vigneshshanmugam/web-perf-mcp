#!/usr/bin/env node

import { program } from "commander";
import { AuditRunner } from './audit.js';
import CPUProfileAnalyzer from "./analyzer.js";
import Formatter from "./formatter.js";

program
  .command("audit")
  .description(
    "Run comprehensive performance audits using Lighthouse and Playwright"
  )
  .requiredOption("--url <url>", "URL to audit")
  .option("--device <device>", "Device type (desktop|mobile)", "desktop")
  .option("--profile", "Enable CPU profiling", false)
  .option("--headless", "Run in headless mode", true)
  .option("--output <file>", "Save results to file")
  .action(async (options) => {
    const runner = new AuditRunner({
      device: options.device,
      profile: options.profile,
      headless: options.headless,
    });
    try {
      const results = await runner.runAudit(options.url);
      console.log(JSON.stringify(results, null, 2));
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
  .action(async (options) => {
    try {
      const analyzer = new CPUProfileAnalyzer();
      const report = await analyzer.analyzeCPUProfile(options.profile, options.trace);
      const formatter = new Formatter();
      const formattedAnalysis = await formatter.formatStructuredAnalysis(report);
      console.log(formattedAnalysis);
    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);