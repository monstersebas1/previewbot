import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lighthouse, { type Result, type RunnerResult } from "lighthouse";
import { launch } from "chrome-launcher";
import type { LighthouseResult, PerformanceDiff } from "./audit-types.js";
import { assertSafeUrl } from "./url-validation.js";
import { config } from "./config.js";

interface LighthouseRun {
  lhr: Result;
  reportHtml: string | undefined;
}

const TIMEOUT_MS = 120_000;

const DIFF_METRICS: { key: string; label: string }[] = [
  { key: "first-contentful-paint", label: "FCP" },
  { key: "largest-contentful-paint", label: "LCP" },
  { key: "total-blocking-time", label: "TBT" },
  { key: "cumulative-layout-shift", label: "CLS" },
  { key: "speed-index", label: "SI" },
];

function scoreToInt(score: number | null): number | null {
  return score === null ? null : Math.round(score * 100);
}

function extractScores(result: Result): LighthouseResult["scores"] {
  const cats = result.categories;
  return {
    performance: scoreToInt(cats.performance?.score ?? null),
    accessibility: scoreToInt(cats.accessibility?.score ?? null),
    bestPractices: scoreToInt(cats["best-practices"]?.score ?? null),
    seo: scoreToInt(cats.seo?.score ?? null),
  };
}

function extractMetricValue(result: Result, auditId: string): number {
  return result.audits[auditId]?.numericValue ?? 0;
}

function computeDiff(preview: Result, production: Result): PerformanceDiff[] {
  return DIFF_METRICS.map(({ key, label }) => {
    const previewVal = extractMetricValue(preview, key);
    const productionVal = extractMetricValue(production, key);
    return {
      metric: label,
      preview: Math.round(previewVal),
      production: Math.round(productionVal),
      delta: Math.round(previewVal - productionVal),
    };
  });
}

async function runOnce(url: string): Promise<LighthouseRun> {
  const chromeFlags = ["--headless", "--disable-gpu"];
  if (config.disableChromeSandbox) {
    chromeFlags.push("--no-sandbox");
  }
  const chrome = await launch({ chromeFlags });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const runnerResult = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: "html",
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Lighthouse timed out after ${TIMEOUT_MS}ms`)),
          TIMEOUT_MS,
        );
      }),
    ]);

    clearTimeout(timeoutId);

    if (!runnerResult?.lhr) {
      throw new Error("Lighthouse returned no results");
    }

    const reportHtml = typeof runnerResult.report === "string" ? runnerResult.report : undefined;
    return { lhr: runnerResult.lhr, reportHtml };
  } finally {
    try {
      await Promise.race([
        chrome.kill(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    } catch {
      // Chrome process may already be dead
    }
  }
}

async function saveReport(html: string, prNumber: number): Promise<string> {
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error(`Invalid PR number for report: ${prNumber}`);
  }
  const dir = join(config.reportDir, `pr-${prNumber}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "lighthouse.html");
  await writeFile(filePath, html, "utf-8");
  return filePath;
}

export interface RunLighthouseOptions {
  url: string;
  productionUrl?: string;
  prNumber?: number;
}

export async function runLighthouse({ url, productionUrl, prNumber }: RunLighthouseOptions): Promise<LighthouseResult> {
  assertSafeUrl(url);
  if (productionUrl) {
    assertSafeUrl(productionUrl);
  }

  const [preview, production] = await Promise.all([
    runOnce(url),
    productionUrl ? runOnce(productionUrl) : Promise.resolve(undefined),
  ]);

  const scores = extractScores(preview.lhr);
  const result: LighthouseResult = { scores };

  if (production) {
    result.performanceDiff = computeDiff(preview.lhr, production.lhr);
  }

  if (prNumber && preview.reportHtml) {
    const reportPath = await saveReport(preview.reportHtml, prNumber);
    result.rawReportUrl = reportPath;
  }

  return result;
}
