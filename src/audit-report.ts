import type { AuditReport, LighthouseResult, AxeResult, PathAuditResult, VisualDiffResult } from "./audit-types.js";
import { sanitizeMarkdown } from "./sanitize-markdown.js";

function scoreBadge(score: number): string {
  if (score >= 90) return `🟢 ${score}`;
  if (score >= 50) return `🟡 ${score}`;
  return `🔴 ${score}`;
}

function impactIcon(impact: string): string {
  const icons: Record<string, string> = {
    critical: "🔴",
    serious: "🟠",
    moderate: "🟡",
    minor: "⚪",
  };
  return icons[impact] ?? "⚪";
}

function deltaArrow(delta: number): string {
  if (delta > 0) return `▲ +${delta}`;
  if (delta < 0) return `▼ ${delta}`;
  return "—";
}

function renderLighthouse(lighthouse: LighthouseResult): string {
  const { scores, performanceDiff, rawReportUrl } = lighthouse;
  const lines: string[] = [
    "### Performance (Lighthouse)",
    "",
    "| Category | Score |",
    "|---|---|",
    `| Performance | ${scoreBadge(scores.performance)} |`,
    `| Accessibility | ${scoreBadge(scores.accessibility)} |`,
    `| Best Practices | ${scoreBadge(scores.bestPractices)} |`,
    `| SEO | ${scoreBadge(scores.seo)} |`,
  ];

  if (performanceDiff && performanceDiff.length > 0) {
    lines.push(
      "",
      "**Diff vs Production**",
      "",
      "| Metric | Preview | Production | Delta |",
      "|---|---|---|---|",
    );
    for (const d of performanceDiff) {
      lines.push(`| ${d.metric} | ${d.preview} | ${d.production} | ${deltaArrow(d.delta)} |`);
    }
  }

  if (rawReportUrl) {
    lines.push("", `[View full report](${rawReportUrl})`);
  }

  return lines.join("\n");
}

function renderAxe(axe: AxeResult): string {
  const lines: string[] = ["### Accessibility (axe-core)", ""];

  if (axe.scanError) {
    lines.push(`> :warning: Accessibility scan failed: ${axe.scanError}`);
    lines.push("");
  }

  if (axe.violations.length === 0 && !axe.scanError) {
    lines.push("✅ No violations found");
    return lines.join("\n");
  }

  if (axe.violations.length === 0) {
    return lines.join("\n");
  }

  const critical = axe.violations.filter((v) => v.impact === "critical").length;
  const serious = axe.violations.filter((v) => v.impact === "serious").length;

  const parts = [`${axe.violations.length} violations found`];
  if (critical > 0) parts.push(`${critical} critical`);
  if (serious > 0) parts.push(`${serious} serious`);

  lines.push(`⚠️ ${parts.join(" (")}${critical > 0 || serious > 0 ? ")" : ""}`);
  lines.push(
    "",
    "| Rule | Impact | Description | Elements |",
    "|---|---|---|---|",
  );

  for (const v of axe.violations) {
    lines.push(`| ${v.id} | ${impactIcon(v.impact)} ${v.impact} | ${sanitizeMarkdown(v.description)} | ${v.nodes} |`);
  }

  return lines.join("\n");
}

function severityIcon(severity: string): string {
  const icons: Record<string, string> = {
    critical: "🔴",
    warning: "🟡",
    info: "🔵",
  };
  return icons[severity] ?? "🔵";
}

function renderVisualDiff(visualDiff: VisualDiffResult): string {
  const lines: string[] = [
    `### Visual Diff (AI)${visualDiff.hasProductionComparison ? "" : " — Preview Only"}`,
    "",
  ];

  if (visualDiff.changes.length === 0) {
    lines.push("No visual issues detected.");
    return lines.join("\n");
  }

  const critical = visualDiff.changes.filter((c) => c.severity === "critical").length;
  const warnings = visualDiff.changes.filter((c) => c.severity === "warning").length;

  const parts = [`${visualDiff.changes.length} changes detected`];
  if (critical > 0) parts.push(`${critical} critical`);
  if (warnings > 0) parts.push(`${warnings} warning`);
  lines.push(`${parts.join(" (")}${critical > 0 || warnings > 0 ? ")" : ""}`);

  lines.push(
    "",
    "| Viewport | Severity | Category | Description |",
    "|---|---|---|---|",
  );

  for (const c of visualDiff.changes) {
    lines.push(`| ${c.viewport} | ${severityIcon(c.severity)} ${c.severity} | ${sanitizeMarkdown(c.category)} | ${sanitizeMarkdown(c.description)} |`);
  }

  lines.push(
    "",
    "<details><summary>Full AI Analysis</summary>",
    "",
    visualDiff.summary,
    "",
    "</details>",
  );

  return lines.join("\n");
}

function renderPathSections(pathResult: PathAuditResult): string[] {
  const sections: string[] = [];
  if (pathResult.lighthouse) {
    sections.push(renderLighthouse(pathResult.lighthouse));
  }
  if (pathResult.axe) {
    sections.push(renderAxe(pathResult.axe));
  }
  if (pathResult.visualDiff) {
    sections.push(renderVisualDiff(pathResult.visualDiff));
  }
  return sections;
}

export function generateAuditReport(report: AuditReport): string {
  const sections: string[] = [];

  if (report.paths && report.paths.length > 1) {
    for (const pathResult of report.paths) {
      const pathSections = renderPathSections(pathResult);
      if (pathSections.length > 0) {
        sections.push(`#### ${pathResult.path}\n\n${pathSections.join("\n\n")}`);
      }
    }
  } else if (report.paths && report.paths.length === 1) {
    sections.push(...renderPathSections(report.paths[0]));
  } else {
    if (report.lighthouse) {
      sections.push(renderLighthouse(report.lighthouse));
    }
    if (report.axe) {
      sections.push(renderAxe(report.axe));
    }
    if (report.visualDiff) {
      sections.push(renderVisualDiff(report.visualDiff));
    }
  }

  if (sections.length === 0) {
    return "";
  }

  return "\n" + sections.join("\n\n") + "\n";
}
