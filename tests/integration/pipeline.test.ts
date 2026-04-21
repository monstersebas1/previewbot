import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Server } from "node:http";

const execAsync = promisify(exec);

const WEBHOOK_SECRET = "pipeline-test-secret";
const CONTAINER_NAME = "preview-pr-55555";

let buildPreviewMock: ReturnType<typeof vi.fn>;
let destroyPreviewMock: ReturnType<typeof vi.fn>;
let createRouteMock: ReturnType<typeof vi.fn>;
let removeRouteMock: ReturnType<typeof vi.fn>;
let waitForHealthyMock: ReturnType<typeof vi.fn>;
let commentBuildingMock: ReturnType<typeof vi.fn>;
let commentLiveMock: ReturnType<typeof vi.fn>;
let commentFailedMock: ReturnType<typeof vi.fn>;
let commentCleanedUpMock: ReturnType<typeof vi.fn>;
let startBuildCheckRunMock: ReturnType<typeof vi.fn>;
let runCheckRunsMock: ReturnType<typeof vi.fn>;

buildPreviewMock = vi.fn().mockResolvedValue({ success: true, buildTime: 3 });
destroyPreviewMock = vi.fn().mockResolvedValue(undefined);
createRouteMock = vi.fn().mockResolvedValue(undefined);
removeRouteMock = vi.fn().mockResolvedValue(undefined);
waitForHealthyMock = vi.fn().mockResolvedValue("healthy");
commentBuildingMock = vi.fn().mockResolvedValue(undefined);
commentLiveMock = vi.fn().mockResolvedValue(undefined);
commentFailedMock = vi.fn().mockResolvedValue(undefined);
commentCleanedUpMock = vi.fn().mockResolvedValue(undefined);
startBuildCheckRunMock = vi.fn().mockResolvedValue("check-run-1");
runCheckRunsMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/builder.js", () => ({
  buildPreview: buildPreviewMock,
  destroyPreview: destroyPreviewMock,
}));

vi.mock("../../src/nginx.js", () => ({
  createRoute: createRouteMock,
  removeRoute: removeRouteMock,
}));

vi.mock("../../src/health.js", () => ({
  waitForHealthy: waitForHealthyMock,
}));

vi.mock("../../src/github.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/github.js")>();
  return {
    ...original,
    commentBuilding: commentBuildingMock,
    commentLive: commentLiveMock,
    commentFailed: commentFailedMock,
    commentCleanedUp: commentCleanedUpMock,
  };
});

vi.mock("../../src/check-runs.js", () => ({
  startBuildCheckRun: startBuildCheckRunMock,
  failBuildCheckRun: vi.fn().mockResolvedValue(undefined),
  runCheckRuns: runCheckRunsMock,
}));

vi.mock("../../src/cleanup.js", () => ({
  cleanupStalePreviews: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lighthouse.js", () => ({
  runLighthouse: vi.fn().mockResolvedValue({ performance: 95 }),
}));

vi.mock("../../src/accessibility.js", () => ({
  runAccessibilityAudit: vi.fn().mockResolvedValue({ violations: [] }),
}));

vi.mock("../../src/visual-diff.js", () => ({
  runVisualDiff: vi.fn().mockResolvedValue({ diffPercent: 0 }),
}));

function sign(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

let baseUrl: string;
let server: Server;

async function waitForQueueDrain(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json() as { queueDepth: number };
    if (data.queueDepth === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Queue did not drain in 30s");
}

describe("Full Pipeline Smoke Test", () => {
  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "ghp_test";
    process.env.PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN ?? "preview.test";
    process.env.NODE_ENV = "test";
    process.env.AUDIT_TIMEOUT = "1";

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

  it("runs the full open → build → comment pipeline", async () => {
    const payload = {
      action: "opened",
      number: 55555,
      pull_request: {
        head: {
          sha: "abc123pipeline",
          ref: "feat/pipeline-test",
          repo: { clone_url: "https://github.com/test/pipeline.git" },
        },
      },
      repository: {
        owner: { login: "test" },
        name: "pipeline",
        full_name: "test/pipeline",
      },
    };

    const body = JSON.stringify(payload);
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "pipeline-delivery-1",
      },
      body,
    });

    expect(res.status).toBe(202);

    await waitForQueueDrain();

    expect(commentBuildingMock).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 55555 }),
    );
    expect(buildPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 55555,
        branch: "feat/pipeline-test",
      }),
    );
    expect(createRouteMock).toHaveBeenCalledWith(55555);
    expect(waitForHealthyMock).toHaveBeenCalledWith(55555);
    expect(startBuildCheckRunMock).toHaveBeenCalled();
    expect(commentLiveMock).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 55555 }),
      expect.objectContaining({ buildTime: 3, healthStatus: "healthy" }),
    );
    expect(runCheckRunsMock).toHaveBeenCalled();
  }, 300_000);

  it("runs the close → cleanup pipeline", async () => {
    const payload = {
      action: "closed",
      number: 55556,
      pull_request: {
        head: {
          sha: "def456",
          ref: "feat/close-test",
          repo: { clone_url: "https://github.com/test/pipeline.git" },
        },
      },
      repository: {
        owner: { login: "test" },
        name: "pipeline",
        full_name: "test/pipeline",
      },
    };

    const body = JSON.stringify(payload);
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(body),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "pipeline-delivery-close",
      },
      body,
    });

    expect(res.status).toBe(202);

    await waitForQueueDrain();

    expect(destroyPreviewMock).toHaveBeenCalledWith(55556);
    expect(removeRouteMock).toHaveBeenCalledWith(55556);
    expect(commentCleanedUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 55556 }),
    );
  }, 300_000);
});
