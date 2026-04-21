import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lighthouse, { type Result, type RunnerResult } from "lighthouse";
import { launch } from "chrome-launcher";
import type { LighthouseResult, PerformanceDiff } from "./audit-types.js";

interface LighthouseRun {
  lhr: Result;
  reportHtml: string | undefined;
}

const TIMEOUT_MS = 120_000;
const REPORT_BASE_DIR = "/var/previewbot/reports";

const DIFF_METRICS: { key: string; label: string }[] = [
  { key: "first-contentful-paint", label: "FCP" },
  { key: "largest-contentful-paint", label: "LCP" },
  { key: "total-blocking-time", label: "TBT" },
  { key: "cumulative-layout-shift", label: "CLS" },
  { key: "speed-index", label: "SI" },
];

function scoreToInt(score: number | null): number {
  return Math.round((score ?? 0) * 100);
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
  const chrome = await launch({ chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"] });

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
  const dir = join(REPORT_BASE_DIR, `pr-${prNumber}`);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "lighthouse.html");
  await writeFile(filePath, html, "utf-8");
  return filePath;
}

export async function runLighthouse(
  url: string,
  productionUrl?: string,
  prNumber?: number,
): Promise<LighthouseResult> {
  const preview = await runOnce(url);
  const scores = extractScores(preview.lhr);

  const result: LighthouseResult = { scores };

  if (productionUrl) {
    const production = await runOnce(productionUrl);
    result.performanceDiff = computeDiff(preview.lhr, production.lhr);
  }

  if (prNumber && preview.reportHtml) {
    const reportPath = await saveReport(preview.reportHtml, prNumber);
    result.rawReportUrl = reportPath;
  }

  return result;
}
