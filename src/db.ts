import Database from "better-sqlite3";
import { config } from "./config.js";
import { log } from "./logger.js";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(config.databasePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate();
    log.info("Database initialized", { path: config.databasePath });
  }
  return db;
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      id INTEGER PRIMARY KEY,
      account_login TEXT NOT NULL,
      account_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installation_repos (
      installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
      repo_full_name TEXT NOT NULL,
      PRIMARY KEY (installation_id, repo_full_name)
    );

    CREATE TABLE IF NOT EXISTS builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installation_id INTEGER REFERENCES installations(id),
      repo_full_name TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'building',
      sha TEXT,
      build_time_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function saveInstallation(
  id: number,
  accountLogin: string,
  accountType: string,
): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO installations (id, account_login, account_type)
    VALUES (?, ?, ?)
  `).run(id, accountLogin, accountType);
}

export function removeInstallation(id: number): void {
  getDb().prepare("DELETE FROM installations WHERE id = ?").run(id);
}

export function setInstallationRepos(
  installationId: number,
  repos: string[],
): void {
  const db = getDb();
  const del = db.prepare("DELETE FROM installation_repos WHERE installation_id = ?");
  const ins = db.prepare("INSERT INTO installation_repos (installation_id, repo_full_name) VALUES (?, ?)");

  db.transaction(() => {
    del.run(installationId);
    for (const repo of repos) {
      ins.run(installationId, repo);
    }
  })();
}

export function addInstallationRepos(
  installationId: number,
  repos: string[],
): void {
  const ins = getDb().prepare(
    "INSERT OR IGNORE INTO installation_repos (installation_id, repo_full_name) VALUES (?, ?)",
  );
  for (const repo of repos) {
    ins.run(installationId, repo);
  }
}

export function removeInstallationRepos(
  installationId: number,
  repos: string[],
): void {
  const del = getDb().prepare(
    "DELETE FROM installation_repos WHERE installation_id = ? AND repo_full_name = ?",
  );
  for (const repo of repos) {
    del.run(installationId, repo);
  }
}

export function getInstallationForRepo(repoFullName: string): number | undefined {
  const row = getDb().prepare(
    "SELECT installation_id FROM installation_repos WHERE repo_full_name = ?",
  ).get(repoFullName) as { installation_id: number } | undefined;
  return row?.installation_id;
}

export function getAllInstallations(): Array<{
  id: number;
  accountLogin: string;
  accountType: string;
}> {
  return getDb().prepare(
    "SELECT id, account_login AS accountLogin, account_type AS accountType FROM installations",
  ).all() as Array<{ id: number; accountLogin: string; accountType: string }>;
}

export function saveBuild(opts: {
  installationId: number | null;
  repoFullName: string;
  prNumber: number;
  sha: string;
}): number {
  const result = getDb().prepare(`
    INSERT INTO builds (installation_id, repo_full_name, pr_number, sha)
    VALUES (?, ?, ?, ?)
  `).run(opts.installationId, opts.repoFullName, opts.prNumber, opts.sha);
  return Number(result.lastInsertRowid);
}

export function updateBuild(
  id: number,
  status: string,
  buildTimeMs?: number,
): void {
  getDb().prepare(`
    UPDATE builds SET status = ?, build_time_ms = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, buildTimeMs ?? null, id);
}
