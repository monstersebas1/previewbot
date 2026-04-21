import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { config, previewUrl } from "./config.js";
import type { AuditReport } from "./audit-types.js";
import { generateAuditReport } from "./audit-report.js";

export const octokit: InstanceType<typeof Octokit> = new Octokit({ auth: config.githubToken });

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

interface CommentOptions {
  owner: string;
  repo: string;
  prNumber: number;
}

async function findBotComment({ owner, repo, prNumber }: CommentOptions): Promise<number | null> {
  for (let page = 1; ; page++) {
    const { data } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    });

    const found = data.find((c) => c.body?.includes(MARKER));
    if (found) return found.id;
    if (data.length < 100) return null;
  }
}

async function upsertComment({ owner, repo, prNumber }: CommentOptions, body: string): Promise<void> {
  const markedBody = `${MARKER}\n${body}`;
  const commentId = await findBotComment({ owner, repo, prNumber });

  if (commentId) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: commentId,
      body: markedBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
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

export async function commentFailed(
  opts: CommentOptions,
  errorLog: string,
): Promise<void> {
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
): Promise<string> {
  const { data } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return data.state;
}
