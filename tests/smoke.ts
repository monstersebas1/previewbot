import crypto from "node:crypto";

const BASE = "http://localhost:3500";
const WEBHOOK_SECRET = "test-secret-for-smoke-test";

function sign(payload: string): string {
  return `sha256=${crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

async function run(): Promise<void> {
  console.log("\nPreviewBot Smoke Tests\n");

  // 1. Health endpoint
  await test("GET /health returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    assert(body.status === "ok", `Expected status ok, got ${body.status}`);
    assert(typeof body.uptime === "number", "Missing uptime");
    console.log(`        uptime: ${body.uptime}s, queue: ${JSON.stringify(body.queue)}`);
  });

  // 2. Previews endpoint
  await test("GET /previews returns array", async () => {
    const res = await fetch(`${BASE}/previews`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    assert(Array.isArray(body.previews), "Expected previews array");
  });

  // 3. Reject missing signature
  await test("POST /webhook rejects missing signature", async () => {
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // 4. Reject bad signature
  await test("POST /webhook rejects invalid signature", async () => {
    const payload = JSON.stringify({ action: "opened" });
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=bad",
        "X-GitHub-Event": "pull_request",
      },
      body: payload,
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // 5. Accept valid signature, ignore non-PR events
  await test("POST /webhook ignores non-PR events with valid signature", async () => {
    const payload = JSON.stringify({ action: "completed" });
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Event": "check_run",
        "X-GitHub-Delivery": "test-delivery-1",
      },
      body: payload,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, string>;
    assert(body.message === "Ignored event", `Expected 'Ignored event', got '${body.message}'`);
  });

  // 6. Accept valid PR webhook (will queue build — build will fail without Docker, that's expected)
  await test("POST /webhook accepts valid PR open event (returns 202)", async () => {
    const payload = JSON.stringify({
      action: "opened",
      number: 999,
      pull_request: {
        head: {
          ref: "test-branch",
          repo: { clone_url: "https://github.com/test/test.git" },
        },
      },
      repository: {
        owner: { login: "test-owner" },
        name: "test-repo",
        full_name: "test-owner/test-repo",
      },
    });

    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-2",
      },
      body: payload,
    });
    assert(res.status === 202, `Expected 202, got ${res.status}`);
    const body = await res.json() as Record<string, string>;
    assert(body.message === "Build queued", `Expected 'Build queued', got '${body.message}'`);
  });

  // 7. Deduplication
  await test("POST /webhook deduplicates same delivery ID", async () => {
    const payload = JSON.stringify({
      action: "opened",
      number: 998,
      pull_request: {
        head: {
          ref: "test-branch-2",
          repo: { clone_url: "https://github.com/test/test.git" },
        },
      },
      repository: {
        owner: { login: "test-owner" },
        name: "test-repo",
        full_name: "test-owner/test-repo",
      },
    });

    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-2",
      },
      body: payload,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, string>;
    assert(body.message === "Duplicate delivery", `Expected 'Duplicate delivery', got '${body.message}'`);
  });

  // 8. Cleanup event returns 202
  await test("POST /webhook accepts PR close event (returns 202)", async () => {
    const payload = JSON.stringify({
      action: "closed",
      number: 997,
      pull_request: {
        head: {
          ref: "test-branch-3",
          repo: { clone_url: "https://github.com/test/test.git" },
        },
      },
      repository: {
        owner: { login: "test-owner" },
        name: "test-repo",
        full_name: "test-owner/test-repo",
      },
    });

    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-3",
      },
      body: payload,
    });
    assert(res.status === 202, `Expected 202, got ${res.status}`);
    const body = await res.json() as Record<string, string>;
    assert(body.message === "Cleanup queued", `Expected 'Cleanup queued', got '${body.message}'`);
  });

  // 9. Ignored action
  await test("POST /webhook ignores unhandled PR actions", async () => {
    const payload = JSON.stringify({
      action: "labeled",
      number: 996,
      pull_request: {
        head: {
          ref: "test-branch-4",
          repo: { clone_url: "https://github.com/test/test.git" },
        },
      },
      repository: {
        owner: { login: "test-owner" },
        name: "test-repo",
        full_name: "test-owner/test-repo",
      },
    });

    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sign(payload),
        "X-GitHub-Event": "pull_request",
        "X-GitHub-Delivery": "test-delivery-4",
      },
      body: payload,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json() as Record<string, string>;
    assert(body.message === "Ignored action: labeled", `Unexpected: ${body.message}`);
  });

  console.log("\nDone.\n");
}

run().catch(console.error);
