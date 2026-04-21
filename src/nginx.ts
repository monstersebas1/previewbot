import { writeFile, unlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { config, previewPort } from "./config.js";

const execFileAsync = promisify(execFile);

function confPath(prNumber: number): string {
  return path.join(config.nginxConfDir, `preview-pr-${prNumber}.conf`);
}

function generateConf(prNumber: number): string {
  const port = previewPort(prNumber);
  const serverName = `pr-${prNumber}.${config.previewDomain}`;

  return `server {
    listen 80;
    server_name ${serverName};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
`;
}

async function reloadNginx(): Promise<void> {
  await execFileAsync("nginx", ["-s", "reload"]);
}

export async function createRoute(prNumber: number): Promise<void> {
  const conf = generateConf(prNumber);
  await writeFile(confPath(prNumber), conf, "utf-8");
  await reloadNginx();
}

export async function removeRoute(prNumber: number): Promise<void> {
  try {
    await unlink(confPath(prNumber));
    await reloadNginx();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}
