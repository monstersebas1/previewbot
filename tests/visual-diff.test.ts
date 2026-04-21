import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VisualDiffResult } from "../src/audit-types.js";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

vi.mock("../src/screenshot.js", () => ({
  captureScreenshots: vi.fn(() => [
    { viewport: "mobile", width: 375, height: 812, previewPath: "/tmp/preview-mobile.jpg", productionPath: "/tmp/prod-mobile.jpg" },
    { viewport: "tablet", width: 768, height: 1024, previewPath: "/tmp/preview-tablet.jpg" },
    { viewport: "desktop", width: 1440, height: 900, previewPath: "/tmp/preview-desktop.jpg" },
  ]),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(() => Buffer.from("fake-image-data")),
}));

vi.mock("../src/config.js", () => ({
  config: { anthropicApiKey: "test-key" },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runVisualDiff", () => {
  it("returns structured result with changes from all viewports", async () => {
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          changes: [
            { category: "layout", severity: "warning", description: "Header shifted 10px left" },
          ],
          summary: "Minor layout shift detected",
        }),
      }],
    });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      productionUrl: "https://example.com",
      prNumber: 1,
    });

    expect(result).toBeDefined();
    const r = result as VisualDiffResult;
    expect(r.screenshots).toHaveLength(3);
    expect(r.changes.length).toBeGreaterThan(0);
    expect(r.changes[0]).toMatchObject({
      category: "layout",
      severity: "warning",
      viewport: "mobile",
    });
    expect(r.hasProductionComparison).toBe(true);
    expect(r.summary).toContain("mobile");
  });

  it("returns undefined when ANTHROPIC_API_KEY is not set", async () => {
    const configModule = await import("../src/config.js");
    const original = configModule.config.anthropicApiKey;
    Object.defineProperty(configModule.config, "anthropicApiKey", { value: undefined, writable: true });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeUndefined();
    Object.defineProperty(configModule.config, "anthropicApiKey", { value: original, writable: true });
  });

  it("handles API returning no text block", async () => {
    mockCreate.mockResolvedValue({ content: [] });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeDefined();
    const r = result as VisualDiffResult;
    expect(r.summary).toContain("No analysis returned");
  });

  it("handles malformed JSON from API gracefully", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "This is not JSON, just plain text analysis" }],
    });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeDefined();
    const r = result as VisualDiffResult;
    expect(r.changes).toHaveLength(0);
  });

  it("handles valid JSON with invalid shape gracefully", async () => {
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({
          changes: [{ category: "invalid-category", severity: 999, extra: true }],
          summary: 42,
        }),
      }],
    });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeDefined();
    const r = result as VisualDiffResult;
    expect(r.changes).toHaveLength(0);
  });

  it("sets hasProductionComparison to false when no production URL", async () => {
    mockCreate.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify({ changes: [], summary: "Looks good" }),
      }],
    });

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeDefined();
    expect((result as VisualDiffResult).hasProductionComparison).toBe(false);
  });

  it("returns undefined when API throws", async () => {
    mockCreate.mockRejectedValue(new Error("API rate limited"));

    const { runVisualDiff } = await import("../src/visual-diff.js");

    const result = await runVisualDiff({
      previewUrl: "https://pr-1.preview.example.com",
      prNumber: 1,
    });

    expect(result).toBeUndefined();
  });
});
