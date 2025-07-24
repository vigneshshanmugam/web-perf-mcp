import puppeteer, { Browser, CDPSession, Page } from "puppeteer";
import { Config, OutputMode, startFlow, FlowResult } from "lighthouse";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { TestConfig, PerformanceMetrics, MetricRating } from './types.js';

// Output directory for audit results
export const outputDir = join(process.cwd(), 'results');

// To be able to profile Kibana page, we need to login first
async function handleKibanaLogin(page: Page, url: string) {
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    if (request.url().includes('/login') && request.method() === 'POST') {
      request.continue();
    } else {
      request.continue();
    }
  });
  const baseURL = new URL(url);
  const kbnPath = baseURL.pathname.split('/')[1];
  await page.goto(`${baseURL.origin}/${kbnPath}/login`, { waitUntil: 'load' });
  await page.locator("[data-test-subj='loginUsername']").fill("elastic");
  await page.locator("[data-test-subj='loginPassword']").fill("changeme");
  await page.locator("[data-test-subj='loginSubmit']").click();
  await page.waitForNavigation();
}

export class AuditRunner {
  options: TestConfig;
  deviceConfigs: Record<string, { viewport: { width: number; height: number } }>;
  constructor(options = {}) {
    this.options = {
      url: "",
      device: "desktop",
      profile: true,
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
  }

  async runAudit(url: string): Promise<PerformanceMetrics> {
    await mkdir(outputDir, { recursive: true });
    console.info(`Starting performance audit for: ${url}`);
    try {
      const result = await this.runSingleTest(url);
      await this.saveResults(result);
      return result;
    } catch (error) {
      console.error(`Audit failed:`, error);
      throw error;
    }
  }

  private async runSingleTest(url: string) {
    let browser: Browser = null;
    let page: Page = null;
    let session: CDPSession = null;

    try {
      // Launch Chrome with Puppeteer directly
      browser = await puppeteer.launch({
        headless: this.options.headless,
        args: [
          "--disable-gpu",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
        defaultViewport: this.deviceConfigs[this.options.device].viewport
      });
      page = await browser.newPage();
      session = await page.createCDPSession();

      if (url.includes('localhost:5601')) {
        await handleKibanaLogin(page, url);
      }

      if (this.options.profile) {
        await session.send('Profiler.enable');
        await session.send('Profiler.start');
      }
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Stop profiling and save CPU profile
      if (session && this.options.profile) {
        try {
          const { profile } = await session.send('Profiler.stop');
          const profilePath = join(outputDir, `cpu-profile.json`);
          await writeFile(profilePath, JSON.stringify(profile, null, 2));
          console.info(`✅ CPU profile saved to ${profilePath}`);
        } catch (error) {
          console.warn('Failed to save CPU profile:', error.message);
        }
      }

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

      const flow = await startFlow(page, { config: lhConfig });
      await flow.navigate(url, { logLevel: 'error' });
      const lighthouseResult = await flow.createFlowResult();
      const flowArtifacts = await flow.createArtifactsJson();
      const traceEvents = flowArtifacts.gatherSteps[0].artifacts?.Trace?.traceEvents;

      // Save trace events
      if (traceEvents) {
        const tracePath = join(outputDir, `trace-events.json`);
        await writeFile(tracePath, JSON.stringify(traceEvents, null, 2));
        console.info(`✅ Trace events saved to ${tracePath}`);
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

  private combineResults(lighthouseResult: FlowResult.Step, url: string): PerformanceMetrics {
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
        fcp: getCoreWebVital("first-contentful-paint"),
        lcp: getCoreWebVital("largest-contentful-paint"),
        cls: getCoreWebVital("cumulative-layout-shift"),
        ttfb: getCoreWebVital("server-response-time"),
      },
      longTasks: lhr.audits['long-tasks'],
    };
  }

  private async saveResults(result: PerformanceMetrics): Promise<void> {
    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, 'report.json'), JSON.stringify(result, null, 2), 'utf-8');
      console.info(`✅ Audit report saved to ${join(outputDir, 'report.json')}`);
    } catch (error) {
      console.error('Error saving audit results:', error);
    }
  }
}
