import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { writeFile, readFile, unlink, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFile: (...fnArgs: unknown[]) => {
      const cmd = fnArgs[0] as string;
      if (cmd === "nginx") {
        const cb = fnArgs[fnArgs.length - 1];
        if (typeof cb === "function") cb(null, "", "");
        return;
      }
      return (original.execFile as Function)(...fnArgs);
    },
  };
});

describe("Nginx Config Integration", () => {
  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "previewbot-nginx-"));
    process.env.NGINX_CONF_DIR = tmpDir;
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "ghp_test";
    process.env.GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret";
    process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN ?? "preview.test";
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and removes nginx config for a PR", async () => {
    const { createRoute, removeRoute } = await import("../../src/nginx.js");

    await createRoute(999);

    const confPath = path.join(tmpDir, "preview-pr-999.conf");
    const content = await readFile(confPath, "utf-8");

    expect(content).toContain("server_name pr-999.preview.test");
    expect(content).toContain("proxy_pass http://127.0.0.1:4999");
    expect(content).toContain("listen 80");
    expect(content).toContain("proxy_http_version 1.1");

    await removeRoute(999);

    let exists = true;
    try {
      await readFile(confPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
