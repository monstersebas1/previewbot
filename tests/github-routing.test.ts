import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPatOctokit = { _type: "pat" };
const mockAppOctokit = { _type: "app" };

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    return mockPatOctokit;
  }),
}));

vi.mock("../src/app-auth.js", () => ({
  isAppMode: vi.fn(),
  getInstallationOctokit: vi.fn().mockReturnValue(mockAppOctokit),
}));

describe("getOctokit routing", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns PAT octokit when no installationId", async () => {
    vi.doMock("../src/config.js", () => ({
      config: { githubToken: "ghp_test", githubAppId: "", githubAppPrivateKey: "" },
      previewUrl: (n: number) => `https://pr-${n}.preview.test`,
    }));
    vi.doMock("../src/app-auth.js", () => ({
      isAppMode: () => false,
      getInstallationOctokit: vi.fn(),
    }));

    const { getOctokit } = await import("../src/github.js");
    const oc = getOctokit();
    expect(oc).toBe(mockPatOctokit);
  });

  it("returns PAT octokit when app mode is off even with installationId", async () => {
    vi.doMock("../src/config.js", () => ({
      config: { githubToken: "ghp_test", githubAppId: "", githubAppPrivateKey: "" },
      previewUrl: (n: number) => `https://pr-${n}.preview.test`,
    }));
    vi.doMock("../src/app-auth.js", () => ({
      isAppMode: () => false,
      getInstallationOctokit: vi.fn(),
    }));

    const { getOctokit } = await import("../src/github.js");
    const oc = getOctokit(42);
    expect(oc).toBe(mockPatOctokit);
  });

  it("returns installation octokit when app mode is on and installationId provided", async () => {
    vi.doMock("../src/config.js", () => ({
      config: { githubToken: "", githubAppId: "123", githubAppPrivateKey: "pem" },
      previewUrl: (n: number) => `https://pr-${n}.preview.test`,
    }));
    const mockGetInstallation = vi.fn().mockReturnValue(mockAppOctokit);
    vi.doMock("../src/app-auth.js", () => ({
      isAppMode: () => true,
      getInstallationOctokit: mockGetInstallation,
    }));

    const { getOctokit } = await import("../src/github.js");
    const oc = getOctokit(99);
    expect(mockGetInstallation).toHaveBeenCalledWith(99);
    expect(oc).toBe(mockAppOctokit);
  });
});
