import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig = vi.hoisted(() => ({
  appId: "",
  privateKeyPath: "",
  githubToken: "ghp_test123",
  webhookSecret: "test-secret",
}));

vi.mock("../src/config.js", () => ({
  config: mockConfig,
}));

vi.mock("../src/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@octokit/app", () => ({
  App: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("fake-private-key"),
}));

import { isAppMode, resolveCloneToken, getLegacyOctokit } from "../src/github-app.js";

describe("github-app", () => {
  beforeEach(() => {
    mockConfig.appId = "";
    mockConfig.privateKeyPath = "";
    mockConfig.githubToken = "ghp_test123";
  });

  describe("isAppMode", () => {
    it("returns false when appId is not set", () => {
      expect(isAppMode()).toBe(false);
    });

    it("returns false when only appId is set", () => {
      mockConfig.appId = "12345";
      expect(isAppMode()).toBe(false);
    });

    it("returns true when both appId and privateKeyPath are set", () => {
      mockConfig.appId = "12345";
      mockConfig.privateKeyPath = "/path/to/key.pem";
      expect(isAppMode()).toBe(true);
    });
  });

  describe("resolveCloneToken", () => {
    it("returns PAT when not in app mode", async () => {
      const token = await resolveCloneToken();
      expect(token).toBe("ghp_test123");
    });

    it("returns PAT when no installationId provided", async () => {
      const token = await resolveCloneToken(undefined);
      expect(token).toBe("ghp_test123");
    });
  });

  describe("getLegacyOctokit", () => {
    it("returns an Octokit instance with PAT auth", () => {
      const octokit = getLegacyOctokit();
      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it("throws when no githubToken configured", () => {
      mockConfig.githubToken = "";
      expect(() => getLegacyOctokit()).toThrow("No GITHUB_TOKEN");
    });
  });
});
