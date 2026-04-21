export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
}

export interface PerformanceDiff {
  metric: string;
  preview: number;
  production: number;
  delta: number;
}

export interface LighthouseResult {
  scores: LighthouseScores;
  performanceDiff?: PerformanceDiff[];
  rawReportUrl?: string;
}

export type AxeImpact = "critical" | "serious" | "moderate" | "minor";

export interface AxeViolation {
  id: string;
  impact: AxeImpact;
  description: string;
  nodes: number;
}

export interface AxeResult {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
  totalViolations: number;
  scanError?: string;
}

export interface ViewportScreenshot {
  viewport: string;
  width: number;
  height: number;
  previewPath: string;
  productionPath?: string;
}

export interface VisualChange {
  category: "layout" | "color" | "content" | "responsive" | "regression" | "improvement";
  severity: "info" | "warning" | "critical";
  description: string;
  viewport: string;
}

export interface VisualDiffResult {
  screenshots: ViewportScreenshot[];
  changes: VisualChange[];
  summary: string;
  hasProductionComparison: boolean;
}

export interface PathAuditResult {
  path: string;
  lighthouse?: LighthouseResult;
  axe?: AxeResult;
  visualDiff?: VisualDiffResult;
}

export interface AuditReport {
  paths: PathAuditResult[];
  lighthouse?: LighthouseResult;
  axe?: AxeResult;
  visualDiff?: VisualDiffResult;
  timestamp: string;
  previewUrl: string;
  productionUrl?: string;
}
