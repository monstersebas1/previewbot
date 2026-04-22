import express from "express";
import PQueue from "p-queue";
import pLimit from "p-limit";
import { config } from "./config.js";
import { verifySignature, commentBuilding, commentLive, commentFailed, commentCleanedUp } from "./github.js";
import { resolveOctokit, resolveCloneToken, isAppMode } from "./github-app.js";
import { getInstallationForRepo, saveInstallation, removeInstallation, setInstallationRepos, addInstallationRepos, removeInstallationRepos, saveBuild, updateBuild, getDb } from "./db.js";
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

interface InstallationWebhookPayload {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      type: string;
    };
  };
  repositories?: Array<{ full_name: string }>;
}

interface InstallationReposWebhookPayload {
  action: string;
  installation: { id: number };
  repositories_added?: Array<{ full_name: string }>;
  repositories_removed?: Array<{ full_name: string }>;
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

function handleInstallationEvent(payload: InstallationWebhookPayload): void {
  const { action, installation, repositories } = payload;
  const { id, account } = installation;

  if (action === "created") {
    saveInstallation(id, account.login, account.type);
    if (repositories) {
      setInstallationRepos(id, repositories.map((r) => r.full_name));
    }
    log.info("App installed", { installationId: id, account: account.login, repos: repositories?.length ?? 0 });
  } else if (action === "deleted") {
    removeInstallation(id);
    log.info("App uninstalled", { installationId: id, account: account.login });
  }
}

function handleInstallationReposEvent(payload: InstallationReposWebhookPayload): void {
  const { action, installation } = payload;

  if (action === "added" && payload.repositories_added) {
    addInstallationRepos(installation.id, payload.repositories_added.map((r) => r.full_name));
    log.info("Repos added to installation", {
      installationId: installation.id,
      repos: payload.repositories_added.map((r) => r.full_name),
    });
  } else if (action === "removed" && payload.repositories_removed) {
    removeInstallationRepos(installation.id, payload.repositories_removed.map((r) => r.full_name));
    log.info("Repos removed from installation", {
      installationId: installation.id,
      repos: payload.repositories_removed.map((r) => r.full_name),
    });
  }
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

  if (delivery && isDuplicateDelivery(delivery)) {
    res.status(200).json({ message: "Duplicate delivery" });
    return;
  }

  if (event === "installation") {
    handleInstallationEvent(req.body as InstallationWebhookPayload);
    res.status(200).json({ message: "Installation event processed" });
    return;
  }

  if (event === "installation_repositories") {
    handleInstallationReposEvent(req.body as InstallationReposWebhookPayload);
    res.status(200).json({ message: "Repository event processed" });
    return;
  }

  if (event !== "pull_request") {
    res.status(200).json({ message: "Ignored event" });
    return;
  }

  const payload = req.body as PRWebhookPayload;
  const { action, number: prNumber } = payload;

  if (!Number.isInteger(prNumber) || prNumber < 1 || prNumber > 60000) {
    res.status(400).json({ error: "Invalid PR number" });
    return;
  }

  const { owner: { login: owner }, name: repo, full_name: fullName } = payload.repository;
  const installationId = payload.installation?.id ?? getInstallationForRepo(fullName);

  if (action === "opened" || action === "synchronize" || action === "reopened") {
    res.status(202).json({ message: "Build queued" });

    buildQueue.add(async () => {
      const startTime = Date.now();
      let buildId: number | undefined;

      try {
        log.info("Build starting", { prNumber, action, repo: fullName, installationId });
        recordBuildStart();

        const octokit = await resolveOctokit(installationId);
        const cloneToken = await resolveCloneToken(installationId);
        const commentOpts = { octokit, owner, repo, prNumber };

        await commentBuilding(commentOpts);

        const sha = payload.pull_request.head.sha;
        buildId = saveBuild({ installationId: installationId ?? null, repoFullName: fullName, prNumber, sha });
        const checkRunId = await startBuildCheckRun({ octokit, owner, repo, sha });

        const result = await buildPreview({
          owner,
          repo,
          prNumber,
          branch: payload.pull_request.head.ref,
          cloneUrl: payload.pull_request.head.repo.clone_url,
          cloneToken,
          installationId,
        });

        if (!result.success) {
          log.error("Build failed", { prNumber, error: result.errorLog });
          recordBuildFailure(result.buildTime * 1000);
          updateBuild(buildId, "failed", result.buildTime * 1000);
          await commentFailed(commentOpts, result.errorLog ?? "Unknown error");
          if (checkRunId) await failBuildCheckRun({ octokit, owner, repo, checkRunId, errorLog: result.errorLog ?? "Unknown error" });
          await destroyPreview(prNumber);
          return;
        }

        await createRoute(prNumber);

        const healthStatus = await waitForHealthy(prNumber);
        log.info("Build complete", { prNumber, healthStatus, duration: result.buildTime });
        recordBuildSuccess(result.buildTime * 1000);

        if (healthStatus === "unhealthy") {
          updateBuild(buildId, "failed", result.buildTime * 1000);
          await commentFailed(commentOpts, "App started but failed health checks (no response after 60s)");
          if (checkRunId) await failBuildCheckRun({ octokit, owner, repo, checkRunId, errorLog: "Health checks failed" });
          await destroyPreview(prNumber);
          await removeRoute(prNumber);
          return;
        }

        updateBuild(buildId, "live", result.buildTime * 1000);

        const url = `https://pr-${prNumber}.${config.previewDomain}`;
        const audit = await runAudits({ previewUrl: url, prNumber, productionUrl: config.productionUrl });

        await commentLive(commentOpts, { buildTime: result.buildTime, healthStatus, audit });
        await runCheckRuns({ octokit, owner, repo, sha, prNumber, checkRunId: checkRunId ?? undefined, audit });
      } catch (err) {
        const elapsed = Date.now() - startTime;
        log.error("Build queue error", { prNumber, repo: fullName, error: String(err) });
        recordBuildFailure(elapsed);
        if (buildId !== undefined) {
          try { updateBuild(buildId, "failed", elapsed); } catch { /* best effort */ }
        }
        try { await destroyPreview(prNumber); } catch { /* best effort */ }
        try { await removeRoute(prNumber); } catch { /* best effort */ }
      }
    });

    return;
  }

  if (action === "closed") {
    res.status(202).json({ message: "Cleanup queued" });

    buildQueue.add(async () => {
      try {
        log.info("Cleaning up preview", { prNumber, repo: fullName });
        await destroyPreview(prNumber);
        await removeRoute(prNumber);
        try {
          const octokit = await resolveOctokit(installationId);
          await commentCleanedUp({ octokit, owner, repo, prNumber });
        } catch (commentErr) {
          log.warn("Failed to post cleanup comment", { prNumber, error: String(commentErr) });
        }
      } catch (err) {
        log.error("Cleanup queue error", { prNumber, repo: fullName, error: String(err) });
      }
    });

    return;
  }

  res.status(200).json({ message: `Ignored action: ${action}` });
});

app.get("/health", (_req, res) => {
  const m = getMetrics();
  res.json({
    status: "ok",
    mode: isAppMode() ? "github-app" : "legacy-pat",
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

app.get("/setup", (req, res) => {
  const rawInstallationId = req.query.installation_id as string | undefined;
  const installationId = escapeHtml(rawInstallationId ?? "unknown");
  const setupAction = req.query.setup_action as string | undefined;

  res.send(`<!DOCTYPE html>
<html>
<head><title>PreviewBot — Setup</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  .success { color: #16a34a; }
  .info { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 24px 0; }
  code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  a { color: #2563eb; }
</style>
</head>
<body>
  <h1>PreviewBot</h1>
  ${setupAction === "install"
    ? `<p class="success">Installation successful!</p>
       <div class="info">
         <p>Installation ID: <code>${installationId}</code></p>
         <p>PreviewBot is now active on your selected repositories. Open a pull request to see it in action.</p>
       </div>
       <p>To configure environment variables for your previews, add a <code>.previewbot.yml</code> file to your repo root:</p>
       <pre><code>framework: nextjs
env:
  NEXT_PUBLIC_API_URL: "{{preview_url}}/api"</code></pre>`
    : `<p>Visit <a href="https://github.com/apps/previewbot">GitHub</a> to install PreviewBot.</p>`
  }
</body>
</html>`);
});

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
  getDb();
  app.listen(config.port, () => {
    log.info("PreviewBot running", {
      port: config.port,
      domain: config.previewDomain,
      mode: isAppMode() ? "github-app" : "legacy-pat",
    });
  });
}

export { app };
