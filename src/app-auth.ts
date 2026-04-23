import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "./config.js";

const octokitCache = new Map<number, InstanceType<typeof Octokit>>();

export function isAppMode(): boolean {
  return Boolean(config.githubAppId && config.githubAppPrivateKey);
}

export function getInstallationOctokit(installationId: number): InstanceType<typeof Octokit> {
  const cached = octokitCache.get(installationId);
  if (cached) return cached;

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: Number(config.githubAppId),
      privateKey: config.githubAppPrivateKey,
      installationId,
    },
  });

  octokitCache.set(installationId, octokit);
  return octokit;
}

export function clearInstallationCache(installationId?: number): void {
  if (installationId !== undefined) {
    octokitCache.delete(installationId);
  } else {
    octokitCache.clear();
  }
}
