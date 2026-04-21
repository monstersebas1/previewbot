import express from "express";
import PQueue from "p-queue";
import { config } from "./config.js";
import { verifySignature, commentBuilding, commentLive, commentFailed, commentCleanedUp } from "./github.js";
import { buildPreview, destroyPreview } from "./builder.js";
import { createRoute, removeRoute } from "./nginx.js";
import { waitForHealthy } from "./health.js";
import { cleanupStalePreviews } from "./cleanup.js";
import type { AuditReport } from "./audit-types.js";

const app = express();
const buildQueue = new PQueue({ concurrency: 1 });
const seenDeliveries = new Set<string>();

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

async function runAudits(previewUrl: string, productionUrl?: string): Promise<AuditReport | undefined> {
  const timeout = config.auditTimeout * 1000;
  const report: AuditReport = { timestamp: new Date().toISOString(), previewUrl, productionUrl };

  const withTimeout = <T>(promise: Promise<T>): Promise<T | undefined> =>
    Promise.race([
      promise,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeout)),
    ]);

  const [lighthouseResult, axeResult] = await Promise.all([
    withTimeout((async () => {
      try {
        const { runLighthouse } = await import("./lighthouse.js");
        return await runLighthouse(previewUrl, productionUrl);
      } catch (err) {
        console.error("[Audit] Lighthouse failed:", err);
        return undefined;
      }
    })()),
    withTimeout((async () => {
      try {
        const { runAccessibilityAudit } = await import("./accessibility.js");
        return await runAccessibilityAudit(previewUrl);
      } catch (err) {
        console.error("[Audit] axe-core failed:", err);
        return undefined;
      }
    })()),
  ]);

  report.lighthouse = lighthouseResult ?? undefined;
  report.axe = axeResult ?? undefined;

  if (!report.lighthouse && !report.axe) {
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

  if (delivery && seenDeliveries.has(delivery)) {
    res.status(200).json({ message: "Duplicate delivery" });
    return;
  }

  if (delivery) {
    seenDeliveries.add(delivery);
    if (seenDeliveries.size > 1000) {
      const oldest = seenDeliveries.values().next().value;
      if (oldest) seenDeliveries.delete(oldest);
    }
  }

  const payload = req.body as PRWebhookPayload;
  const { action, number: prNumber } = payload;
  const { owner: { login: owner }, name: repo, full_name: fullName } = payload.repository;
  const opts = { owner, repo, prNumber };

  if (action === "opened" || action === "synchronize" || action === "reopened") {
    res.status(202).json({ message: "Build queued" });

    buildQueue.add(async () => {
      console.log(`[PR #${prNumber}] Build starting for ${fullName}`);

      await commentBuilding(opts);

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
        await destroyPreview(prNumber);
        return;
      }

      await createRoute(prNumber);

      const healthStatus = await waitForHealthy(prNumber);
      console.log(`[PR #${prNumber}] Health: ${healthStatus}, built in ${result.buildTime}s`);

      if (healthStatus === "unhealthy") {
        await commentFailed(opts, "App started but failed health checks (no response after 60s)");
        await destroyPreview(prNumber);
        await removeRoute(prNumber);
        return;
      }

      const url = `https://pr-${prNumber}.${config.previewDomain}`;
      const audit = await runAudits(url, config.productionUrl);

      await commentLive(opts, { buildTime: result.buildTime, healthStatus, audit });
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

// Cleanup cron: run every 6 hours
setInterval(async () => {
  console.log("[Cleanup] Running stale preview cleanup...");
  try {
    const cleaned = await cleanupStalePreviews();
    if (cleaned.length > 0) {
      console.log(`[Cleanup] Removed: ${cleaned.join(", ")}`);
    }
  } catch (err) {
    console.error("[Cleanup] Error:", err);
  }
}, 6 * 60 * 60 * 1000);

app.listen(config.port, () => {
  console.log(`PreviewBot running on port ${config.port}`);
  console.log(`Preview domain: *.${config.previewDomain}`);
  console.log(`Build queue concurrency: 1`);
});
