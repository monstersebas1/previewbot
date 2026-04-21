import type { AuditReport, LighthouseResult, AxeResult } from "./audit-types.js";

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

  if (axe.violations.length === 0) {
    lines.push("✅ No violations found");
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
    lines.push(`| ${v.id} | ${impactIcon(v.impact)} ${v.impact} | ${v.description} | ${v.nodes} |`);
  }

  return lines.join("\n");
}

export function generateAuditReport(report: AuditReport): string {
  const sections: string[] = [];

  if (report.lighthouse) {
    sections.push(renderLighthouse(report.lighthouse));
  }

  if (report.axe) {
    sections.push(renderAxe(report.axe));
  }

  if (sections.length === 0) {
    return "";
  }

  return "\n" + sections.join("\n\n") + "\n";
}
