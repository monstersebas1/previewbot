import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: { dbPath: ":memory:" },
}));

async function freshDb() {
  vi.resetModules();
  const mod = await import("../src/installation-db.js");
  return mod;
}

describe("installation-db", () => {
  let db: Awaited<ReturnType<typeof freshDb>>;

  beforeEach(async () => {
    db = await freshDb();
  });

  afterEach(() => {
    db.closeDb();
  });

  it("saveInstallation stores installation and repos", () => {
    db.saveInstallation(1, "acme", "Organization", [
      { owner: "acme", repo: "web" },
      { owner: "acme", repo: "api" },
    ]);

    expect(db.getInstallationForRepo("acme", "web")).toBe(1);
    expect(db.getInstallationForRepo("acme", "api")).toBe(1);
    expect(db.getInstallationForRepo("acme", "other")).toBeNull();
  });

  it("listReposForInstallation returns all repos", () => {
    db.saveInstallation(2, "org", "Organization", [
      { owner: "org", repo: "alpha" },
      { owner: "org", repo: "beta" },
    ]);

    const repos = db.listReposForInstallation(2);
    expect(repos).toHaveLength(2);
    expect(repos).toContainEqual({ owner: "org", repo: "alpha" });
    expect(repos).toContainEqual({ owner: "org", repo: "beta" });
  });

  it("addRepos appends new repos to an existing installation", () => {
    db.saveInstallation(3, "user", "User", [{ owner: "user", repo: "existing" }]);
    db.addRepos(3, [{ owner: "user", repo: "new-repo" }]);

    expect(db.getInstallationForRepo("user", "existing")).toBe(3);
    expect(db.getInstallationForRepo("user", "new-repo")).toBe(3);
  });

  it("removeRepos deletes only specified repos", () => {
    db.saveInstallation(4, "user", "User", [
      { owner: "user", repo: "keep" },
      { owner: "user", repo: "remove" },
    ]);
    db.removeRepos(4, [{ owner: "user", repo: "remove" }]);

    expect(db.getInstallationForRepo("user", "keep")).toBe(4);
    expect(db.getInstallationForRepo("user", "remove")).toBeNull();
  });

  it("deleteInstallation cascades to repos", () => {
    db.saveInstallation(5, "org", "Organization", [
      { owner: "org", repo: "app" },
    ]);
    db.deleteInstallation(5);

    expect(db.getInstallationForRepo("org", "app")).toBeNull();
    expect(db.listReposForInstallation(5)).toHaveLength(0);
  });

  it("saveInstallation is idempotent on re-install", () => {
    db.saveInstallation(6, "org", "Organization", [{ owner: "org", repo: "app" }]);
    db.saveInstallation(6, "org", "Organization", [{ owner: "org", repo: "app" }]);

    expect(db.getInstallationForRepo("org", "app")).toBe(6);
    expect(db.listReposForInstallation(6)).toHaveLength(1);
  });
});
