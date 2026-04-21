import { describe, it, expect } from "vitest";
import { generateAuditReport } from "../src/audit-report.js";
import type { AuditReport, LighthouseResult, AxeResult } from "../src/audit-types.js";

const mockLighthouse: LighthouseResult = {
  scores: {
    performance: 95,
    accessibility: 78,
    bestPractices: 92,
    seo: 100,
  },
};

const mockLighthouseWithDiff: LighthouseResult = {
  scores: {
    performance: 95,
    accessibility: 78,
    bestPractices: 92,
    seo: 100,
  },
  performanceDiff: [
    { metric: "FCP", preview: 1200, production: 1400, delta: -200 },
    { metric: "LCP", preview: 2500, production: 2300, delta: 200 },
    { metric: "TBT", preview: 150, production: 150, delta: 0 },
  ],
  rawReportUrl: "https://storage.example.com/report.html",
};

const mockAxeClean: AxeResult = {
  violations: [],
  passes: 42,
  incomplete: 0,
  totalViolations: 0,
};

const mockAxeWithViolations: AxeResult = {
  violations: [
    { id: "color-contrast", impact: "critical", description: "Elements must have sufficient color contrast", nodes: 5 },
    { id: "image-alt", impact: "serious", description: "Images must have alternate text", nodes: 2 },
    { id: "link-name", impact: "moderate", description: "Links must have discernible text", nodes: 1 },
  ],
  passes: 38,
  incomplete: 1,
  totalViolations: 3,
};

describe("generateAuditReport", () => {
  it("returns empty string when no audit data", () => {
    const report: AuditReport = {
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    expect(generateAuditReport(report)).toBe("");
  });

  it("renders lighthouse scores with correct badges", () => {
    const report: AuditReport = {
      lighthouse: mockLighthouse,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("### Performance (Lighthouse)");
    expect(md).toContain("🟢 95");
    expect(md).toContain("🟡 78");
    expect(md).toContain("🟢 92");
    expect(md).toContain("🟢 100");
    expect(md).not.toContain("Diff vs Production");
  });

  it("renders lighthouse diff table when present", () => {
    const report: AuditReport = {
      lighthouse: mockLighthouseWithDiff,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("**Diff vs Production**");
    expect(md).toContain("▼ -200");
    expect(md).toContain("▲ +200");
    expect(md).toContain("—");
    expect(md).toContain("[View full report](https://storage.example.com/report.html)");
  });

  it("renders clean axe result", () => {
    const report: AuditReport = {
      axe: mockAxeClean,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("### Accessibility (axe-core)");
    expect(md).toContain("No violations found");
    expect(md).not.toContain("Rule");
  });

  it("renders axe violations with impact icons", () => {
    const report: AuditReport = {
      axe: mockAxeWithViolations,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("3 violations found");
    expect(md).toContain("1 critical");
    expect(md).toContain("1 serious");
    expect(md).toContain("color-contrast");
    expect(md).toContain("🔴 critical");
    expect(md).toContain("🟠 serious");
    expect(md).toContain("🟡 moderate");
    expect(md).toContain("| 5 |");
  });

  it("renders both lighthouse and axe together", () => {
    const report: AuditReport = {
      lighthouse: mockLighthouse,
      axe: mockAxeWithViolations,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("### Performance (Lighthouse)");
    expect(md).toContain("### Accessibility (axe-core)");
  });

  it("uses red badge for scores below 50", () => {
    const report: AuditReport = {
      lighthouse: {
        scores: { performance: 32, accessibility: 49, bestPractices: 50, seo: 89 },
      },
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("🔴 32");
    expect(md).toContain("🔴 49");
    expect(md).toContain("🟡 50");
    expect(md).toContain("🟡 89");
  });
});
