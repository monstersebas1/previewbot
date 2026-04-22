import { readFileSync } from "node:fs";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import { log } from "./logger.js";

let app: App | undefined;

function getApp(): App {
  if (!app) {
    if (!config.appId || !config.privateKeyPath) {
      throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH are required for app mode");
    }

    const privateKey = readFileSync(config.privateKeyPath, "utf-8");

    app = new App({
      appId: config.appId,
      privateKey,
      webhooks: { secret: config.webhookSecret },
      Octokit: Octokit.defaults({
        userAgent: "PreviewBot/1.0",
      }),
    });
  }
  return app;
}

export function isAppMode(): boolean {
  return Boolean(config.appId && config.privateKeyPath);
}

export async function getInstallationOctokit(
  installationId: number,
): Promise<InstanceType<typeof Octokit>> {
  return getApp().getInstallationOctokit(installationId) as unknown as Promise<InstanceType<typeof Octokit>>;
}

export async function getInstallationToken(
  installationId: number,
): Promise<string> {
  const octokit = await getInstallationOctokit(installationId);
  const auth = (await octokit.auth({ type: "installation" })) as { token: string };
  return auth.token;
}

export function getLegacyOctokit(): InstanceType<typeof Octokit> {
  if (!config.githubToken) {
    throw new Error("No GITHUB_TOKEN configured and not running in app mode");
  }
  return new Octokit({ auth: config.githubToken });
}

export async function resolveOctokit(
  installationId?: number,
): Promise<InstanceType<typeof Octokit>> {
  if (installationId && isAppMode()) {
    return getInstallationOctokit(installationId);
  }
  if (isAppMode()) {
    log.warn("App mode active but no installationId — cannot resolve Octokit");
    throw new Error("Installation ID required in app mode");
  }
  return getLegacyOctokit();
}

export async function resolveCloneToken(
  installationId?: number,
): Promise<string> {
  if (installationId && isAppMode()) {
    return getInstallationToken(installationId);
  }
  return config.githubToken;
}
