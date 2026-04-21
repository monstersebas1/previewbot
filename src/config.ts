import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  githubToken: required("GITHUB_TOKEN"),
  webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  previewDomain: (() => {
    const domain = required("PREVIEW_DOMAIN");
    if (!/^[a-z0-9.-]+$/i.test(domain)) {
      throw new Error("PREVIEW_DOMAIN contains invalid characters");
    }
    return domain;
  })(),
  port: parseInt(optional("PORT", "3500"), 10),
  deployDir: optional("DEPLOY_DIR", "/var/previewbot/deploys"),
  secretsDir: optional("SECRETS_DIR", "/var/previewbot/secrets"),
  nginxConfDir: optional("NGINX_CONF_DIR", "/etc/nginx/conf.d"),
  dockerNetwork: optional("DOCKER_NETWORK", "pr-previews"),
  containerMemory: optional("CONTAINER_MEMORY", "512m"),
  containerCpus: optional("CONTAINER_CPUS", "1"),
  buildTimeout: parseInt(optional("BUILD_TIMEOUT", "600"), 10),
  healthCheckTimeout: parseInt(optional("HEALTH_CHECK_TIMEOUT", "60"), 10),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  productionUrl: process.env.PRODUCTION_URL,
  auditTimeout: parseInt(optional("AUDIT_TIMEOUT", "120"), 10),
  auditPaths: optional("AUDIT_PATHS", "/").split(",").map((p) => p.trim()).filter(Boolean),
  checkRunsEnabled: optional("CHECK_RUNS_ENABLED", "true") === "true",
  thresholdPerformance: parseInt(optional("THRESHOLD_PERFORMANCE", "0"), 10),
  thresholdAccessibility: parseInt(optional("THRESHOLD_ACCESSIBILITY", "0"), 10),
  thresholdBestPractices: parseInt(optional("THRESHOLD_BEST_PRACTICES", "0"), 10),
  thresholdSeo: parseInt(optional("THRESHOLD_SEO", "0"), 10),
  thresholdAxeCritical: parseInt(optional("THRESHOLD_AXE_CRITICAL", "0"), 10),
  thresholdAxeSerious: parseInt(optional("THRESHOLD_AXE_SERIOUS", "5"), 10),
  thresholdVisualCritical: parseInt(optional("THRESHOLD_VISUAL_CRITICAL", "0"), 10),
  visualDiffModel: optional("VISUAL_DIFF_MODEL", "claude-sonnet-4-5-20250929"),
} as const;

export function previewPort(prNumber: number): number {
  const port = 4000 + prNumber;
  if (port < 1024 || port > 65535) {
    throw new Error(`Port ${port} out of valid range for PR #${prNumber}`);
  }
  return port;
}

export function previewUrl(prNumber: number): string {
  return `https://pr-${prNumber}.${config.previewDomain}`;
}

export function containerName(prNumber: number): string {
  return `preview-pr-${prNumber}`;
}
