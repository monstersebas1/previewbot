import { describe, it, expect, vi, beforeEach } from "vitest";

describe("config auth validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("throws when neither GITHUB_TOKEN nor app credentials are set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("PREVIEW_DOMAIN", "preview.test");

    await expect(import("../src/config.js")).rejects.toThrow("Auth required");
  });

  it("accepts PAT-only mode", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_test");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("PREVIEW_DOMAIN", "preview.test");

    const { config } = await import("../src/config.js");
    expect(config.githubToken).toBe("ghp_test");
    expect(config.githubAppId).toBe("");
  });

  it("accepts app-only mode", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "pem-content");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("PREVIEW_DOMAIN", "preview.test");

    const { config } = await import("../src/config.js");
    expect(config.githubAppId).toBe("12345");
    expect(config.githubToken).toBe("");
  });
});
