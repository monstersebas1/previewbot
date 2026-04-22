import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: { databasePath: ":memory:" },
}));

vi.mock("../src/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getDb,
  saveInstallation,
  removeInstallation,
  setInstallationRepos,
  addInstallationRepos,
  removeInstallationRepos,
  getInstallationForRepo,
  getAllInstallations,
  saveBuild,
  updateBuild,
} from "../src/db.js";

describe("db", () => {
  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM builds");
    db.exec("DELETE FROM installation_repos");
    db.exec("DELETE FROM installations");
  });

  describe("installations", () => {
    it("saves and retrieves an installation", () => {
      saveInstallation(123, "myorg", "Organization");

      const all = getAllInstallations();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        id: 123,
        accountLogin: "myorg",
        accountType: "Organization",
      });
    });

    it("upserts on duplicate installation id", () => {
      saveInstallation(123, "myorg", "Organization");
      saveInstallation(123, "myorg-renamed", "Organization");

      const all = getAllInstallations();
      expect(all).toHaveLength(1);
      expect(all[0].accountLogin).toBe("myorg-renamed");
    });

    it("removes an installation and cascades to repos", () => {
      saveInstallation(123, "myorg", "Organization");
      setInstallationRepos(123, ["myorg/repo-a", "myorg/repo-b"]);

      removeInstallation(123);

      expect(getAllInstallations()).toHaveLength(0);
      expect(getInstallationForRepo("myorg/repo-a")).toBeUndefined();
    });
  });

  describe("installation repos", () => {
    beforeEach(() => {
      saveInstallation(1, "org1", "Organization");
      saveInstallation(2, "org2", "Organization");
    });

    it("sets repos for an installation", () => {
      setInstallationRepos(1, ["org1/app", "org1/api"]);

      expect(getInstallationForRepo("org1/app")).toBe(1);
      expect(getInstallationForRepo("org1/api")).toBe(1);
      expect(getInstallationForRepo("org1/unknown")).toBeUndefined();
    });

    it("replaces repos on subsequent set", () => {
      setInstallationRepos(1, ["org1/app", "org1/api"]);
      setInstallationRepos(1, ["org1/app", "org1/web"]);

      expect(getInstallationForRepo("org1/app")).toBe(1);
      expect(getInstallationForRepo("org1/web")).toBe(1);
      expect(getInstallationForRepo("org1/api")).toBeUndefined();
    });

    it("adds repos incrementally", () => {
      setInstallationRepos(1, ["org1/app"]);
      addInstallationRepos(1, ["org1/api"]);

      expect(getInstallationForRepo("org1/app")).toBe(1);
      expect(getInstallationForRepo("org1/api")).toBe(1);
    });

    it("removes specific repos", () => {
      setInstallationRepos(1, ["org1/app", "org1/api", "org1/web"]);
      removeInstallationRepos(1, ["org1/api"]);

      expect(getInstallationForRepo("org1/app")).toBe(1);
      expect(getInstallationForRepo("org1/api")).toBeUndefined();
      expect(getInstallationForRepo("org1/web")).toBe(1);
    });

    it("maps repos to correct installations", () => {
      setInstallationRepos(1, ["org1/app"]);
      setInstallationRepos(2, ["org2/app"]);

      expect(getInstallationForRepo("org1/app")).toBe(1);
      expect(getInstallationForRepo("org2/app")).toBe(2);
    });
  });

  describe("builds", () => {
    beforeEach(() => {
      saveInstallation(1, "org1", "Organization");
    });

    it("saves a build and returns its id", () => {
      const id = saveBuild({
        installationId: 1,
        repoFullName: "org1/app",
        prNumber: 42,
        sha: "abc123",
      });

      expect(id).toBeGreaterThan(0);
    });

    it("updates build status and time", () => {
      const id = saveBuild({
        installationId: 1,
        repoFullName: "org1/app",
        prNumber: 42,
        sha: "abc123",
      });

      updateBuild(id, "live", 5000);

      const row = getDb().prepare("SELECT status, build_time_ms FROM builds WHERE id = ?").get(id) as {
        status: string;
        build_time_ms: number;
      };
      expect(row.status).toBe("live");
      expect(row.build_time_ms).toBe(5000);
    });

    it("allows null installation id for legacy builds", () => {
      const id = saveBuild({
        installationId: null,
        repoFullName: "user/repo",
        prNumber: 1,
        sha: "def456",
      });

      expect(id).toBeGreaterThan(0);
    });
  });
});
