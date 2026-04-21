import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ViewportScreenshot, VisualChange, VisualDiffResult } from "./audit-types.js";
import { config } from "./config.js";
import { captureScreenshots } from "./screenshot.js";
import { log } from "./logger.js";

const COMPARISON_PROMPT = `You are a visual QA engineer comparing two screenshots of the same web page — a preview deployment vs production.

Analyze the visual differences and return a JSON object with this exact shape:
{
  "changes": [
    {
      "category": "layout" | "color" | "content" | "responsive" | "regression" | "improvement",
      "severity": "info" | "warning" | "critical",
      "description": "brief description of the change"
    }
  ],
  "summary": "1-2 sentence overall summary"
}

Categories:
- layout: position, sizing, spacing, alignment changes
- color: background, text, border color changes
- content: text, images, icons added/removed/changed
- responsive: viewport-specific rendering issues
- regression: something visually broken (missing elements, overflow, clipping)
- improvement: intentional visual improvement

Severity:
- info: minor or intentional change
- warning: notable change that needs review
- critical: likely broken (missing content, layout collapse, text overflow)

Return ONLY the JSON object, no markdown fences or explanation.`;

const SINGLE_REVIEW_PROMPT = `You are a visual QA engineer reviewing a screenshot of a web page preview deployment.

Check for obvious visual issues and return a JSON object with this exact shape:
{
  "changes": [
    {
      "category": "layout" | "color" | "content" | "responsive" | "regression" | "improvement",
      "severity": "info" | "warning" | "critical",
      "description": "brief description of the issue"
    }
  ],
  "summary": "1-2 sentence overall assessment"
}

Look for: broken layouts, missing images, text overflow, misaligned elements, empty sections, console-error-style visual artifacts.
If everything looks normal, return an empty changes array with a positive summary.

Return ONLY the JSON object, no markdown fences or explanation.`;

const analysisResultSchema = z.object({
  changes: z.array(z.object({
    category: z.enum(["layout", "color", "content", "responsive", "regression", "improvement"]),
    severity: z.enum(["info", "warning", "critical"]),
    description: z.string(),
  })),
  summary: z.string(),
});

type AnalysisResult = z.infer<typeof analysisResultSchema>;

async function loadImageBase64(path: string): Promise<string> {
  const buffer = await readFile(path);
  return buffer.toString("base64");
}

async function analyzeViewport(
  client: Anthropic,
  screenshot: ViewportScreenshot,
): Promise<AnalysisResult> {
  const previewData = await loadImageBase64(screenshot.previewPath);

  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  if (screenshot.productionPath) {
    const prodData = await loadImageBase64(screenshot.productionPath);
    content.push(
      { type: "text", text: `Production screenshot (${screenshot.viewport} — ${screenshot.width}x${screenshot.height}):` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: prodData } },
      { type: "text", text: `Preview screenshot (${screenshot.viewport} — ${screenshot.width}x${screenshot.height}):` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: previewData } },
    );
  } else {
    content.push(
      { type: "text", text: `Preview screenshot (${screenshot.viewport} — ${screenshot.width}x${screenshot.height}):` },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: previewData } },
    );
  }

  const prompt = screenshot.productionPath ? COMPARISON_PROMPT : SINGLE_REVIEW_PROMPT;

  const message = await client.messages.create({
    model: config.visualDiffModel,
    max_tokens: 1024,
    messages: [{ role: "user", content: [...content, { type: "text", text: prompt }] }],
  });

  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    return { changes: [], summary: "No analysis returned" };
  }

  try {
    const parsed: unknown = JSON.parse(text.text);
    return analysisResultSchema.parse(parsed);
  } catch {
    return { changes: [], summary: text.text.slice(0, 200) };
  }
}

interface VisualDiffOptions {
  previewUrl: string;
  productionUrl?: string;
  prNumber: number;
}

export async function runVisualDiff({
  previewUrl,
  productionUrl,
  prNumber,
}: VisualDiffOptions): Promise<VisualDiffResult | undefined> {
  if (!config.anthropicApiKey) {
    log.info("Visual diff skipped — ANTHROPIC_API_KEY not set");
    return undefined;
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const screenshots = await captureScreenshots({ previewUrl, productionUrl, prNumber });

    const allChanges: VisualChange[] = [];
    const summaries: string[] = [];

    for (const screenshot of screenshots) {
      const result = await analyzeViewport(client, screenshot);
      summaries.push(`**${screenshot.viewport}**: ${result.summary}`);

      for (const change of result.changes) {
        allChanges.push({ ...change, viewport: screenshot.viewport });
      }
    }

    return {
      screenshots,
      changes: allChanges,
      summary: summaries.join(" "),
      hasProductionComparison: !!productionUrl,
    };
  } catch (err) {
    log.warn("Visual diff failed, skipping", { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}
