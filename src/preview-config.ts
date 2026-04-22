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

export async function loadPreviewConfig(
  repoDir: string,
  prNumber: number,
): Promise<Record<string, string>> {
  for (const filename of [".previewbot.yml", ".previewbot.yaml"]) {
    const configPath = path.join(repoDir, filename);

    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = parseYaml(raw) as PreviewConfigFile;

      if (!parsed?.env || typeof parsed.env !== "object") {
        log.info("Found config but no env section", { file: filename, prNumber });
        return {};
      }

      const env = resolveTemplates(parsed.env, prNumber);
      log.info("Loaded preview config", {
        file: filename,
        keys: Object.keys(env),
        prNumber,
      });
      return env;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      log.warn("Failed to parse preview config", {
        file: filename,
        error: String(err),
        prNumber,
      });
      return {};
    }
  }

  log.info("No .previewbot.yml found, building without env config", { prNumber });
  return {};
}

export function envToFileContent(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n";
}
