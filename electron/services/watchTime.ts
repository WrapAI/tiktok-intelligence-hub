export function getAnalysisDurationSeconds(
  analysis:
    | { duration_seconds?: number | null; timeline?: Array<{ timestamp: number }> | null }
    | null
    | undefined
): number | null {
  if (!analysis) return null;
  return resolveVideoDurationSeconds(analysis.duration_seconds, analysis.timeline);
}

export function resolveVideoDurationSeconds(
  analysisDuration: number | null | undefined,
  timeline?: Array<{ timestamp: number }> | null
): number | null {
  if (analysisDuration != null && Number.isFinite(analysisDuration) && analysisDuration > 0) {
    return Math.round(analysisDuration * 10) / 10;
  }
  if (timeline?.length) {
    const maxTs = Math.max(...timeline.map((t) => Number(t.timestamp || 0)).filter(Number.isFinite));
    if (maxTs > 0) return Math.round(maxTs * 10) / 10;
  }
  return null;
}

/** TikTok Studio average watch time in seconds → average watch time % */
export function computeAverageWatchTimePct(
  watchSeconds: number,
  durationSeconds: number
): number {
  if (!Number.isFinite(watchSeconds) || watchSeconds <= 0) {
    throw new Error("Average watch time (seconds) must be greater than 0.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Video duration not confirmed — run Grok analysis first.");
  }
  const pct = (watchSeconds / durationSeconds) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

export function resolveWatchTimeFromSubmit(opts: {
  watch_time_seconds: number | null | undefined;
  watch_time_pct?: number | null | undefined;
  durationSeconds: number | null;
}): { watch_time_seconds: number | null; watch_time_pct: number | null } {
  const seconds = opts.watch_time_seconds;
  if (seconds != null && Number.isFinite(seconds)) {
    if (seconds <= 0) {
      throw new Error("Average watch time (seconds) must be greater than 0.");
    }
    if (!opts.durationSeconds) {
      return { watch_time_seconds: seconds, watch_time_pct: null };
    }
    return {
      watch_time_seconds: seconds,
      watch_time_pct: computeAverageWatchTimePct(seconds, opts.durationSeconds),
    };
  }
  if (opts.watch_time_pct != null && Number.isFinite(opts.watch_time_pct)) {
    return {
      watch_time_seconds: null,
      watch_time_pct: opts.watch_time_pct,
    };
  }
  return { watch_time_seconds: null, watch_time_pct: null };
}
