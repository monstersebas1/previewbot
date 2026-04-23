import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { previewUrl } from "./config.js";
import { log } from "./logger.js";

interface PreviewConfigFile {
  framework?: string;
  env?: Record<string, string>;
}

const TEMPLATE_RESOLVERS: Record<string, (prNumber: number) => string> = {
  preview_url: (prNumber) => previewUrl(prNumber),
};

function resolveTemplates(
  env: Record<string, string>,
  prNumber: number,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
      const resolver = TEMPLATE_RESOLVERS[name];
      return resolver ? resolver(prNumber) : match;
    });
  }

  return resolved;
}

async function loadServerEnv(
  owner: string,
  repo: string,
  secretsDir: string,
  prNumber: number,
): Promise<Record<string, string>> {
  const envPath = path.join(secretsDir, owner, `${repo}.env`);
  try {
    const raw = await readFile(envPath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = val;
    }
    log.info("Loaded server-side env", { owner, repo, keys: Object.keys(env), prNumber });
    return env;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("Failed to read server env file", { envPath, error: String(err) });
    }
    return {};
  }
}

export async function loadPreviewConfig(
  repoDir: string,
  prNumber: number,
  owner = "",
  repo = "",
  secretsDir = "",
): Promise<Record<string, string>> {
  const serverEnv = owner && repo && secretsDir
    ? await loadServerEnv(owner, repo, secretsDir, prNumber)
    : {};

  for (const filename of [".previewbot.yml", ".previewbot.yaml"]) {
    const configPath = path.join(repoDir, filename);

    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = parseYaml(raw) as PreviewConfigFile;

      if (!parsed?.env || typeof parsed.env !== "object") {
        log.info("Found config but no env section", { file: filename, prNumber });
        return serverEnv;
      }

      const repoEnv = resolveTemplates(parsed.env, prNumber);
      log.info("Loaded preview config", {
        file: filename,
        keys: Object.keys(repoEnv),
        prNumber,
      });
      // Server-side env takes precedence over repo config
      return { ...repoEnv, ...serverEnv };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      log.warn("Failed to parse preview config", {
        file: filename,
        error: String(err),
      });
      return serverEnv;
    }
  }

  if (Object.keys(serverEnv).length === 0) {
    log.info("No .previewbot.yml found, building without env config", { prNumber });
  }
  return serverEnv;
}

export function envToFileContent(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n";
}
