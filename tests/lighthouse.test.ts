import { describe, it, expect, vi } from "vitest";
import type { LighthouseResult } from "../src/audit-types.js";

vi.mock("chrome-launcher", () => ({
  launch: vi.fn().mockResolvedValue({ port: 9222, kill: vi.fn() }),
}));

const fakeLhr = {
  categories: {
    performance: { score: 0.92 },
    accessibility: { score: 0.88 },
    "best-practices": { score: 0.95 },
    seo: { score: 0.9 },
  },
  audits: {
    "first-contentful-paint": { numericValue: 1200 },
    "largest-contentful-paint": { numericValue: 2500 },
    "total-blocking-time": { numericValue: 150 },
    "cumulative-layout-shift": { numericValue: 0.05 },
    "speed-index": { numericValue: 1800 },
  },
  report: "<html>fake report</html>",
};

vi.mock("lighthouse", () => ({
  default: vi.fn().mockResolvedValue({ lhr: fakeLhr }),
}));

describe("runLighthouse", () => {
  it("returns correct score shape for a single URL", async () => {
    const { runLighthouse } = await import("../src/lighthouse.js");
    const result: LighthouseResult = await runLighthouse("https://example.com");

    expect(result.scores).toEqual({
      performance: 92,
      accessibility: 88,
      bestPractices: 95,
      seo: 90,
    });
    expect(result.performanceDiff).toBeUndefined();
  });

  it("returns performance diff when production URL provided", async () => {
    const { runLighthouse } = await import("../src/lighthouse.js");
    const result = await runLighthouse("https://preview.example.com", "https://example.com");

    expect(result.performanceDiff).toBeDefined();
    expect(result.performanceDiff).toHaveLength(5);

    const fcp = result.performanceDiff!.find((d) => d.metric === "FCP");
    expect(fcp).toBeDefined();
    expect(fcp!.delta).toBe(0);
    expect(fcp!.preview).toBe(1200);
    expect(fcp!.production).toBe(1200);
  });

  it("includes all required diff metrics", async () => {
    const { runLighthouse } = await import("../src/lighthouse.js");
    const result = await runLighthouse("https://preview.example.com", "https://example.com");

    const metricNames = result.performanceDiff!.map((d) => d.metric);
    expect(metricNames).toEqual(["FCP", "LCP", "TBT", "CLS", "SI"]);
  });
});
