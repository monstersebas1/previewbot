import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAuditReport } from "../src/audit-report.js";
import type { AuditReport, LighthouseResult, AxeResult } from "../src/audit-types.js";

describe("AUDIT_PATHS config parsing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_TOKEN: "test",
      GITHUB_WEBHOOK_SECRET: "test",
      PREVIEW_DOMAIN: "test.example.com",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to single root path", async () => {
    delete process.env.AUDIT_PATHS;
    const { config } = await import("../src/config.js");
    expect(config.auditPaths).toEqual(["/"]);
  });

  it("parses multiple comma-separated paths", async () => {
    process.env.AUDIT_PATHS = "/,/about,/pricing";
    const { config } = await import("../src/config.js");
    expect(config.auditPaths).toEqual(["/", "/about", "/pricing"]);
  });

  it("trims whitespace from paths", async () => {
    process.env.AUDIT_PATHS = " / , /about , /pricing ";
    const { config } = await import("../src/config.js");
    expect(config.auditPaths).toEqual(["/", "/about", "/pricing"]);
  });

  it("filters empty segments", async () => {
    process.env.AUDIT_PATHS = "/,,/about,,";
    const { config } = await import("../src/config.js");
    expect(config.auditPaths).toEqual(["/", "/about"]);
  });
});

const mockLighthouse: LighthouseResult = {
  scores: { performance: 95, accessibility: 78, bestPractices: 92, seo: 100 },
};

const mockAxe: AxeResult = {
  violations: [],
  passes: 42,
  incomplete: 0,
  totalViolations: 0,
};

describe("generateAuditReport multi-path", () => {
  it("renders per-path headers when multiple paths exist", () => {
    const report: AuditReport = {
      paths: [
        { path: "/", lighthouse: mockLighthouse },
        { path: "/about", axe: mockAxe },
      ],
      lighthouse: mockLighthouse,
      axe: mockAxe,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("#### /");
    expect(md).toContain("#### /about");
    expect(md).toContain("### Performance (Lighthouse)");
    expect(md).toContain("### Accessibility (axe-core)");
  });

  it("renders flat (no path header) for single path", () => {
    const report: AuditReport = {
      paths: [{ path: "/", lighthouse: mockLighthouse }],
      lighthouse: mockLighthouse,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("### Performance (Lighthouse)");
    expect(md).not.toContain("#### /");
  });

  it("renders flat for empty paths array (backwards compat)", () => {
    const report: AuditReport = {
      paths: [],
      lighthouse: mockLighthouse,
      axe: mockAxe,
      timestamp: "2026-04-21T00:00:00Z",
      previewUrl: "https://pr-1.preview.example.com",
    };
    const md = generateAuditReport(report);

    expect(md).toContain("### Performance (Lighthouse)");
    expect(md).toContain("### Accessibility (axe-core)");
    expect(md).not.toContain("####");
  });
});
