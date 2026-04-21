import puppeteer from "puppeteer";
import { AxePuppeteer } from "@axe-core/puppeteer";
import type { AxeResult, AxeViolation } from "./audit-types.js";

const IMPACT_ORDER: Record<string, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

const PAGE_TIMEOUT_MS = 60_000;
const DEFAULT_PATHS = ["/"];

function emptyResult(): AxeResult {
  return { violations: [], passes: 0, incomplete: 0, totalViolations: 0 };
}

async function scanPage(
  pageUrl: string,
  browser: puppeteer.Browser,
): Promise<AxeResult> {
  const page = await browser.newPage();
  try {
    await page.goto(pageUrl, {
      waitUntil: "networkidle2",
      timeout: PAGE_TIMEOUT_MS,
    });

    const results = await new AxePuppeteer(page).analyze();

    const violations: AxeViolation[] = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "minor",
      description: v.description,
      nodes: v.nodes.length,
    }));

    return {
      violations,
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      totalViolations: violations.reduce((sum, v) => sum + v.nodes, 0),
    };
  } catch {
    return emptyResult();
  } finally {
    await page.close();
  }
}

function aggregateResults(results: AxeResult[]): AxeResult {
  const violationMap = new Map<string, AxeViolation>();
  let totalPasses = 0;
  let totalIncomplete = 0;

  for (const result of results) {
    totalPasses += result.passes;
    totalIncomplete += result.incomplete;

    for (const v of result.violations) {
      const existing = violationMap.get(v.id);
      if (existing) {
        existing.nodes += v.nodes;
      } else {
        violationMap.set(v.id, { ...v });
      }
    }
  }

  const violations = [...violationMap.values()].sort(
    (a, b) =>
      (IMPACT_ORDER[a.impact] ?? 4) - (IMPACT_ORDER[b.impact] ?? 4),
  );

  return {
    violations,
    passes: totalPasses,
    incomplete: totalIncomplete,
    totalViolations: violations.reduce((sum, v) => sum + v.nodes, 0),
  };
}

export async function runAccessibilityAudit(
  url: string,
  paths: string[] = DEFAULT_PATHS,
): Promise<AxeResult> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const results: AxeResult[] = [];

    for (const path of paths) {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const fullUrl = url.replace(/\/$/, "") + normalizedPath;
      const result = await scanPage(fullUrl, browser);
      results.push(result);
    }

    return aggregateResults(results);
  } finally {
    await browser.close();
  }
}
