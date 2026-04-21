import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditReport, LighthouseResult, AxeResult, VisualDiffResult } from "../src/audit-types.js";

// Mock config with controllable thresholds — vi.hoisted runs before vi.mock hoisting
const mockConfig = vi.hoisted(() => ({
  checkRunsEnabled: true,
  thresholdPerformance: 0,
  thresholdAccessibility: 0,
  thresholdBestPractices: 0,
  thresholdSeo: 0,
  thresholdAxeCritical: 0,
  thresholdAxeSerious: 5,
  thresholdVisualCritical: 0,
}));

// Mock github.ts to avoid needing GITHUB_TOKEN
vi.mock("../src/github.js", () => ({
  octokit: {
    rest: {
      checks: {
        create: vi.fn(),
        update: vi.fn(),
      },
    },
  },
}));

vi.mock("../src/config.js", () => ({
  config: mockConfig,
}));

import { evaluateAudit, startBuildCheckRun, runCheckRuns } from "../src/check-runs.js";
import { octokit } from "../src/github.js";

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    paths: [],
    timestamp: new Date().toISOString(),
    previewUrl: "https://pr-1.preview.example.com",
    ...overrides,
  };
}

function makeLighthouse(scores: Partial<LighthouseResult["scores"]> = {}): LighthouseResult {
  return {
    scores: {
      performance: 90,
      accessibility: 90,
      bestPractices: 90,
      seo: 90,
      ...scores,
    },
  };
}

function makeAxe(violations: AxeResult["violations"] = []): AxeResult {
  return {
    violations,
    passes: 40,
    incomplete: 0,
    totalViolations: violations.length,
  };
}

function makeVisualDiff(changes: VisualDiffResult["changes"] = []): VisualDiffResult {
  return {
    screenshots: [],
    changes,
    summary: "Visual diff summary",
    hasProductionComparison: true,
  };
}

describe("evaluateAudit", () => {
  beforeEach(() => {
    // Reset thresholds to defaults before each test
    mockConfig.thresholdPerformance = 0;
    mockConfig.thresholdAccessibility = 0;
    mockConfig.thresholdBestPractices = 0;
    mockConfig.thresholdSeo = 0;
    mockConfig.thresholdAxeCritical = 0;
    mockConfig.thresholdAxeSerious = 5;
    mockConfig.thresholdVisualCritical = 0;
  });

  it("returns neutral when no audit data exists", () => {
    const report = makeReport();
    const result = evaluateAudit(report);

    expect(result.conclusion).toBe("neutral");
    expect(result.title).toContain("No audit data");
  });

  it("returns success when all scores are above thresholds", () => {
    mockConfig.thresholdPerformance = 50;
    mockConfig.thresholdAccessibility = 50;

    const report = makeReport({
      paths: [{ path: "/", lighthouse: makeLighthouse({ performance: 90, accessibility: 90 }) }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("success");
    expect(result.title).toContain("Passed");
  });

  it("returns failure when performance is below threshold", () => {
    mockConfig.thresholdPerformance = 80;

    const report = makeReport({
      paths: [{ path: "/", lighthouse: makeLighthouse({ performance: 42 }) }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.title).toContain("Performance");
    expect(result.annotations.some((a) => a.title.includes("Performance"))).toBe(true);
  });

  it("returns failure when accessibility score is below threshold", () => {
    mockConfig.thresholdAccessibility = 90;

    const report = makeReport({
      paths: [{ path: "/", lighthouse: makeLighthouse({ accessibility: 70 }) }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.annotations.some((a) => a.title.includes("Accessibility"))).toBe(true);
  });

  it("reports all failed thresholds with annotations", () => {
    mockConfig.thresholdPerformance = 95;
    mockConfig.thresholdAccessibility = 95;
    mockConfig.thresholdSeo = 95;

    const report = makeReport({
      paths: [{
        path: "/",
        lighthouse: makeLighthouse({ performance: 50, accessibility: 60, seo: 70 }),
      }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    const failureAnnotations = result.annotations.filter((a) => a.annotation_level === "failure");
    expect(failureAnnotations.length).toBe(3);
  });

  it("returns failure when axe critical violations exceed threshold", () => {
    mockConfig.thresholdAxeCritical = 0;

    const report = makeReport({
      paths: [{
        path: "/",
        axe: makeAxe([
          { id: "color-contrast", impact: "critical", description: "Insufficient contrast", nodes: 3 },
        ]),
      }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("critical");
  });

  it("returns failure when axe serious violations exceed threshold", () => {
    mockConfig.thresholdAxeSerious = 0;

    const report = makeReport({
      paths: [{
        path: "/",
        axe: makeAxe([
          { id: "image-alt", impact: "serious", description: "Missing alt text", nodes: 2 },
        ]),
      }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("serious");
  });

  it("returns failure when visual critical changes exceed threshold", () => {
    mockConfig.thresholdVisualCritical = 0;

    const report = makeReport({
      paths: [{
        path: "/",
        visualDiff: makeVisualDiff([
          { category: "regression", severity: "critical", description: "Layout broken", viewport: "desktop" },
        ]),
      }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("critical");
  });

  it("passes with zero thresholds (defaults) when no critical issues", () => {
    const report = makeReport({
      paths: [{
        path: "/",
        lighthouse: makeLighthouse({ performance: 30, accessibility: 30 }),
        axe: makeAxe([]),
      }],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("success");
  });

  it("caps annotations at 50", () => {
    mockConfig.thresholdAxeSerious = 0;

    const violations = Array.from({ length: 60 }, (_, i) => ({
      id: `rule-${i}`,
      impact: "serious" as const,
      description: `Violation ${i}`,
      nodes: 1,
    }));

    const report = makeReport({
      paths: [{ path: "/", axe: makeAxe(violations) }],
    });

    const result = evaluateAudit(report);
    expect(result.annotations.length).toBe(50);
    expect(result.summary).toContain("truncated");
  });

  it("aggregates violations across multiple paths", () => {
    mockConfig.thresholdAxeCritical = 1;

    const report = makeReport({
      paths: [
        {
          path: "/",
          axe: makeAxe([
            { id: "color-contrast", impact: "critical", description: "Contrast issue", nodes: 1 },
          ]),
        },
        {
          path: "/about",
          axe: makeAxe([
            { id: "aria-label", impact: "critical", description: "Missing aria", nodes: 2 },
          ]),
        },
      ],
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.summary).toContain("Critical: 2");
  });

  it("falls back to top-level report fields when paths is empty", () => {
    mockConfig.thresholdPerformance = 80;

    const report = makeReport({
      paths: [],
      lighthouse: makeLighthouse({ performance: 50 }),
    });

    const result = evaluateAudit(report);
    expect(result.conclusion).toBe("failure");
    expect(result.title).toContain("Performance");
  });
});

const mockChecks = octokit.rest.checks as {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

describe("startBuildCheckRun", () => {
  beforeEach(() => {
    mockChecks.create.mockReset();
    mockChecks.update.mockReset();
    mockConfig.checkRunsEnabled = true;
  });

  it("creates an in_progress check run and returns its id", async () => {
    mockChecks.create.mockResolvedValue({ data: { id: 42 } });

    const id = await startBuildCheckRun({ owner: "o", repo: "r", sha: "abc" });

    expect(id).toBe(42);
    expect(mockChecks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "PreviewBot", status: "in_progress" }),
    );
  });

  it("returns undefined when check runs are disabled", async () => {
    mockConfig.checkRunsEnabled = false;

    const id = await startBuildCheckRun({ owner: "o", repo: "r", sha: "abc" });

    expect(id).toBeUndefined();
    expect(mockChecks.create).not.toHaveBeenCalled();
  });
});

describe("runCheckRuns", () => {
  beforeEach(() => {
    mockChecks.create.mockReset();
    mockChecks.update.mockReset();
    mockConfig.checkRunsEnabled = true;
  });

  it("updates existing check run instead of creating a new one when checkRunId is provided", async () => {
    mockChecks.update.mockResolvedValue({});

    await runCheckRuns({ owner: "o", repo: "r", sha: "abc", prNumber: 1, checkRunId: 42 });

    expect(mockChecks.create).not.toHaveBeenCalled();
    expect(mockChecks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 42, status: "completed" }),
    );
  });

  it("creates a new check run when no checkRunId is provided", async () => {
    mockChecks.create.mockResolvedValue({ data: { id: 99 } });
    mockChecks.update.mockResolvedValue({});

    await runCheckRuns({ owner: "o", repo: "r", sha: "abc", prNumber: 1 });

    expect(mockChecks.create).toHaveBeenCalled();
    expect(mockChecks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 99, status: "completed" }),
    );
  });

  it("completes with audit evaluation when audit data is provided", async () => {
    mockChecks.update.mockResolvedValue({});

    const report = makeReport({
      paths: [{ path: "/", lighthouse: makeLighthouse({ performance: 90 }) }],
    });

    await runCheckRuns({ owner: "o", repo: "r", sha: "abc", prNumber: 1, checkRunId: 42, audit: report });

    expect(mockChecks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 42,
        status: "completed",
        conclusion: "success",
      }),
    );
  });

  it("completes with neutral conclusion when no audit data", async () => {
    mockChecks.update.mockResolvedValue({});

    await runCheckRuns({ owner: "o", repo: "r", sha: "abc", prNumber: 1, checkRunId: 42 });

    expect(mockChecks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        check_run_id: 42,
        conclusion: "neutral",
      }),
    );
  });

  it("skips when check runs are disabled", async () => {
    mockConfig.checkRunsEnabled = false;

    await runCheckRuns({ owner: "o", repo: "r", sha: "abc", prNumber: 1, checkRunId: 42 });

    expect(mockChecks.create).not.toHaveBeenCalled();
    expect(mockChecks.update).not.toHaveBeenCalled();
  });
});
