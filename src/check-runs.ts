import { octokit } from "./github.js";
import { config } from "./config.js";
import type {
  AuditReport,
  AxeViolation,
  VisualChange,
} from "./audit-types.js";

export interface CheckRunAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  title: string;
  message: string;
}

export interface AuditEvaluation {
  conclusion: "success" | "failure" | "neutral";
  title: string;
  summary: string;
  annotations: CheckRunAnnotation[];
}

const MAX_ANNOTATIONS = 50;

function makeAnnotation(
  level: "notice" | "warning" | "failure",
  title: string,
  message: string,
): CheckRunAnnotation {
  return {
    path: "",
    start_line: 1,
    end_line: 1,
    annotation_level: level,
    title,
    message,
  };
}

function axeImpactToLevel(impact: string): "notice" | "warning" | "failure" {
  if (impact === "critical") return "failure";
  if (impact === "serious") return "warning";
  return "notice";
}

export function evaluateAudit(report: AuditReport): AuditEvaluation {
  const annotations: CheckRunAnnotation[] = [];
  const failures: string[] = [];
  const summaryLines: string[] = [];
  let hasData = false;

  // Aggregate lighthouse scores from paths (or fall back to top-level)
  const lighthouseResults = report.paths.length > 0
    ? report.paths.filter((p) => p.lighthouse).map((p) => p.lighthouse!)
    : report.lighthouse ? [report.lighthouse] : [];

  if (lighthouseResults.length > 0) {
    hasData = true;
    // Use worst scores across all paths
    const worstScores = {
      performance: Math.min(...lighthouseResults.map((l) => l.scores.performance)),
      accessibility: Math.min(...lighthouseResults.map((l) => l.scores.accessibility)),
      bestPractices: Math.min(...lighthouseResults.map((l) => l.scores.bestPractices)),
      seo: Math.min(...lighthouseResults.map((l) => l.scores.seo)),
    };

    summaryLines.push("## Lighthouse Scores");
    summaryLines.push(`- Performance: ${worstScores.performance}`);
    summaryLines.push(`- Accessibility: ${worstScores.accessibility}`);
    summaryLines.push(`- Best Practices: ${worstScores.bestPractices}`);
    summaryLines.push(`- SEO: ${worstScores.seo}`);
    summaryLines.push("");

    const checks: { key: keyof typeof worstScores; label: string; threshold: number }[] = [
      { key: "performance", label: "Performance", threshold: config.thresholdPerformance },
      { key: "accessibility", label: "Accessibility", threshold: config.thresholdAccessibility },
      { key: "bestPractices", label: "Best Practices", threshold: config.thresholdBestPractices },
      { key: "seo", label: "SEO", threshold: config.thresholdSeo },
    ];

    for (const { key, label, threshold } of checks) {
      if (threshold > 0 && worstScores[key] < threshold) {
        failures.push(`${label}: ${worstScores[key]} (min: ${threshold})`);
        annotations.push(
          makeAnnotation("failure", `${label} below threshold`, `Score ${worstScores[key]} is below minimum ${threshold}`),
        );
      }
    }
  }

  // Aggregate axe violations across all paths
  const axeResults = report.paths.length > 0
    ? report.paths.filter((p) => p.axe).map((p) => p.axe!)
    : report.axe ? [report.axe] : [];

  if (axeResults.length > 0) {
    hasData = true;
    const allViolations: AxeViolation[] = axeResults.flatMap((a) => a.violations);
    const criticalCount = allViolations.filter((v) => v.impact === "critical").length;
    const seriousCount = allViolations.filter((v) => v.impact === "serious").length;
    const totalViolations = allViolations.length;

    summaryLines.push("## Accessibility (axe-core)");
    summaryLines.push(`- Total violations: ${totalViolations}`);
    summaryLines.push(`- Critical: ${criticalCount}`);
    summaryLines.push(`- Serious: ${seriousCount}`);
    summaryLines.push("");

    if (config.thresholdAxeCritical >= 0 && criticalCount > config.thresholdAxeCritical) {
      failures.push(`${criticalCount} critical a11y violations (max: ${config.thresholdAxeCritical})`);
    }

    if (seriousCount > config.thresholdAxeSerious) {
      failures.push(`${seriousCount} serious a11y violations (max: ${config.thresholdAxeSerious})`);
    }

    for (const violation of allViolations) {
      annotations.push(
        makeAnnotation(
          axeImpactToLevel(violation.impact),
          `axe: ${violation.id} (${violation.impact})`,
          `${violation.description} — ${violation.nodes} node(s) affected`,
        ),
      );
    }
  }

  // Aggregate visual diff changes across all paths
  const visualResults = report.paths.length > 0
    ? report.paths.filter((p) => p.visualDiff).map((p) => p.visualDiff!)
    : report.visualDiff ? [report.visualDiff] : [];

  if (visualResults.length > 0) {
    hasData = true;
    const allChanges: VisualChange[] = visualResults.flatMap((v) => v.changes);
    const criticalVisual = allChanges.filter((c) => c.severity === "critical").length;
    const warningVisual = allChanges.filter((c) => c.severity === "warning").length;

    summaryLines.push("## Visual Diff");
    summaryLines.push(`- Total changes: ${allChanges.length}`);
    summaryLines.push(`- Critical: ${criticalVisual}`);
    summaryLines.push(`- Warning: ${warningVisual}`);
    summaryLines.push("");

    if (config.thresholdVisualCritical >= 0 && criticalVisual > config.thresholdVisualCritical) {
      failures.push(`${criticalVisual} critical visual changes (max: ${config.thresholdVisualCritical})`);
    }

    for (const change of allChanges) {
      if (change.severity === "critical" || change.severity === "warning") {
        annotations.push(
          makeAnnotation(
            change.severity === "critical" ? "failure" : "warning",
            `Visual: ${change.category} (${change.severity})`,
            `${change.description} — viewport: ${change.viewport}`,
          ),
        );
      }
    }
  }

  // Truncate annotations to GitHub limit
  let truncated = false;
  const finalAnnotations = annotations.slice(0, MAX_ANNOTATIONS);
  if (annotations.length > MAX_ANNOTATIONS) {
    truncated = true;
    summaryLines.push(`> **Note:** ${annotations.length - MAX_ANNOTATIONS} additional annotations were truncated (GitHub limit: ${MAX_ANNOTATIONS}).`);
    summaryLines.push("");
  }

  if (!hasData) {
    return {
      conclusion: "neutral",
      title: "No audit data available",
      summary: "No Lighthouse, accessibility, or visual diff data was collected.",
      annotations: [],
    };
  }

  // Build title
  const conclusion = failures.length > 0 ? "failure" : "success";

  const scoreParts: string[] = [];
  if (lighthouseResults.length > 0) {
    const worst = {
      performance: Math.min(...lighthouseResults.map((l) => l.scores.performance)),
      accessibility: Math.min(...lighthouseResults.map((l) => l.scores.accessibility)),
    };
    scoreParts.push(`Perf: ${worst.performance}, A11y: ${worst.accessibility}`);
  }
  if (axeResults.length > 0) {
    const totalViolations = axeResults.flatMap((a) => a.violations).length;
    scoreParts.push(`${totalViolations} violations`);
  }

  let title: string;
  if (conclusion === "failure") {
    title = `Failed — ${failures.join(", ")}`;
  } else {
    title = `Passed — ${scoreParts.join(", ")}`;
  }

  // Truncate title to 255 chars (GitHub limit)
  if (title.length > 255) {
    title = `${title.slice(0, 252)}...`;
  }

  if (failures.length > 0) {
    summaryLines.push("## Failed Thresholds");
    for (const f of failures) {
      summaryLines.push(`- ${f}`);
    }
    summaryLines.push("");
  }

  return {
    conclusion,
    title,
    summary: summaryLines.join("\n"),
    annotations: truncated ? finalAnnotations : finalAnnotations,
  };
}

export async function startBuildCheckRun(opts: {
  owner: string;
  repo: string;
  sha: string;
}): Promise<number | undefined> {
  if (!config.checkRunsEnabled) return undefined;

  try {
    const { data } = await octokit.rest.checks.create({
      owner: opts.owner,
      repo: opts.repo,
      head_sha: opts.sha,
      name: "PreviewBot",
      status: "in_progress",
    });
    return data.id;
  } catch (err) {
    console.error("[CheckRuns] Failed to create check run:", err);
    return undefined;
  }
}

export async function failBuildCheckRun(opts: {
  owner: string;
  repo: string;
  checkRunId: number;
  errorLog: string;
}): Promise<void> {
  try {
    await octokit.rest.checks.update({
      owner: opts.owner,
      repo: opts.repo,
      check_run_id: opts.checkRunId,
      status: "completed",
      conclusion: "failure",
      output: {
        title: "Build Failed",
        summary: `The preview build failed.\n\n\`\`\`\n${opts.errorLog.slice(-2000)}\n\`\`\``,
      },
    });
  } catch (err) {
    console.error("[CheckRuns] Failed to update check run:", err);
  }
}

export async function runCheckRuns(opts: {
  owner: string;
  repo: string;
  sha: string;
  prNumber: number;
  checkRunId?: number;
  audit?: AuditReport;
}): Promise<void> {
  if (!config.checkRunsEnabled) return;

  try {
    let checkRunId = opts.checkRunId;

    if (!checkRunId) {
      const { data } = await octokit.rest.checks.create({
        owner: opts.owner,
        repo: opts.repo,
        head_sha: opts.sha,
        name: "PreviewBot",
        status: "in_progress",
      });
      checkRunId = data.id;
    }

    if (!opts.audit) {
      await octokit.rest.checks.update({
        owner: opts.owner,
        repo: opts.repo,
        check_run_id: checkRunId,
        status: "completed",
        conclusion: "neutral",
        output: {
          title: "No audit data",
          summary: "No audit data was collected for this preview.",
        },
      });
      return;
    }

    const evaluation = evaluateAudit(opts.audit);

    await octokit.rest.checks.update({
      owner: opts.owner,
      repo: opts.repo,
      check_run_id: checkRunId,
      status: "completed",
      conclusion: evaluation.conclusion,
      output: {
        title: evaluation.title,
        summary: evaluation.summary,
        annotations: evaluation.annotations,
      },
    });
  } catch (err) {
    console.error("[CheckRuns] Failed to run check runs:", err);
  }
}
