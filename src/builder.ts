import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { config, previewPort, containerName } from "./config.js";

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
  } catch {
    return true;
  }
}

async function cloneRepo(ctx: BuildContext): Promise<void> {
  const dir = deployPath(ctx.prNumber);
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);

  await execAsync(
    `git clone --depth 1 --branch ${ctx.branch} ${ctx.cloneUrl} ${dir}`,
    { timeout: 120_000 },
  );
}

async function dockerBuild(ctx: BuildContext): Promise<void> {
  const dir = deployPath(ctx.prNumber);
  const imageName = `previewbot-app:pr-${ctx.prNumber}`;

  const dockerfileSrc = path.join(dir, "Dockerfile");
  const dockerfileExists = await stat(dockerfileSrc).then(() => true).catch(() => false);

  const buildCmd = dockerfileExists
    ? `docker build -t ${imageName} ${dir}`
    : `docker build -t ${imageName} -f /opt/previewbot/templates/Dockerfile.preview ${dir}`;

  await execAsync(buildCmd, {
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
    await execAsync(`cp ${previewEnvPath} ${dir}/.env`);
  }
}

async function dockerRun(prNumber: number): Promise<void> {
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
    `--label=preview.created=${new Date().toISOString()}`,
  ];

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
    await dockerBuild(ctx);
    await setupSecrets(ctx.prNumber);
    await dockerRun(ctx.prNumber);

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

  await execAsync(`docker rm -f ${name} 2>/dev/null || true`);
  await execAsync(`docker rmi previewbot-app:pr-${prNumber} 2>/dev/null || true`);
  await rm(deployPath(prNumber), { recursive: true, force: true });
  await rm(secretsPath(prNumber), { recursive: true, force: true });
}
