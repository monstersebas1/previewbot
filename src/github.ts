import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { config, previewUrl } from "./config.js";
import { isAppMode, getInstallationOctokit } from "./app-auth.js";
import type { AuditReport } from "./audit-types.js";
import { generateAuditReport } from "./audit-report.js";

const patOctokit: InstanceType<typeof Octokit> = config.githubToken
  ? new Octokit({ auth: config.githubToken })
  : new Octokit();

export function getOctokit(installationId?: number | null): InstanceType<typeof Octokit> {
  if (installationId && isAppMode()) {
    return getInstallationOctokit(installationId);
  }
  return patOctokit;
}

const MARKER = "<!-- previewbot -->";

export function verifySignature(payload: string, signature: string): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", config.webhookSecret)
    .update(payload)
    .digest("hex")}`;

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export interface CommentOptions {
  owner: string;
  repo: string;
  prNumber: number;
  installationId?: number;
}

async function findBotComment(opts: CommentOptions): Promise<number | null> {
  const oc = getOctokit(opts.installationId);
  for (let page = 1; ; page++) {
    const { data } = await oc.rest.issues.listComments({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.prNumber,
      per_page: 100,
      page,
    });

    const found = data.find((c) => c.body?.includes(MARKER));
    if (found) return found.id;
    if (data.length < 100) return null;
  }
}

async function upsertComment(opts: CommentOptions, body: string): Promise<void> {
  const oc = getOctokit(opts.installationId);
  const markedBody = `${MARKER}\n${body}`;
  const commentId = await findBotComment(opts);

  if (commentId) {
    await oc.rest.issues.updateComment({
      owner: opts.owner,
      repo: opts.repo,
      comment_id: commentId,
      body: markedBody,
    });
  } else {
    await oc.rest.issues.createComment({
      owner: opts.owner,
      repo: opts.repo,
      issue_number: opts.prNumber,
      body: markedBody,
    });
  }
}

export async function commentBuilding(opts: CommentOptions): Promise<void> {
  await upsertComment(opts, [
    "## PreviewBot",
    "",
    "| | |",
    "|---|---|",
    `| Preview | Building... |`,
    `| Status | Queued |`,
  ].join("\n"));
}

export async function commentLive(
  opts: CommentOptions,
  { buildTime, healthStatus, audit }: { buildTime: number; healthStatus: string; audit?: AuditReport },
): Promise<void> {
  const url = previewUrl(opts.prNumber);

  const lines = [
    "## PreviewBot",
    "",
    "| | |",
    "|---|---|",
    `| Preview | [${url}](${url}) |`,
    `| Status | ${healthStatus === "healthy" ? "Live" : "Unhealthy"} |`,
    `| Built in | ${buildTime}s |`,
  ];

  if (audit) {
    const auditSection = generateAuditReport(audit);
    if (auditSection) {
      lines.push("", auditSection);
    }
  }

  lines.push(
    "",
    "---",
    `*Updated ${new Date().toISOString()} · Powered by [PreviewBot](https://github.com/monstersebas1/previewbot)*`,
  );

  await upsertComment(opts, lines.join("\n"));
}

export async function commentFailed(opts: CommentOptions, errorLog: string): Promise<void> {
  await upsertComment(opts, [
    "## PreviewBot",
    "",
    "| | |",
    "|---|---|",
    `| Status | Build Failed |`,
    "",
    "<details><summary>Error Log</summary>",
    "",
    "```",
    errorLog.slice(-2000).replace(/`{3,}/g, "` ` `"),
    "```",
    "",
    "</details>",
    "",
    "---",
    `*Updated ${new Date().toISOString()} · Powered by [PreviewBot](https://github.com/monstersebas1/previewbot)*`,
  ].join("\n"));
}

export async function commentCleanedUp(opts: CommentOptions): Promise<void> {
  await upsertComment(opts, [
    "## PreviewBot",
    "",
    "| | |",
    "|---|---|",
    `| Status | Cleaned up |`,
    "",
    "Preview environment has been removed.",
    "",
    "---",
    `*Updated ${new Date().toISOString()} · Powered by [PreviewBot](https://github.com/monstersebas1/previewbot)*`,
  ].join("\n"));
}

export async function getPRState(
  owner: string,
  repo: string,
  prNumber: number,
  installationId?: number,
): Promise<string> {
  const oc = getOctokit(installationId);
  const { data } = await oc.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return data.state;
}
