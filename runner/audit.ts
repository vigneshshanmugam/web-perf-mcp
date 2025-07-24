import puppeteer, { Browser, CDPSession, Page } from "puppeteer";
import { Config, OutputMode, startFlow, FlowResult } from "lighthouse";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { TestConfig, PerformanceMetrics, MetricRating } from './types.js';

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
  private outputDir = join(process.cwd(), 'results');

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

  async runAudit(url: string): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });
    console.log(`Starting performance audit for: ${url}`);
    try {
      const result = await this.runSingleTest(url);
      const markdown = this.generateMarkdown(result);
      await this.saveResults(markdown);
      return markdown;
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
          const profilePath = join(this.outputDir, `cpu-profile.json`);
          await writeFile(profilePath, JSON.stringify(profile, null, 2));
          console.log(`✅ CPU profile saved to ${profilePath}`);
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
      await flow.navigate(url, { logLevel: 'verbose' });
      const lighthouseResult = await flow.createFlowResult();
      const flowArtifacts = await flow.createArtifactsJson();
      const traceEvents = flowArtifacts.gatherSteps[0].artifacts?.Trace?.traceEvents;

      // Save trace events
      if (traceEvents) {
        const tracePath = join(this.outputDir, `trace-events.json`);
        await writeFile(tracePath, JSON.stringify(traceEvents, null, 2));
        console.log(`✅ Trace events saved to ${tracePath}`);
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

  generateMarkdown(result: PerformanceMetrics): string {
    let markdown = `# Performance Audit Report\n\n`;
    markdown += `**URL**: ${result.url}\n`;
    markdown += `**Audit Date**: ${new Date(result.timestamp).toLocaleString()}\n`;
    markdown += `**Performance Score**: ${result.performanceScore}/100\n\n`;

    // Core Web Vitals Analysis
    markdown += `## Core Web Vitals Analysis\n\n`;
    markdown += `| Metric | Value | Rating | Percentile | Status |\n`;
    markdown += `|--------|-------|--------|------------|--------|\n`;

    const getStatusEmoji = (rating: string) => {
      switch (rating) {
        case 'good': return '✅';
        case 'needs-improvement': return '⚠️';
        case 'poor': return '❌';
        default: return '❓';
      }
    };

    const vitals = [
      { name: 'First Contentful Paint (FCP)', key: 'fcp', unit: 'ms' },
      { name: 'Largest Contentful Paint (LCP)', key: 'lcp', unit: 'ms' },
      { name: 'Cumulative Layout Shift (CLS)', key: 'cls', unit: '' },
      { name: 'Time to First Byte (TTFB)', key: 'ttfb', unit: 'ms' }
    ];

    vitals.forEach(vital => {
      const metric = result.coreWebVitals[vital.key];
      if (metric) {
        const status = getStatusEmoji(metric.rating);
        markdown += `| ${vital.name} | ${metric.value}${vital.unit} | ${metric.rating} | ${metric.percentile}% | ${status} |\n`;
      }
    });

    markdown += `\n`;

    const issues = [];
    vitals.forEach(vital => {
      const metric = result.coreWebVitals[vital.key];
      if (metric && metric.rating !== 'good') {
        issues.push(`**${vital.name}**: ${metric.value}${vital.unit} (${metric.rating})`);
      }
    });

    if (issues.length > 0) {
      markdown += `## 🚨 Performance Issues Detected\n\n`;
      issues.forEach(issue => markdown += `- ${issue}\n`);
      markdown += `\n`;
    }

    if (result.longTasks && result.longTasks.details && (result.longTasks.details as any).items) {
      const longTaskItems = (result.longTasks.details as any).items;

      if (longTaskItems.length > 0) {
        markdown += `## 🐌 Long Tasks Analysis\n\n`;
        markdown += `⚠️ **${longTaskItems.length} long task(s) detected** - These block the main thread and hurt user experience.\n\n`;

        // Summary statistics
        const totalDuration = longTaskItems.reduce((sum: number, task: any) => sum + task.duration, 0);
        const avgDuration = totalDuration / longTaskItems.length;
        const maxDuration = Math.max(...longTaskItems.map((task: any) => task.duration));

        markdown += `### Summary\n`;
        markdown += `- **Total blocking time**: ${totalDuration.toFixed(1)}ms\n`;
        markdown += `- **Average task duration**: ${avgDuration.toFixed(1)}ms\n`;
        markdown += `- **Longest task**: ${maxDuration.toFixed(1)}ms\n\n`;

        // Task details table
        markdown += `### Task Details\n\n`;
        markdown += `| URL | Start Time | Duration | Impact |\n`;
        markdown += `|-----|------------|----------|--------|\n`;

        longTaskItems
          .sort((a: any, b: any) => b.duration - a.duration)
          .forEach((task: any) => {
            const impact = task.duration > 100 ? '🔴 Critical' : task.duration > 50 ? '🟡 High' : '🟢 Medium';
            const url = task.url ?? 'Unknown';
            markdown += `| ${url} | ${task.startTime.toFixed(1)}ms | ${task.duration.toFixed(1)}ms | ${impact} |\n`;
          });
      } else {
        markdown += `## ✅ Long Tasks Analysis\n\n`;
        markdown += `**No long tasks detected** - Main thread blocking is minimal.\n\n`;
      }
    }
    return markdown;
  }

  private async saveResults(markdown: string): Promise<void> {
    try {
      await mkdir(this.outputDir, { recursive: true });
      const markdownPath = join(this.outputDir, 'report.md');
      await writeFile(markdownPath, markdown, 'utf-8');
      console.log(`✅ Markdown report saved to ${markdownPath}`);
    } catch (error) {
      console.error('Error saving results:', error);
    }
  }
}
