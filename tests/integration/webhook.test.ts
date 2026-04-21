import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import type { Server } from "node:http";

vi.mock("../../src/builder.js", () => ({
  buildPreview: vi.fn().mockResolvedValue({ success: true, buildTime: 5 }),
  destroyPreview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/nginx.js", () => ({
  createRoute: vi.fn().mockResolvedValue(undefined),
  removeRoute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/health.js", () => ({
  waitForHealthy: vi.fn().mockResolvedValue("healthy"),
}));

vi.mock("../../src/github.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/github.js")>();
  return {
    ...original,
    commentBuilding: vi.fn().mockResolvedValue(undefined),
    commentLive: vi.fn().mockResolvedValue(undefined),
    commentFailed: vi.fn().mockResolvedValue(undefined),
    commentCleanedUp: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/check-runs.js", () => ({
  startBuildCheckRun: vi.fn().mockResolvedValue("check-1"),
  failBuildCheckRun: vi.fn().mockResolvedValue(undefined),
  runCheckRuns: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/cleanup.js", () => ({
  cleanupStalePreviews: vi.fn().mockResolvedValue([]),
}));

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret-for-integration";

function sign(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    number: 42,
    pull_request: {
      head: {
        sha: "abc123",
        ref: "feat/test",
        repo: { clone_url: "https://github.com/test/repo.git" },
      },
    },
    repository: {
      owner: { login: "test" },
      name: "repo",
      full_name: "test/repo",
    },
    ...overrides,
  };
}

let baseUrl: string;
let server: Server;

describe("Webhook Handler Integration", () => {
  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "ghp_test";
    process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN ?? "preview.test";
    process.env.NODE_ENV = "test";

    const { app } = await import("../../src/server.js");
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("returns 202 for a valid opened webhook", async () => {
    const body = JSON.stringify(makePayload());
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "delivery-1",
      },
      body,
    });

    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.message).toBe("Build queued");
  });

  it("rejects duplicate delivery", async () => {
    const body = JSON.stringify(makePayload());
    const headers = {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sign(body),
      "X-GitHub-Event": "pull_request",
      "X-GitHub-Delivery": "delivery-dup",
    };

    await fetch(`${baseUrl}/webhook`, { method: "POST", headers, body });
    const res = await fetch(`${baseUrl}/webhook`, { method: "POST", headers, body });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Duplicate delivery");
  });

  it("returns 401 for invalid signature", async () => {
    const body = JSON.stringify(makePayload());
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=invalid",
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "delivery-bad-sig",
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid PR number", async () => {
    const body = JSON.stringify(makePayload({ number: -1 }));
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "delivery-bad-pr",
      },
      body,
    });

    expect(res.status).toBe(400);
  });

  it("ignores non-pull_request events", async () => {
    const body = JSON.stringify({ action: "created" });
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": "delivery-issues",
      },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Ignored event");
  });

  it("returns 202 for close action and queues cleanup", async () => {
    const body = JSON.stringify(makePayload({ action: "closed", number: 99 }));
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "delivery-close",
      },
      body,
    });

    expect(res.status).toBe(202);
    const data = await res.json();
    expect(data.message).toBe("Cleanup queued");
  });
});
