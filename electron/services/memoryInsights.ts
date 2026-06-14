import type { JsonStore } from "../db.js";

export type WinningPattern = {
  source: "positive_memory" | "library";
  hook: string;
  whatWorked: string;
  funnel?: string;
  hookType?: string;
  myViews?: number;
  myGmv?: number;
  rating?: number;
  replicationScore?: number;
  sourceProfile?: string;
};

export type MemorySummary = {
  totalMemoryEntries: number;
  ratedEntries: number;
  avgRating: number;
  avgMyViews: number;
  avgMyGmv: number;
  topPatterns: WinningPattern[];
  hookTypeWins: Record<string, number>;
  funnelWins: Record<string, number>;
};

function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function buildMemorySummary(store: JsonStore, limit = 12): MemorySummary {
  const memoryRows = store.list<{
    payload_json: string;
    rating: number | null;
    my_views: number | null;
    my_gmv: number | null;
    what_i_took: string | null;
  }>("positive_memory");

  const libraryRows = store.list<{
    payload_json: string;
    hook_type: string | null;
    funnel_category: string | null;
  }>("library_items");

  const patterns: WinningPattern[] = [];
  let ratingSum = 0;
  let ratedCount = 0;
  let viewsSum = 0;
  let viewsCount = 0;
  let gmvSum = 0;
  let gmvCount = 0;
  const hookTypeWins: Record<string, number> = {};
  const funnelWins: Record<string, number> = {};

  for (const row of memoryRows) {
    const payload = safeJson<Record<string, unknown>>(row.payload_json) || {};
    const rating = row.rating ?? (payload.rating as number) ?? 0;
    const myViews = row.my_views ?? (payload.my_views as number) ?? 0;
    const myGmv = row.my_gmv ?? (payload.my_gmv as number) ?? 0;

    if (rating > 0) {
      ratingSum += rating;
      ratedCount += 1;
    }
    if (myViews > 0) {
      viewsSum += myViews;
      viewsCount += 1;
    }
    if (myGmv > 0) {
      gmvSum += myGmv;
      gmvCount += 1;
    }

    if (rating >= 4 || myGmv >= 50 || myViews >= 5000) {
      const hook =
        (payload.source_hook as string) ||
        (payload.hook as string) ||
        row.what_i_took ||
        "";
      patterns.push({
        source: "positive_memory",
        hook,
        whatWorked: row.what_i_took || (payload.what_i_took as string) || "",
        myViews,
        myGmv,
        rating: rating || undefined,
        sourceProfile: (payload.source_profile as string) || "",
      });
    }
  }

  for (const row of libraryRows) {
    const item = safeJson<Record<string, unknown>>(row.payload_json) || {};
    const wtw = (item.why_this_worked as Record<string, unknown>) || {};
    const replicationScore = Number(wtw.replication_score) || 0;
    const hookDetail = (item.hook_detail as Record<string, unknown>) || {};
    const hook = String(hookDetail.text || item.hook || "");
    const hookType = row.hook_type || String(item.hook_type || "");
    const funnel = row.funnel_category || String(item.funnel_category || item.funnel_class || "");

    if (replicationScore >= 8) {
      if (hookType) hookTypeWins[hookType] = (hookTypeWins[hookType] || 0) + 1;
      if (funnel) funnelWins[funnel] = (funnelWins[funnel] || 0) + 1;
      patterns.push({
        source: "library",
        hook,
        whatWorked: String(wtw.replication_notes || wtw.primary_reason || ""),
        hookType,
        funnel,
        replicationScore,
      });
    }
  }

  patterns.sort((a, b) => {
    const scoreA = (a.rating || 0) * 1000 + (a.myGmv || 0) + (a.replicationScore || 0) * 10;
    const scoreB = (b.rating || 0) * 1000 + (b.myGmv || 0) + (b.replicationScore || 0) * 10;
    return scoreB - scoreA;
  });

  return {
    totalMemoryEntries: memoryRows.length,
    ratedEntries: ratedCount,
    avgRating: ratedCount ? ratingSum / ratedCount : 0,
    avgMyViews: viewsCount ? viewsSum / viewsCount : 0,
    avgMyGmv: gmvCount ? gmvSum / gmvCount : 0,
    topPatterns: patterns.slice(0, limit),
    hookTypeWins,
    funnelWins,
  };
}

export function formatMemoryForPrompt(summary: MemorySummary): string {
  const lines: string[] = [
    "## Your performance memory",
    `- Positive memory entries: ${summary.totalMemoryEntries}`,
    `- Avg rating (rated): ${summary.avgRating.toFixed(1)}/5`,
    `- Avg views on your copies: ${Math.round(summary.avgMyViews).toLocaleString()}`,
    `- Avg GMV on your copies: £${summary.avgMyGmv.toFixed(2)}`,
  ];

  const hookEntries = Object.entries(summary.hookTypeWins).sort((a, b) => b[1] - a[1]);
  if (hookEntries.length) {
    lines.push("", "### Hook types that worked for you");
    hookEntries.slice(0, 6).forEach(([k, v]) => lines.push(`- ${k}: ${v} wins`));
  }

  if (summary.topPatterns.length) {
    lines.push("", "### Top winning patterns to emulate");
    summary.topPatterns.forEach((p, i) => {
      lines.push(
        `${i + 1}. [${p.source}] Hook: "${p.hook}"` +
          (p.whatWorked ? ` | Tactic: ${p.whatWorked}` : "") +
          (p.myGmv ? ` | GMV £${p.myGmv}` : "") +
          (p.rating ? ` | Rating ${p.rating}/5` : "")
      );
    });
  }

  return lines.join("\n");
}
