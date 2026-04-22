import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getPRState } from "./github.js";
import { resolveOctokit } from "./github-app.js";
import { destroyPreview } from "./builder.js";
import { removeRoute } from "./nginx.js";
import { log } from "./logger.js";

const execAsync = promisify(exec);

interface PreviewContainer {
  name: string;
  prNumber: number;
  repo: string;
  created: string;
  installationId?: number;
}

async function listPreviews(): Promise<PreviewContainer[]> {
  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter "label=preview.pr" --format "{{.Names}}|{{.Label \"preview.pr\"}}|{{.Label \"preview.repo\"}}|{{.Label \"preview.created\"}}|{{.Label \"preview.installation\"}}"`,
    );

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, pr, repo, created, installation] = line.split("|");
        return {
          name,
          prNumber: parseInt(pr, 10),
          repo,
          created,
          installationId: installation ? parseInt(installation, 10) || undefined : undefined,
        };
      });
  } catch {
    return [];
  }
}

function isOlderThanDays(dateStr: string, days: number): boolean {
  const created = new Date(dateStr).getTime();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return created < cutoff;
}

export async function cleanupStalePreviews(): Promise<string[]> {
  const previews = await listPreviews();
  const cleaned: string[] = [];

  for (const preview of previews) {
    let shouldClean = false;

    if (isOlderThanDays(preview.created, 7)) {
      shouldClean = true;
    } else if (preview.repo) {
      try {
        const [owner, repo] = preview.repo.split("/");
        const octokit = await resolveOctokit(preview.installationId);
        const state = await getPRState(octokit, owner, repo, preview.prNumber);
        if (state === "closed") {
          shouldClean = true;
        }
      } catch {
        log.warn("Cannot check PR state for cleanup", {
          repo: preview.repo,
          prNumber: preview.prNumber,
        });
      }
    }

    if (shouldClean) {
      await destroyPreview(preview.prNumber);
      await removeRoute(preview.prNumber);
      cleaned.push(preview.name);
    }
  }

  await pruneDocker();
  return cleaned;
}

async function pruneDocker(): Promise<void> {
  await execAsync("docker container prune --filter 'until=24h' -f 2>/dev/null || true");
  await execAsync("docker image prune --filter 'until=48h' -f 2>/dev/null || true");
  await execAsync("docker builder prune --keep-storage=2g -f 2>/dev/null || true");
}
