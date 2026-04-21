import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAnalyze, mockGoto, mockClose, mockNewPage, mockBrowserClose, mockLaunch } = vi.hoisted(() => {
  const mockAnalyze = vi.fn();
  const mockGoto = vi.fn().mockResolvedValue(undefined);
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockNewPage = vi.fn();
  const mockBrowserClose = vi.fn().mockResolvedValue(undefined);
  const mockLaunch = vi.fn();
  return { mockAnalyze, mockGoto, mockClose, mockNewPage, mockBrowserClose, mockLaunch };
});

vi.mock("puppeteer", () => ({
  default: { launch: mockLaunch },
}));

vi.mock("@axe-core/puppeteer", () => ({
  AxePuppeteer: class {
    analyze = mockAnalyze;
  },
}));

vi.mock("../src/url-validation.js", () => ({
  assertSafeUrl: vi.fn(),
}));

const axeResponse = {
  violations: [
    {
      id: "color-contrast",
      impact: "serious" as const,
      description: "Elements must have sufficient color contrast",
      nodes: [{ html: "<p>" }, { html: "<span>" }],
    },
    {
      id: "image-alt",
      impact: "critical" as const,
      description: "Images must have alternate text",
      nodes: [{ html: "<img>" }],
    },
  ],
  passes: [{ id: "aria-roles" }, { id: "html-lang" }],
  incomplete: [{ id: "link-name" }],
};

import { runAccessibilityAudit } from "../src/accessibility.js";

describe("runAccessibilityAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyze.mockResolvedValue(axeResponse);
    mockGoto.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    mockNewPage.mockResolvedValue({ goto: mockGoto, close: mockClose });
    mockBrowserClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ newPage: mockNewPage, close: mockBrowserClose });
  });

  it("returns correctly shaped AxeResult", async () => {
    const result = await runAccessibilityAudit("https://example.com");

    expect(result).toHaveProperty("violations");
    expect(result).toHaveProperty("passes");
    expect(result).toHaveProperty("incomplete");
    expect(result).toHaveProperty("totalViolations");
    expect(Array.isArray(result.violations)).toBe(true);
    expect(typeof result.passes).toBe("number");
    expect(typeof result.incomplete).toBe("number");
    expect(typeof result.totalViolations).toBe("number");
  });

  it("sorts violations by impact severity", async () => {
    const result = await runAccessibilityAudit("https://example.com");
    const impacts = result.violations.map((v) => v.impact);
    expect(impacts).toEqual(["critical", "serious"]);
  });

  it("counts nodes correctly", async () => {
    const result = await runAccessibilityAudit("https://example.com");

    expect(result.totalViolations).toBe(3);
    expect(result.passes).toBe(2);
    expect(result.incomplete).toBe(1);
  });

  it("each violation has required fields", async () => {
    const result = await runAccessibilityAudit("https://example.com");

    for (const v of result.violations) {
      expect(v).toHaveProperty("id");
      expect(v).toHaveProperty("impact");
      expect(v).toHaveProperty("description");
      expect(v).toHaveProperty("nodes");
      expect(typeof v.id).toBe("string");
      expect(typeof v.impact).toBe("string");
      expect(typeof v.description).toBe("string");
      expect(typeof v.nodes).toBe("number");
    }
  });

  it("deduplicates violations across multiple paths", async () => {
    const result = await runAccessibilityAudit("https://example.com", ["/", "/about"]);

    const ids = result.violations.map((v) => v.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
    expect(result.totalViolations).toBe(6);
  });
});
