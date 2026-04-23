import Database from "better-sqlite3";
import { config } from "./config.js";

let _db: InstanceType<typeof Database> | null = null;

function getDb(): InstanceType<typeof Database> {
  if (!_db) {
    _db = new Database(config.dbPath);
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY,
        account_login TEXT NOT NULL,
        account_type TEXT NOT NULL,
        installed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS installation_repos (
        installation_id INTEGER NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        PRIMARY KEY (installation_id, owner, repo)
      );
      CREATE INDEX IF NOT EXISTS idx_installation_repos_repo
        ON installation_repos(owner, repo);
    `);
  }
  return _db;
}

export function saveInstallation(
  id: number,
  accountLogin: string,
  accountType: string,
  repos: Array<{ owner: string; repo: string }>,
): void {
  const db = getDb();
  const upsertInstallation = db.prepare(
    `INSERT OR REPLACE INTO installations (id, account_login, account_type, installed_at)
     VALUES (?, ?, ?, ?)`,
  );
  const insertRepo = db.prepare(
    `INSERT OR IGNORE INTO installation_repos (installation_id, owner, repo)
     VALUES (?, ?, ?)`,
  );

  db.transaction(() => {
    upsertInstallation.run(id, accountLogin, accountType, Date.now());
    for (const { owner, repo } of repos) {
      insertRepo.run(id, owner, repo);
    }
  })();
}

export function deleteInstallation(id: number): void {
  getDb().prepare(`DELETE FROM installations WHERE id = ?`).run(id);
}

export function addRepos(
  installationId: number,
  repos: Array<{ owner: string; repo: string }>,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO installation_repos (installation_id, owner, repo)
     VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    for (const { owner, repo } of repos) {
      stmt.run(installationId, owner, repo);
    }
  })();
}

export function removeRepos(
  installationId: number,
  repos: Array<{ owner: string; repo: string }>,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `DELETE FROM installation_repos
     WHERE installation_id = ? AND owner = ? AND repo = ?`,
  );
  db.transaction(() => {
    for (const { owner, repo } of repos) {
      stmt.run(installationId, owner, repo);
    }
  })();
}

export function getInstallationForRepo(owner: string, repo: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT installation_id FROM installation_repos
       WHERE owner = ? AND repo = ? LIMIT 1`,
    )
    .get(owner, repo) as { installation_id: number } | undefined;
  return row?.installation_id ?? null;
}

export function listReposForInstallation(
  installationId: number,
): Array<{ owner: string; repo: string }> {
  return getDb()
    .prepare(`SELECT owner, repo FROM installation_repos WHERE installation_id = ?`)
    .all(installationId) as Array<{ owner: string; repo: string }>;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
