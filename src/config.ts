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
  previewDomain: required("PREVIEW_DOMAIN"),
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
} as const;

export function previewPort(prNumber: number): number {
  return 4000 + prNumber;
}

export function previewUrl(prNumber: number): string {
  return `https://pr-${prNumber}.${config.previewDomain}`;
}

export function containerName(prNumber: number): string {
  return `preview-pr-${prNumber}`;
}
