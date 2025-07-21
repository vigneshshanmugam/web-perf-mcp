#!/usr/bin/env node

import { chromium } from "playwright";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { writeFile } from "fs/promises";
import { program } from "commander";
import { TestConfig, PerformanceMetrics, MetricRating } from '../common/types.js';

class PerformanceRunner {
  options: Partial<TestConfig>;
  deviceConfigs: Record<string, { viewport: { width: number; height: number }; userAgent: string }>;
  networkProfiles: Record<string, { latency: number; downloadThroughput: number; uploadThroughput: number }>;
  constructor(options = {}) {
    this.options = {
      runs: 3,
      device: "desktop",
      cpuProfiling: true,
      headless: true,
      ...options,
    };

    this.deviceConfigs = {
      desktop: {
        viewport: { width: 1366, height: 768 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      mobile: {
        viewport: { width: 375, height: 812 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15",
      },
    };

    this.networkProfiles = {
      fast3g: {
        latency: 562.5,
        downloadThroughput: 1.6 * 1024 * 1024 / 8,
        uploadThroughput: 750 * 1024 / 8,
      },
      slow3g: {
        latency: 2000,
        downloadThroughput: 500 * 1024 / 8,
        uploadThroughput: 500 * 1024 / 8,
      }
    };
  }

  async runAudit(url) {
    console.log(`Starting performance audit for: ${url}`);
    console.log(
      `Configuration: ${this.options.runs} runs, ${this.options.device} device, ${this.options.networkThrottling} network`
    );

    const results = [];

    for (let i = 0; i < this.options.runs; i++) {
      console.log(`Running test ${i + 1}/${this.options.runs}...`);
      try {
        const runResult = await this.runSingleTest(url, i);
        results.push(runResult);
        if (i < this.options.runs - 1) {
          await this.sleep(2000);
        }
      } catch (error) {
        console.error(`Test run ${i + 1} failed:`, error.message);
      }
    }

    if (results.length === 0) {
      throw new Error("All test runs failed");
    }
    console.log(
      `Completed ${results.length}/${this.options.runs} successful runs`
    );
    return this.aggregateResults(url, results);
  }

  async runSingleTest(url, runIndex) {
    let browser = null;
    let chrome = null;

    try {
      chrome = await launch({
        chromeFlags: [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
      });

      // Configure Lighthouse options
      const lighthouseConfig = {
        extends: "lighthouse:default",
        settings: {
          formFactor: this.options.device,
          screenEmulation:
            this.options.device === "mobile"
              ? {
                mobile: true,
                width: 375,
                height: 812,
                deviceScaleFactor: 3,
                disabled: false,
              }
              : {
                mobile: false,
                width: 1366,
                height: 768,
                deviceScaleFactor: 1,
                disabled: false,
              },
          emulatedUserAgent: this.deviceConfigs[this.options.device].userAgent,
        },
      };

      // Run Lighthouse audit
      const lighthouseResult = await lighthouse(
        url,
        {
          port: chrome.port,
          disableStorageReset: false,
          logLevel: "error",
        },
        lighthouseConfig
      );

      // Run Playwright for additional metrics and CPU profiling
      if (this.options.cpuProfiling) {
        console.log(`Connecting Playwright to Chrome on port ${chrome.port}`);
        await this.sleep(1000); ``
        browser = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
        console.log('Successfully connected Playwright to Chrome');

        const context = await browser.newContext({
          ...this.deviceConfigs[this.options.device],
          ...(this.networkProfiles[this.options.networkThrottling] && {
            offline: false,
            downloadThroughput:
              this.networkProfiles[this.options.networkThrottling]
                .downloadThroughput,
            uploadThroughput:
              this.networkProfiles[this.options.networkThrottling]
                .uploadThroughput,
            latency:
              this.networkProfiles[this.options.networkThrottling].latency,
          }),
        });

        const page = await context.newPage();
        const client = await context.newCDPSession(page);
        await client.send("Profiler.enable");
        await client.send("Profiler.start");
        const startTime = Date.now();
        await page.goto(url, { waitUntil: "networkidle" });
        await this.sleep(3000); // Additional wait for dynamic content
        const { profile } = await client.send("Profiler.stop");
        await client.send("Profiler.disable");
        await browser.close();
      }

      return this.combineResults(
        lighthouseResult,
        runIndex
      );
    } catch (error) {
      console.error(`Test run failed:`, error);
      throw new Error(`Test run failed: ${error.message}`);
    } finally {
      if (browser) await browser.close().catch(() => { });
      if (chrome) chrome.kill();
    }
  }

  combineResults(lighthouseResult, runIndex) {
    const lhr = lighthouseResult.lhr;
    const getCoreWebVital = (auditId) => {
      const audit = lhr.audits[auditId];
      if (audit && audit.numericValue !== undefined) {
        return {
          value: Math.round(audit.numericValue),
          rating:
            audit.score >= 0.9
              ? "good"
              : audit.score >= 0.5
                ? "needs-improvement"
                : "poor",
          percentile: Math.round((audit.score || 0) * 100),
        };
      }
      return null;
    };

    return {
      runIndex,
      timestamp: new Date().toISOString(),
      performanceScore: Math.round(
        (lhr.categories.performance?.score || 0) * 100
      ),
      coreWebVitals: {
        fcp: getCoreWebVital("first-contentful-paint"),
        lcp: getCoreWebVital("largest-contentful-paint"),
        cls: getCoreWebVital("cumulative-layout-shift"),
        ttfb: getCoreWebVital("server-response-time"),
      },
      diagnostics: Object.values(lhr.audits)
        .filter(
          (audit: any) =>
            audit.scoreDisplayMode === "binary" &&
            audit.score !== null &&
            audit.score < 1
        )
        .map((audit: any) => ({
          id: audit.id,
          title: audit.title,
          description: audit.description,
          severity: audit.score === 0 ? "error" : "warning",
        }))
        .slice(0, 10),
    };
  }

  aggregateResults(url, results): PerformanceMetrics {
    if (results.length === 0) {
      throw new Error("No results to aggregate");
    }

    const aggregateMetric = (metricPath: string): MetricRating | null => {
      const values = results
        .map((result) => this.getNestedValue(result, metricPath))
        .filter((val) => val !== null && val !== undefined && !isNaN(val));

      if (values.length === 0) return null;

      const sorted = values.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const average = Math.round(
        values.reduce((a, b) => a + b, 0) / values.length
      );

      return {
        value: median, // Use median as primary value (more stable)
        average,
        min: Math.min(...values),
        max: Math.max(...values),
        rating: this.getRating(metricPath, median),
      };
    };

    // Aggregate core metrics
    return {
      url,
      timestamp: new Date().toISOString(),
      testRuns: results.length,
      performanceScore: Math.round(
        results.reduce((sum, r) => sum + r.performanceScore, 0) / results.length
      ),
      coreWebVitals: {
        fcp: aggregateMetric("coreWebVitals.fcp.value"),
        lcp: aggregateMetric("coreWebVitals.lcp.value"),
        cls: aggregateMetric("coreWebVitals.cls.value"),
        ttfb: aggregateMetric("coreWebVitals.ttfb.value"),
      },
      diagnostics: this.aggregateDiagnostics(results),
    };
  }

  getNestedValue(obj, path) {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  getRating(metricPath, value): MetricRating["rating"] {
    const thresholds = {
      "coreWebVitals.fcp.value": [1800, 3000],
      "coreWebVitals.lcp.value": [2500, 4000],
      "coreWebVitals.cls.value": [0.1, 0.25],
      "coreWebVitals.ttfb.value": [800, 1800],
    };

    const threshold = thresholds[metricPath];
    if (!threshold || value === null || value === undefined) return "unknown";

    if (metricPath.includes("cls")) {
      return value <= threshold[0]
        ? "good"
        : value <= threshold[1]
          ? "needs-improvement"
          : "poor";
    }

    return value <= threshold[0]
      ? "good"
      : value <= threshold[1]
        ? "needs-improvement"
        : "poor";
  }

  aggregateDiagnostics(results) {
    const allDiagnostics = results.flatMap((r) => r.diagnostics);
    const grouped = new Map();

    allDiagnostics.forEach((diag) => {
      if (!grouped.has(diag.id)) {
        grouped.set(diag.id, []);
      }
      grouped.get(diag.id).push(diag);
    });

    return Array.from(grouped.entries())
      .map(([id, diags]) => ({
        id,
        title: diags[0].title,
        description: diags[0].description,
        severity: diags[0].severity,
        frequency: diags.length / results.length,
      }))
      .filter((d) => d.frequency >= 0.5); // Only include issues that appear in at least half the runs
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

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