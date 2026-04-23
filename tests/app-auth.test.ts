import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    githubToken: "",
    githubAppId: "12345",
    githubAppPrivateKey: "fake-pem-key",
  },
}));

vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    return { _mock: true };
  }),
}));

describe("app-auth", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("isAppMode returns true when app credentials are set", async () => {
    const { isAppMode } = await import("../src/app-auth.js");
    expect(isAppMode()).toBe(true);
  });

  it("getInstallationOctokit returns an Octokit instance", async () => {
    const { getInstallationOctokit } = await import("../src/app-auth.js");
    const oc = getInstallationOctokit(99);
    expect(oc).toBeDefined();
  });

  it("getInstallationOctokit caches per installation", async () => {
    const { getInstallationOctokit } = await import("../src/app-auth.js");
    const a = getInstallationOctokit(1);
    const b = getInstallationOctokit(1);
    const c = getInstallationOctokit(2);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("clearInstallationCache removes a specific entry", async () => {
    const { getInstallationOctokit, clearInstallationCache } = await import("../src/app-auth.js");
    const before = getInstallationOctokit(5);
    clearInstallationCache(5);
    const after = getInstallationOctokit(5);
    expect(before).not.toBe(after);
  });

  it("clearInstallationCache with no args clears all", async () => {
    const { getInstallationOctokit, clearInstallationCache } = await import("../src/app-auth.js");
    const before = getInstallationOctokit(10);
    clearInstallationCache();
    const after = getInstallationOctokit(10);
    expect(before).not.toBe(after);
  });
});
