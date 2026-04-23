import express from "express";
import PQueue from "p-queue";
import pLimit from "p-limit";
import { config } from "./config.js";
import { verifySignature, commentBuilding, commentLive, commentFailed, commentCleanedUp } from "./github.js";
import { saveInstallation, deleteInstallation, addRepos, removeRepos } from "./installation-db.js";
import { buildPreview, destroyPreview } from "./builder.js";
import { createRoute, removeRoute } from "./nginx.js";
import { waitForHealthy } from "./health.js";
import { cleanupStalePreviews } from "./cleanup.js";
import { startBuildCheckRun, failBuildCheckRun, runCheckRuns } from "./check-runs.js";
import type { AuditReport, PathAuditResult } from "./audit-types.js";
import { log } from "./logger.js";
import { recordBuildStart, recordBuildSuccess, recordBuildFailure, recordCleanup, getMetrics } from "./metrics.js";

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
  installation?: { id: number };
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

interface InstallationPayload {
  action: string;
  installation: {
    id: number;
    account: { login: string; type: string };
  };
  repositories?: Array<{ full_name: string }>;
}

interface InstallationReposPayload {
  action: "added" | "removed";
  installation: { id: number };
  repositories_added?: Array<{ full_name: string }>;
  repositories_removed?: Array<{ full_name: string }>;
}

function parseRepos(list: Array<{ full_name: string }>): Array<{ owner: string; repo: string }> {
  return list.map(({ full_name }) => {
    const [owner, repo] = full_name.split("/");
    return { owner, repo };
  });
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
        log.error(`Lighthouse failed for ${path}`, { error: String(err) });
        return undefined;
      }
    })),
    withTimeout(chromeLimiter(async () => {
      try {
        const { runAccessibilityAudit } = await import("./accessibility.js");
        return await runAccessibilityAudit(fullPreviewUrl);
      } catch (err) {
        log.error(`axe-core failed for ${path}`, { error: String(err) });
        return undefined;
      }
    })),
    withTimeout(chromeLimiter(async () => {
      try {
        const { runVisualDiff } = await import("./visual-diff.js");
        return await runVisualDiff({ previewUrl: fullPreviewUrl, productionUrl: fullProductionUrl, prNumber });
      } catch (err) {
        log.error(`Visual diff failed for ${path}`, { error: String(err) });
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

  if (event === "installation") {
    const payload = req.body as InstallationPayload;
    const { action, installation, repositories } = payload;

    if (action === "created") {
      saveInstallation(
        installation.id,
        installation.account.login,
        installation.account.type,
        repositories ? parseRepos(repositories) : [],
      );
      log.info("App installed", { installationId: installation.id, account: installation.account.login });
    } else if (action === "deleted") {
      deleteInstallation(installation.id);
      log.info("App uninstalled", { installationId: installation.id });
    }

    res.status(200).json({ message: `Installation ${action}` });
    return;
  }

  if (event === "installation_repositories") {
    const payload = req.body as InstallationReposPayload;
    const { action, installation, repositories_added, repositories_removed } = payload;

    if (action === "added" && repositories_added?.length) {
      addRepos(installation.id, parseRepos(repositories_added));
      log.info("Repos added to installation", { installationId: installation.id, count: repositories_added.length });
    } else if (action === "removed" && repositories_removed?.length) {
      removeRepos(installation.id, parseRepos(repositories_removed));
      log.info("Repos removed from installation", { installationId: installation.id, count: repositories_removed.length });
    }

    res.status(200).json({ message: `Repos ${action}` });
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
  const installationId = payload.installation?.id;

  if (!Number.isInteger(prNumber) || prNumber < 1 || prNumber > 60000) {
    res.status(400).json({ error: "Invalid PR number" });
    return;
  }

  const { owner: { login: owner }, name: repo, full_name: fullName } = payload.repository;
  const opts = { owner, repo, prNumber, installationId };

  if (action === "opened" || action === "synchronize" || action === "reopened") {
    res.status(202).json({ message: "Build queued" });

    buildQueue.add(async () => {
      log.info("Build starting", { prNumber, action, repo: fullName });
      recordBuildStart();

      await commentBuilding(opts);

      const sha = payload.pull_request.head.sha;
      const checkRunId = await startBuildCheckRun({ owner, repo, sha, installationId });

      const result = await buildPreview({
        owner,
        repo,
        prNumber,
        branch: payload.pull_request.head.ref,
        cloneUrl: payload.pull_request.head.repo.clone_url,
      });

      if (!result.success) {
        log.error("Build failed", { prNumber, error: result.errorLog });
        recordBuildFailure(result.buildTime * 1000);
        await commentFailed(opts, result.errorLog ?? "Unknown error");
        if (checkRunId) await failBuildCheckRun({ owner, repo, checkRunId, errorLog: result.errorLog ?? "Unknown error", installationId });
        await destroyPreview(prNumber);
        return;
      }

      await createRoute(prNumber);

      const healthStatus = await waitForHealthy(prNumber);
      log.info("Build complete", { prNumber, healthStatus, duration: result.buildTime });
      recordBuildSuccess(result.buildTime * 1000);

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
      await runCheckRuns({ owner, repo, sha, prNumber, checkRunId: checkRunId ?? undefined, audit, installationId });
    });

    return;
  }

  if (action === "closed") {
    res.status(202).json({ message: "Cleanup queued" });

    buildQueue.add(async () => {
      log.info("Cleaning up preview", { prNumber, repo: fullName });
      await destroyPreview(prNumber);
      await removeRoute(prNumber);
      await commentCleanedUp(opts);
    });

    return;
  }

  res.status(200).json({ message: `Ignored action: ${action}` });
});

app.get("/health", (_req, res) => {
  const m = getMetrics();
  res.json({
    status: "ok",
    queue: { size: buildQueue.size, pending: buildQueue.pending },
    uptime: process.uptime(),
    totalBuilds: m.totalBuilds,
    successCount: m.successCount,
    failCount: m.failCount,
    avgBuildTimeMs: m.avgBuildTimeMs,
    lastCleanupAt: m.lastCleanupAt,
    queueDepth: buildQueue.size + buildQueue.pending,
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
    log.info("Running stale preview cleanup");
    try {
      const cleaned = await cleanupStalePreviews();
      recordCleanup();
      if (cleaned.length > 0) {
        log.info("Cleanup removed previews", { removed: cleaned.join(", ") });
      }
    } catch (err) {
      log.error("Cleanup error", { error: String(err) });
    }
  });
}, 6 * 60 * 60 * 1000);

if (process.env.NODE_ENV !== "test") {
  app.listen(config.port, () => {
    log.info("PreviewBot running", { port: config.port, domain: config.previewDomain });
  });
}

export { app };
