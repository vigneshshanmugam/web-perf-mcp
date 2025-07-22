#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { program } from "commander";
import { PerformanceRunner } from './PerformanceRunner.js';

program
  .name("performance-runner")
  .description(
    "Run comprehensive performance audits using Lighthouse and Playwright"
  )
  .version("1.0.0")
  .requiredOption("--url <url>", "URL to audit")
  .option("--device <device>", "Device type (desktop|mobile)", "desktop")
  .option("--runs <runs>", "Number of test runs", "1")
  .option("--network <network>", "Network throttling (fast3g|slow3g|none)", "fast3g")
  .option("--profile", "Enable CPU profiling", false)
  .option("--headless", "Run in headless mode", true)
  .option("--output <file>", "Save results to file")
  .action(async (options) => {
    const runner = new PerformanceRunner({
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

program.parse(process.argv);