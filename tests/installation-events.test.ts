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
  startBuildCheckRun: vi.fn().mockResolvedValue(undefined),
  failBuildCheckRun: vi.fn().mockResolvedValue(undefined),
  runCheckRuns: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/cleanup.js", () => ({
  cleanupStalePreviews: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/github-app.js", () => ({
  resolveOctokit: vi.fn().mockResolvedValue({
    rest: {
      issues: { listComments: vi.fn(), createComment: vi.fn(), updateComment: vi.fn() },
      checks: { create: vi.fn(), update: vi.fn() },
    },
  }),
  resolveCloneToken: vi.fn().mockResolvedValue("ghp_test"),
  isAppMode: vi.fn().mockReturnValue(false),
}));

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "test-secret-for-events";

function sign(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

let baseUrl: string;
let server: Server;

describe("Installation Event Handling", () => {
  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "ghp_test";
    process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN ?? "preview.test";
    process.env.DATABASE_PATH = ":memory:";
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

  it("handles installation created event", async () => {
    const payload = {
      action: "created",
      installation: {
        id: 555,
        account: { login: "testorg", type: "Organization" },
      },
      repositories: [
        { full_name: "testorg/app" },
        { full_name: "testorg/api" },
      ],
    };
    const body = JSON.stringify(payload);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "installation",
        "X-GitHub-Delivery": "install-1",
      },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Installation event processed");
  });

  it("handles installation deleted event", async () => {
    const payload = {
      action: "deleted",
      installation: {
        id: 555,
        account: { login: "testorg", type: "Organization" },
      },
    };
    const body = JSON.stringify(payload);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "installation",
        "X-GitHub-Delivery": "install-del-1",
      },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Installation event processed");
  });

  it("handles installation_repositories added event", async () => {
    // First create the installation
    const createPayload = {
      action: "created",
      installation: {
        id: 666,
        account: { login: "org2", type: "Organization" },
      },
      repositories: [{ full_name: "org2/existing" }],
    };
    const createBody = JSON.stringify(createPayload);
    await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(createBody),
        "X-GitHub-Event": "installation",
        "X-GitHub-Delivery": "install-create-2",
      },
      body: createBody,
    });

    // Now add repos
    const payload = {
      action: "added",
      installation: { id: 666 },
      repositories_added: [{ full_name: "org2/new-repo" }],
    };
    const body = JSON.stringify(payload);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "installation_repositories",
        "X-GitHub-Delivery": "repo-add-1",
      },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Repository event processed");
  });

  it("serves setup page", async () => {
    const res = await fetch(`${baseUrl}/setup?installation_id=123&setup_action=install`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Installation successful");
    expect(html).toContain("123");
    expect(html).toContain(".previewbot.yml");
  });

  it("serves setup page without install params", async () => {
    const res = await fetch(`${baseUrl}/setup`);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("GitHub");
  });

  it("shows mode in health endpoint", async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBeDefined();
    expect(["github-app", "legacy-pat"]).toContain(data.mode);
  });
});
