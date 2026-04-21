export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
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

export interface AxeViolation {
  id: string;
  impact: string;
  description: string;
  nodes: number;
}

export interface AxeResult {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
  totalViolations: number;
}

export interface AuditReport {
  lighthouse?: LighthouseResult;
  axe?: AxeResult;
  timestamp: string;
  previewUrl: string;
  productionUrl?: string;
}
