export function previewAverageWatchTimePct(
  watchSeconds: number | null | undefined,
  durationSeconds: number | null | undefined
): number | null {
  if (watchSeconds == null || durationSeconds == null) return null;
  if (!Number.isFinite(watchSeconds) || watchSeconds <= 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const pct = (watchSeconds / durationSeconds) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

export function getAnalysisDurationSeconds(
  analysis:
    | { duration_seconds?: number | null; timeline?: Array<{ timestamp: number }> | null }
    | null
    | undefined
): number | null {
  if (!analysis) return null;
  if (analysis.duration_seconds != null && Number.isFinite(analysis.duration_seconds) && analysis.duration_seconds > 0) {
    return Math.round(analysis.duration_seconds * 10) / 10;
  }
  const timeline = analysis.timeline;
  if (!timeline?.length) return null;
  const maxTs = Math.max(...timeline.map((t) => Number(t.timestamp || 0)).filter(Number.isFinite));
  return maxTs > 0 ? Math.round(maxTs * 10) / 10 : null;
}
