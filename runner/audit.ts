import puppeteer, { Browser, CDPSession, Page } from "puppeteer";
import { Config, OutputMode, startFlow } from "lighthouse";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { TestConfig, PerformanceMetrics, MetricRating } from '../common/types.js';

export class AuditRunner {
  options: Partial<TestConfig>;
  deviceConfigs: Record<string, { viewport: { width: number; height: number } }>;
  networkProfiles: Record<string, { latency: number; downloadThroughput: number; uploadThroughput: number }>;
  private outputDir = join(process.cwd(), 'audit-results');

  constructor(options = {}) {
    this.options = {
      device: "desktop",
      cpuProfiling: true,
      headless: true,
      ...options,
    };

    this.deviceConfigs = {
      desktop: {
        viewport: { width: 1366, height: 768 },
      },
      mobile: {
        viewport: { width: 375, height: 812 },
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
      `Configuration: ${this.options.device} device, ${this.options.networkThrottling} network`
    );
    try {
      const result = await this.runSingleTest(url);
      await this.saveResults(result);
      return result;
    } catch (error) {
      console.error(`Audit failed:`, error.message);
      throw new Error(`Audit failed: ${error.message}`);
    }
  }

  private async runSingleTest(url: string) {
    let browser: Browser = null;
    let page: Page = null;
    let session: CDPSession = null;

    try {
      // Launch Chrome with Puppeteer directly
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
        defaultViewport: this.deviceConfigs[this.options.device].viewport
      });
      page = await browser.newPage();
      session = await page.createCDPSession();

      if (this.options.cpuProfiling) {
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
      }
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const lhConfig: Config = {
        extends: "lighthouse:default",
        settings: {
          output: 'json' as OutputMode,
          onlyCategories: ['performance'],
          formFactor: this.options.device,
          screenEmulation: this.options.device === "mobile"
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
        },
      };

      const flow = await startFlow(page, { config: lhConfig, flags: { saveAssets: true } as any });
      await flow.navigate(url);
      const lighthouseResult = await flow.createFlowResult();
      const flowArtifacts = await flow.createArtifactsJson();
      const traceEvents = flowArtifacts.gatherSteps[0].artifacts.Trace.traceEvents;

      await mkdir(this.outputDir, { recursive: true });
      // Save trace events and CPU profile
      const timestamp = Date.now();
      const tracePath = join(this.outputDir, `trace-events-${timestamp}.json`);
      await writeFile(tracePath, JSON.stringify(traceEvents, null, 2));
      console.log(`✅ Trace events saved to ${tracePath}`);

      // Stop profiling and save CPU profile
      if (session && this.options.cpuProfiling) {
        try {
          const { profile } = await session.send('Profiler.stop');
          const profilePath = join(this.outputDir, `cpu-profile-${timestamp}.cpuprofile`);
          await writeFile(profilePath, JSON.stringify(profile, null, 2));
          console.log(`✅ CPU profile saved to ${profilePath}`);
        } catch (error) {
          console.warn('Failed to save CPU profile:', error.message);
        }
      }

      return this.combineResults(lighthouseResult?.steps[0], url);
    } catch (error) {
      console.error(`Test run failed:`, error);
      throw new Error(`Test run failed: ${error.message}`);
    } finally {
      if (session) await session.detach().catch(() => { });
      if (page) await page.close().catch(() => { });
      if (browser) await browser.close().catch(() => { });
    }
  }

  private combineResults(lighthouseResult: any, url: string): PerformanceMetrics {
    if (!lighthouseResult || !lighthouseResult.lhr) {
      throw new Error("Invalid Lighthouse result");
    }
    const lhr = lighthouseResult.lhr;
    const getCoreWebVital = (auditId: string) => {
      const audit = lhr.audits[auditId];
      if (audit && audit.numericValue !== undefined) {
        return {
          value: Math.round(audit.numericValue),
          rating: (
            audit.score >= 0.9
              ? "good"
              : audit.score >= 0.5
                ? "needs-improvement"
                : "poor"
          ) as MetricRating["rating"],
          percentile: Math.round((audit.score || 0) * 100),
        };
      }
      return null;
    };

    return {
      url,
      timestamp: new Date().toISOString(),
      performanceScore: Math.round(
        (lhr.categories.performance?.score || 0) * 100
      ),
      coreWebVitals: {
        fcp: {
          ...getCoreWebVital("first-contentful-paint"),
        },
        lcp: {
          ...getCoreWebVital("largest-contentful-paint"),
        },
        cls: {
          ...getCoreWebVital("cumulative-layout-shift"),
        },
        ttfb: {
          ...getCoreWebVital("server-response-time"),
        },
      },
    };
  }



  private async saveResults(results: PerformanceMetrics): Promise<void> {
    try {
      await mkdir(this.outputDir, { recursive: true });
      const resultsPath = join(this.outputDir, 'performance-results.json');
      await writeFile(resultsPath, JSON.stringify(results, null, 2));
      console.log(`✅ Performance results saved to ${resultsPath}`);
      console.log(`✅ All audit files saved to: ${this.outputDir}`);
    } catch (error) {
      console.warn('Failed to save results:', error.message);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
