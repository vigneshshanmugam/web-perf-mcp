import { chromium } from "playwright";
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import { writeFile } from "fs/promises";
import { TestConfig, PerformanceMetrics, MetricRating } from '../common/types.js';

export class PerformanceRunner {
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

  async runAudit(url: string): Promise<PerformanceMetrics> {
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

  private async runSingleTest(url: string, runIndex: number) {
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
          onlyCategories: ['performance'],
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

      await this.sleep(5000); // Give Chrome more time to fully start and be ready for connections

      let client = null;
      if (this.options.cpuProfiling) {
        console.log(`Attempting to connect to Chrome on port ${chrome.port} for CPU profiling...`);
        try {
          browser = await chromium.connectOverCDP(`http://localhost:${chrome.port}`);
          console.log('Successfully connected to Chrome via CDP');
          const context = await browser.newContext();
          const page = await context.newPage();

          client = await context.newCDPSession(page);
          await client.send('Profiler.enable');
          await client.send('Profiler.start');
        } catch (error) {
          console.warn('Failed to start CPU profiling:', error.message);
          if (browser) {
            await browser.close().catch(() => { });
            browser = null;
          }
          client = null;
        }
      }

      // Run Lighthouse audit
      const lighthouseResult = await lighthouse(
        url,
        {
          port: chrome.port,
          disableStorageReset: false,
          logLevel: 'error',
          output: 'json',
        },
        lighthouseConfig
      );

      // Stop and save the CPU profile if profiling was started
      if (client && this.options.cpuProfiling) {
        try {
          const { profile } = await client.send('Profiler.stop');
          const profilePath = `cpu-profile-${Date.now()}.cpuprofile`;
          await writeFile(profilePath, JSON.stringify(profile, null, 2));
          console.log(`✅ CPU profile saved to ${profilePath}`);
        } catch (error) {
          console.warn('Failed to save CPU profile:', error.message);
        }
      }

      return this.combineResults(lighthouseResult, runIndex);
    } catch (error) {
      console.error(`Test run failed:`, error);
      throw new Error(`Test run failed: ${error.message}`);
    } finally {
      if (browser) await browser.close().catch(() => { });
      if (chrome) chrome.kill();
    }
  }

  private combineResults(lighthouseResult: any, runIndex: number) {
    const lhr = lighthouseResult.lhr;
    const getCoreWebVital = (auditId: string) => {
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

  private aggregateResults(url: string, results: any[]): PerformanceMetrics {
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

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  private getRating(metricPath: string, value: number): MetricRating["rating"] {
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

  private aggregateDiagnostics(results: any[]) {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
