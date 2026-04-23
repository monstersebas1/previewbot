import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { config, previewPort, containerName } from "./config.js";
import { log } from "./logger.js";
import { loadPreviewConfig, envToFileContent } from "./preview-config.js";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface BuildContext {
  owner: string;
  repo: string;
  prNumber: number;
  branch: string;
  cloneUrl: string;
}

function deployPath(prNumber: number): string {
  return path.join(config.deployDir, `pr-${prNumber}`);
}

function secretsPath(prNumber: number): string {
  return path.join(config.secretsDir, `pr-${prNumber}`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function checkDiskSpace(): Promise<boolean> {
  try {
    const { stdout } = await execAsync("df -BG --output=avail / | tail -1");
    const availGB = parseInt(stdout.trim().replace("G", ""), 10);
    return availGB >= 2;
  } catch (err) {
    log.warn("Disk space check failed", { error: String(err) });
    return true;
  }
}

function authenticatedCloneUrl(cloneUrl: string): string {
  const token = config.githubToken;
  if (!token) return cloneUrl;
  return cloneUrl.replace("https://", `https://x-access-token:${token}@`);
}

async function cloneRepo(ctx: BuildContext): Promise<void> {
  const dir = deployPath(ctx.prNumber);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);

  await execFileAsync(
    "git",
    ["clone", "--depth", "1", "--branch", ctx.branch, authenticatedCloneUrl(ctx.cloneUrl), dir],
    { timeout: 120_000 },
  );
}

async function writeEnvFile(
  repoDir: string,
  env: Record<string, string>,
): Promise<void> {
  if (Object.keys(env).length === 0) return;
  await writeFile(path.join(repoDir, ".env.local"), envToFileContent(env), "utf-8");
}

async function dockerBuild(ctx: BuildContext): Promise<void> {
  const dir = deployPath(ctx.prNumber);
  const imageName = `previewbot-app:pr-${ctx.prNumber}`;

  const dockerfileSrc = path.join(dir, "Dockerfile");
  const dockerfileExists = await stat(dockerfileSrc).then(() => true).catch(() => false);

  const buildArgs = dockerfileExists
    ? ["build", "-t", imageName, dir]
    : ["build", "-t", imageName, "-f", "/opt/previewbot/templates/Dockerfile.preview", dir];

  await execFileAsync("docker", buildArgs, {
    timeout: config.buildTimeout * 1000,
    env: { ...process.env, DOCKER_BUILDKIT: "1" },
  });
}

async function setupSecrets(prNumber: number): Promise<void> {
  const dir = secretsPath(prNumber);
  await ensureDir(dir);

  const previewEnvPath = path.join(config.deployDir, ".env.preview");
  const envExists = await stat(previewEnvPath).then(() => true).catch(() => false);

  if (envExists) {
    await copyFile(previewEnvPath, path.join(dir, ".env"));
  }
}

interface DockerRunOptions {
  owner: string;
  repo: string;
  prNumber: number;
  env?: Record<string, string>;
}

async function dockerRun({ owner, repo, prNumber, env }: DockerRunOptions): Promise<void> {
  const name = containerName(prNumber);
  const port = previewPort(prNumber);
  const imageName = `previewbot-app:pr-${prNumber}`;
  const secrets = secretsPath(prNumber);

  await execAsync(`docker rm -f ${name} 2>/dev/null || true`);

  const args = [
    "run", "-d",
    "--name", name,
    "--network", config.dockerNetwork,
    "-p", `127.0.0.1:${port}:3000`,
    "--memory", config.containerMemory,
    `--memory-swap=${config.containerMemory}`,
    "--cpus", config.containerCpus,
    "--pids-limit=100",
    "--tmpfs", "/tmp:rw,size=64m,noexec",
    "--read-only",
    "--security-opt=no-new-privileges:true",
    "--cap-drop=ALL",
    "--restart=no",
    "--label", `preview.pr=${prNumber}`,
    "--label", `preview.repo=${owner}/${repo}`,
    `--label=preview.created=${new Date().toISOString()}`,
  ];

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  const secretsDirExists = await stat(secrets).then(() => true).catch(() => false);
  if (secretsDirExists) {
    args.push("--mount", `type=bind,source=${secrets},target=/run/secrets,readonly`);
  }

  args.push(imageName);

  await execFileAsync("docker", args);
}

export interface BuildResult {
  success: boolean;
  buildTime: number;
  errorLog?: string;
}

export async function buildPreview(ctx: BuildContext): Promise<BuildResult> {
  const startTime = Date.now();

  try {
    const hasDisk = await checkDiskSpace();
    if (!hasDisk) {
      return { success: false, buildTime: 0, errorLog: "Insufficient disk space (< 2GB available)" };
    }

    await cloneRepo(ctx);

    const dir = deployPath(ctx.prNumber);
    const env = await loadPreviewConfig(dir, ctx.prNumber, ctx.owner, ctx.repo, config.secretsDir);
    await writeEnvFile(dir, env);

    await dockerBuild(ctx);
    await setupSecrets(ctx.prNumber);
    await dockerRun({ owner: ctx.owner, repo: ctx.repo, prNumber: ctx.prNumber, env });

    const buildTime = Math.round((Date.now() - startTime) / 1000);
    return { success: true, buildTime };
  } catch (err: unknown) {
    const buildTime = Math.round((Date.now() - startTime) / 1000);
    const errorLog = err instanceof Error ? err.message : String(err);
    return { success: false, buildTime, errorLog };
  }
}

export async function destroyPreview(prNumber: number): Promise<void> {
  const name = containerName(prNumber);

  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "--format",
      "{{index .Config.Labels \"preview.pr\"}}",
      name,
    ]);
    if (!stdout.trim()) {
      log.warn("Skipping destroy: not a previewbot container", { container: name });
      return;
    }
  } catch {
    // Container does not exist — nothing to remove
  }

  await execFileAsync("docker", ["rm", "-f", name]).catch(() => undefined);
  await execAsync(`docker rmi previewbot-app:pr-${prNumber} 2>/dev/null || true`);
  await rm(deployPath(prNumber), { recursive: true, force: true });
  await rm(secretsPath(prNumber), { recursive: true, force: true });
}
