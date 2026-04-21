import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import { config, previewUrl } from "./config.js";

const octokit = new Octokit({ auth: config.githubToken });

const MARKER = "<!-- previewbot -->";

export function verifySignature(payload: string, signature: string): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", config.webhookSecret)
    .update(payload)
    .digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature),
  );
}

interface CommentOptions {
  owner: string;
  repo: string;
  prNumber: number;
}

async function findBotComment({ owner, repo, prNumber }: CommentOptions): Promise<number | null> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(MARKER));
  return existing?.id ?? null;
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
  { buildTime, healthStatus }: { buildTime: number; healthStatus: string },
): Promise<void> {
  const url = previewUrl(opts.prNumber);

  await upsertComment(opts, [
    "## PreviewBot",
    "",
    "| | |",
    "|---|---|",
    `| Preview | [${url}](${url}) |`,
    `| Status | ${healthStatus === "healthy" ? "Live" : "Unhealthy"} |`,
    `| Built in | ${buildTime}s |`,
    "",
    "---",
    `*Updated ${new Date().toISOString()} · Powered by [PreviewBot](https://github.com/monstersebas1/previewbot)*`,
  ].join("\n"));
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
    errorLog.slice(-2000),
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
