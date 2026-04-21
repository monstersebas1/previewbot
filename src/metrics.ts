interface Metrics {
  totalBuilds: number;
  successCount: number;
  failCount: number;
  totalBuildTimeMs: number;
  lastCleanupAt: string | null;
}

const metrics: Metrics = {
  totalBuilds: 0,
  successCount: 0,
  failCount: 0,
  totalBuildTimeMs: 0,
  lastCleanupAt: null,
};

export function recordBuildStart(): void {
  metrics.totalBuilds++;
}

export function recordBuildSuccess(durationMs: number): void {
  metrics.successCount++;
  metrics.totalBuildTimeMs += durationMs;
}

export function recordBuildFailure(durationMs: number): void {
  metrics.failCount++;
  metrics.totalBuildTimeMs += durationMs;
}

export function recordCleanup(): void {
  metrics.lastCleanupAt = new Date().toISOString();
}

export function resetMetrics(): void {
  metrics.totalBuilds = 0;
  metrics.successCount = 0;
  metrics.failCount = 0;
  metrics.totalBuildTimeMs = 0;
  metrics.lastCleanupAt = null;
}

export function getMetrics(): {
  totalBuilds: number;
  successCount: number;
  failCount: number;
  avgBuildTimeMs: number;
  lastCleanupAt: string | null;
} {
  const completed = metrics.successCount + metrics.failCount;
  return {
    totalBuilds: metrics.totalBuilds,
    successCount: metrics.successCount,
    failCount: metrics.failCount,
    avgBuildTimeMs: completed > 0 ? Math.round(metrics.totalBuildTimeMs / completed) : 0,
    lastCleanupAt: metrics.lastCleanupAt,
  };
}
