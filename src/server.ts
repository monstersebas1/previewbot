import express from "express";
import PQueue from "p-queue";
import pLimit from "p-limit";
import { config } from "./config.js";
import { verifySignature, commentBuilding, commentLive, commentFailed, commentCleanedUp } from "./github.js";
import { buildPreview, destroyPreview } from "./builder.js";
import { createRoute, removeRoute } from "./nginx.js";
import { waitForHealthy } from "./health.js";
import { cleanupStalePreviews } from "./cleanup.js";
import { startBuildCheckRun, failBuildCheckRun, runCheckRuns } from "./check-runs.js";
import type { AuditReport, PathAuditResult } from "./audit-types.js";

const app = express();
const buildQueue = new PQueue({ concurrency: 1 });
const chromeLimiter = pLimit(2);
const seenDeliveries = new Map<string, number>();
const DELIVERY_TTL_MS = 10 * 60 * 1000;

function isDuplicateDelivery(id: string): boolean {
  const now = Date.now();
  for (const [key, ts] of seenDeliveries) {
    if (now - ts > DELIVERY_TTL_MS) seenDeliveries.delete(key);
  }
  if (seenDeliveries.has(id)) return true;
  seenDeliveries.set(id, now);
  if (seenDeliveries.size > 1000) {
    const oldest = seenDeliveries.keys().next().value;
    if (oldest) seenDeliveries.delete(oldest);
  }
  return false;
}

app.use(express.json({
  verify: (req, _res, buf) => {
    (req as unknown as Record<string, string>).rawBody = buf.toString("utf-8");
  },
}));

interface PRWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    head: {
      sha: string;
      ref: string;
      repo: {
        clone_url: string;
      };
    };
  };
  repository: {
    owner: { login: string };
    name: string;
    full_name: string;
  };
}

function buildFullUrl(baseUrl: string, path: string): string {
  if (path === "/") return baseUrl;
  const base = baseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function makeWithTimeout(timeout: number) {
  return <T>(promise: Promise<T>): Promise<T | undefined> =>
    Promise.race([
      promise,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeout)),
    ]);
}

async function auditPath(
  path: string,
  previewUrl: string,
  productionUrl: string | undefined,
  prNumber: number,
  withTimeout: <T>(p: Promise<T>) => Promise<T | undefined>,
): Promise<PathAuditResult> {
  const fullPreviewUrl = buildFullUrl(previewUrl, path);
  const fullProductionUrl = productionUrl ? buildFullUrl(productionUrl, path) : undefined;

  const [lighthouseResult, axeResult, visualDiffResult] = await Promise.all([
    withTimeout(chromeLimiter(async () => {
      try {
        const { runLighthouse } = await import("./lighthouse.js");
        return await runLighthouse({ url: fullPreviewUrl, productionUrl: fullProductionUrl, prNumber });
      } catch (err) {
        console.error(`[Audit] Lighthouse failed for ${path}:`, err);
        return undefined;
      }
    })),
    withTimeout(chromeLimiter(async () => {
      try {
        const { runAccessibilityAudit } = await import("./accessibility.js");
        return await runAccessibilityAudit(fullPreviewUrl);
      } catch (err) {
        console.error(`[Audit] axe-core failed for ${path}:`, err);
        return undefined;
      }
    })),
    withTimeout(chromeLimiter(async () => {
      try {
        const { runVisualDiff } = await import("./visual-diff.js");
        return await runVisualDiff({ previewUrl: fullPreviewUrl, productionUrl: fullProductionUrl, prNumber });
      } catch (err) {
        console.error(`[Audit] Visual diff failed for ${path}:`, err);
        return undefined;
      }
    })),
  ]);

  return {
    path,
    lighthouse: lighthouseResult ?? undefined,
    axe: axeResult ?? undefined,
    visualDiff: visualDiffResult ?? undefined,
  };
}

interface RunAuditsOptions {
  previewUrl: string;
  prNumber: number;
  productionUrl?: string;
}

async function runAudits({ previewUrl, prNumber, productionUrl }: RunAuditsOptions): Promise<AuditReport | undefined> {
  const withTimeout = makeWithTimeout(config.auditTimeout * 1000);

  const pathResults = await Promise.allSettled(
    config.auditPaths.map((path) => auditPath(path, previewUrl, productionUrl, prNumber, withTimeout)),
  );

  const report: AuditReport = {
    paths: pathResults.map((r) => (r.status === "fulfilled" ? r.value : { path: "", lighthouse: undefined, axe: undefined, visualDiff: undefined })),
    timestamp: new Date().toISOString(),
    previewUrl,
    productionUrl,
  };

  // Backwards compat: populate top-level fields from the first path
  const firstPath = report.paths[0];
  if (firstPath) {
    report.lighthouse = firstPath.lighthouse;
    report.axe = firstPath.axe;
    report.visualDiff = firstPath.visualDiff;
  }

  if (!report.lighthouse && !report.axe && !report.visualDiff) {
    return undefined;
  }

  return report;
}

app.post("/webhook", (req, res) => {
  const signature = req.headers["x-hub-signature-256"] as string | undefined;
  const delivery = req.headers["x-github-delivery"] as string | undefined;
  const event = req.headers["x-github-event"] as string | undefined;
  const rawBody = (req as unknown as Record<string, string>).rawBody;

  if (!signature || !rawBody || !verifySignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  if (event !== "pull_request") {
    res.status(200).json({ message: "Ignored event" });
    return;
  }

  if (delivery && isDuplicateDelivery(delivery)) {
    res.status(200).json({ message: "Duplicate delivery" });
    return;
  }

  const payload = req.body as PRWebhookPayload;
  const { action, number: prNumber } = payload;

  if (!Number.isInteger(prNumber) || prNumber < 1 || prNumber > 60000) {
    res.status(400).json({ error: "Invalid PR number" });
    return;
  }

  const { owner: { login: owner }, name: repo, full_name: fullName } = payload.repository;
  const opts = { owner, repo, prNumber };

  if (action === "opened" || action === "synchronize" || action === "reopened") {
    res.status(202).json({ message: "Build queued" });

    buildQueue.add(async () => {
      console.log(`[PR #${prNumber}] Build starting for ${fullName}`);

      await commentBuilding(opts);

      const sha = payload.pull_request.head.sha;
      const checkRunId = await startBuildCheckRun({ owner, repo, sha });

      const result = await buildPreview({
        owner,
        repo,
        prNumber,
        branch: payload.pull_request.head.ref,
        cloneUrl: payload.pull_request.head.repo.clone_url,
      });

      if (!result.success) {
        console.error(`[PR #${prNumber}] Build failed: ${result.errorLog}`);
        await commentFailed(opts, result.errorLog ?? "Unknown error");
        if (checkRunId) await failBuildCheckRun({ owner, repo, checkRunId, errorLog: result.errorLog ?? "Unknown error" });
        await destroyPreview(prNumber);
        return;
      }

      await createRoute(prNumber);

      const healthStatus = await waitForHealthy(prNumber);
      console.log(`[PR #${prNumber}] Health: ${healthStatus}, built in ${result.buildTime}s`);

      if (healthStatus === "unhealthy") {
        await commentFailed(opts, "App started but failed health checks (no response after 60s)");
        if (checkRunId) await failBuildCheckRun({ owner, repo, checkRunId, errorLog: "Health checks failed" });
        await destroyPreview(prNumber);
        await removeRoute(prNumber);
        return;
      }

      const url = `https://pr-${prNumber}.${config.previewDomain}`;
      const audit = await runAudits({ previewUrl: url, prNumber, productionUrl: config.productionUrl });

      await commentLive(opts, { buildTime: result.buildTime, healthStatus, audit });
      await runCheckRuns({ owner, repo, sha, prNumber, checkRunId: checkRunId ?? undefined, audit });
    });

    return;
  }

  if (action === "closed") {
    res.status(202).json({ message: "Cleanup queued" });

    buildQueue.add(async () => {
      console.log(`[PR #${prNumber}] Cleaning up preview for ${fullName}`);
      await destroyPreview(prNumber);
      await removeRoute(prNumber);
      await commentCleanedUp(opts);
    });

    return;
  }

  res.status(200).json({ message: `Ignored action: ${action}` });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    queue: { size: buildQueue.size, pending: buildQueue.pending },
    uptime: process.uptime(),
  });
});

app.get("/previews", async (_req, res) => {
  try {
    const { exec: execCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execCb);

    const { stdout } = await execAsync(
      `docker ps --filter "label=preview.pr" --format "{{.Names}}|{{.Label \\"preview.pr\\"}}|{{.Label \\"preview.repo\\"}}|{{.Label \\"preview.created\\"}}|{{.Status}}"`,
    );

    const previews = stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [name, pr, repo, created, status] = line.split("|");
      return { name, prNumber: parseInt(pr, 10), repo, created, status };
    });

    res.json({ previews });
  } catch {
    res.json({ previews: [] });
  }
});

// Cleanup cron: run every 6 hours — routed through buildQueue to prevent concurrent nginx writes
setInterval(() => {
  buildQueue.add(async () => {
    console.log("[Cleanup] Running stale preview cleanup...");
    try {
      const cleaned = await cleanupStalePreviews();
      if (cleaned.length > 0) {
        console.log(`[Cleanup] Removed: ${cleaned.join(", ")}`);
      }
    } catch (err) {
      console.error("[Cleanup] Error:", err);
    }
  });
}, 6 * 60 * 60 * 1000);

app.listen(config.port, () => {
  console.log(`PreviewBot running on port ${config.port}`);
  console.log(`Preview domain: *.${config.previewDomain}`);
  console.log(`Build queue concurrency: 1`);
});
