import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ViewportScreenshot } from "../src/audit-types.js";

vi.mock("puppeteer", () => {
  const mockPage = {
    setViewport: vi.fn(),
    goto: vi.fn(),
    screenshot: vi.fn(),
    close: vi.fn(),
  };
  const mockBrowser = {
    newPage: vi.fn(() => mockPage),
    close: vi.fn(),
  };
  return {
    default: { launch: vi.fn(() => mockBrowser) },
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureScreenshots", () => {
  it("returns screenshots for all three viewports", async () => {
    const { captureScreenshots } = await import("../src/screenshot.js");

    const results = await captureScreenshots({
      previewUrl: "https://pr-42.preview.example.com",
      prNumber: 42,
      outputDir: "/tmp/test-screenshots",
    });

    expect(results).toHaveLength(3);
    expect(results.map((r: ViewportScreenshot) => r.viewport)).toEqual(["mobile", "tablet", "desktop"]);
  });

  it("returns correct dimensions per viewport", async () => {
    const { captureScreenshots } = await import("../src/screenshot.js");

    const results = await captureScreenshots({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
      outputDir: "/tmp/test-screenshots",
    });

    expect(results[0]).toMatchObject({ viewport: "mobile", width: 375, height: 812 });
    expect(results[1]).toMatchObject({ viewport: "tablet", width: 768, height: 1024 });
    expect(results[2]).toMatchObject({ viewport: "desktop", width: 1440, height: 900 });
  });

  it("includes preview paths for all screenshots", async () => {
    const { captureScreenshots } = await import("../src/screenshot.js");

    const results = await captureScreenshots({
      previewUrl: "https://pr-5.preview.example.com",
      prNumber: 5,
      outputDir: "/tmp/test-screenshots",
    });

    for (const r of results) {
      expect(r.previewPath).toContain("preview-");
      expect(r.previewPath).toContain(".jpg");
      expect(r.productionPath).toBeUndefined();
    }
  });

  it("includes production paths when productionUrl is provided", async () => {
    const { captureScreenshots } = await import("../src/screenshot.js");

    const results = await captureScreenshots({
      previewUrl: "https://pr-5.preview.example.com",
      productionUrl: "https://example.com",
      prNumber: 5,
      outputDir: "/tmp/test-screenshots",
    });

    for (const r of results) {
      expect(r.previewPath).toContain("preview-");
      expect(r.productionPath).toContain("production-");
    }
  });

  it("uses default output dir when not specified", async () => {
    const { captureScreenshots } = await import("../src/screenshot.js");

    const results = await captureScreenshots({
      previewUrl: "https://pr-10.preview.example.com",
      prNumber: 10,
    });

    expect(results[0].previewPath).toMatch(/pr-10[\\/]screenshots/);
  });
});
