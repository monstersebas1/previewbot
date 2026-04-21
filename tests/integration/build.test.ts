import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures/preview-app");
const IMAGE_NAME = "previewbot-integration-test";
const CONTAINER_NAME = "previewbot-integration-test-container";

async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

async function cleanup() {
  await execFileAsync("docker", ["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
  await execFileAsync("docker", ["rmi", IMAGE_NAME]).catch(() => undefined);
}

describe("Docker Build Integration", () => {
  const shouldRun = process.env.INTEGRATION === "true";

  afterAll(async () => {
    if (shouldRun) await cleanup();
  });

  it.skipIf(!shouldRun)("builds and runs the fixture app container", async () => {
    const docker = await dockerAvailable();
    if (!docker) {
      expect.soft(false, "Docker not available — skipping").toBe(true);
      return;
    }

    await cleanup();

    await execFileAsync("docker", ["build", "-t", IMAGE_NAME, FIXTURE_DIR]);

    await execFileAsync("docker", [
      "run", "-d",
      "--name", CONTAINER_NAME,
      "-p", "127.0.0.1:14999:3000",
      "--memory=512m",
      "--read-only",
      "--tmpfs", "/tmp:rw,size=64m,noexec",
      "--security-opt=no-new-privileges:true",
      "--cap-drop=ALL",
      "--label", "preview.pr=99999",
      "--label", "preview.repo=integration/test",
      `--label=preview.created=${new Date().toISOString()}`,
      IMAGE_NAME,
    ]);

    await new Promise((r) => setTimeout(r, 2000));

    const { stdout: inspect } = await execFileAsync("docker", [
      "inspect", "--format", "{{json .Config.Labels}}", CONTAINER_NAME,
    ]);
    const labels = JSON.parse(inspect.trim());
    expect(labels["preview.pr"]).toBe("99999");
    expect(labels["preview.repo"]).toBe("integration/test");

    const { stdout: portOut } = await execFileAsync("docker", [
      "port", CONTAINER_NAME, "3000",
    ]);
    expect(portOut.trim()).toContain("127.0.0.1:14999");

    const res = await fetch("http://127.0.0.1:14999/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("Hello PR");

    await execFileAsync("docker", ["rm", "-f", CONTAINER_NAME]);
    const { stdout: ps } = await execFileAsync("docker", [
      "ps", "-a", "--filter", `name=${CONTAINER_NAME}`, "--format", "{{.Names}}",
    ]);
    expect(ps.trim()).toBe("");
  }, 120_000);
});
