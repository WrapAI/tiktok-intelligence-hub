import type { JsonStore } from "../db.js";
import type { MyVideo } from "./myVideoAnalysis.js";
import { getAnalysisDurationSeconds } from "./watchTime.js";
import type { HookTypeStat } from "./libraryPerformance.js";
import { pickHookTypeForScript } from "./scriptVariety.js";
import type { VideoOutcome } from "./videoOutcomes.js";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeHookKey(h: string): string {
  return h.toLowerCase().replace(/_/g, " ").trim();
}

export function isConfirmedSaleVideo(v: MyVideo): boolean {
  return num(v.views) > 0 && num(v.gmv) > 0 && num(v.sales) > 0;
}

export function listTopPerformingVideos(store: JsonStore, limit = 5): MyVideo[] {
  return store
    .list<MyVideo>("my_videos")
    .filter(isConfirmedSaleVideo)
    .sort((a, b) => num(b.gmv) - num(a.gmv))
    .slice(0, limit);
}

function hookTextForVideo(v: MyVideo): string {
  const a = v.analysis;
  if (a?.onscreen_hook?.trim()) return a.onscreen_hook.trim();
  if (v.hook?.trim()) return v.hook.trim();
  if (v.title?.trim()) return v.title.trim();
  if (a?.raw_json) {
    try {
      const row = JSON.parse(a.raw_json) as Record<string, unknown>;
      const hooks = row.hooks as Record<string, unknown> | undefined;
      const fromHooks = hooks?.on_screen_text ?? row.onscreen_hook ?? row.hook;
      if (typeof fromHooks === "string" && fromHooks.trim()) return fromHooks.trim();
    } catch {
      /* ignore */
    }
  }
  return "—";
}

function whatWorkedForVideo(store: JsonStore, v: MyVideo): string {
  const mem = store
    .list<{ payload_json: string; my_video_id?: string }>("positive_memory")
    .find((m) => {
      if (m.my_video_id === v.id) return true;
      try {
        const p = JSON.parse(m.payload_json) as { my_video_id?: string };
        return p.my_video_id === v.id;
      } catch {
        return false;
      }
    });
  if (mem) {
    try {
      const p = JSON.parse(mem.payload_json) as { what_i_took?: string };
      if (p.what_i_took?.trim()) return p.what_i_took.trim().slice(0, 280);
    } catch {
      /* ignore */
    }
  }
  return v.analysis?.detailed_analysis?.trim().slice(0, 280) || "";
}

function videoHaystack(v: MyVideo): string {
  return [
    v.title,
    v.hook,
    v.key_message,
    v.analysis?.onscreen_hook,
    v.analysis?.detailed_analysis,
    v.analysis?.transcript,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function videoMatchesProduct(
  store: JsonStore,
  video: MyVideo,
  productId: string,
  productName: string
): boolean {
  const outcomes = store.list<VideoOutcome>("video_outcomes");
  const outcome = outcomes.find((o) => o.linked_my_video_id === video.id);
  if (outcome?.product_id && outcome.product_id === productId) return true;
  if (outcome?.product_name && productName) {
    if (outcome.product_name.toLowerCase() === productName.toLowerCase()) return true;
  }

  const hay = videoHaystack(video);
  if (!hay || !productName.trim()) return false;
  const name = productName.toLowerCase().trim();
  if (name.length >= 4 && hay.includes(name)) return true;

  const tokens = name.split(/\W+/).filter((t) => t.length >= 4);
  if (!tokens.length) return false;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(2, tokens.length) || (tokens.length === 1 && hits === 1);
}

export function listProductPerformingVideos(
  store: JsonStore,
  productId: string,
  productName: string
): MyVideo[] {
  return store
    .list<MyVideo>("my_videos")
    .filter((v) => num(v.gmv) > 0 && videoMatchesProduct(store, v, productId, productName))
    .sort((a, b) => num(b.gmv) - num(a.gmv));
}

export function formatTopPerformingVideosBlock(
  store: JsonStore,
  limit = 5,
  opts: { compact?: boolean } = {}
): string {
  const top = listTopPerformingVideos(store, limit);
  if (!top.length) {
    return "## MY TOP PERFORMING VIDEOS\n\nNo confirmed sales data in My Videos yet — write from library patterns until personal GMV data exists.";
  }

  const lines: string[] = opts.compact
    ? [
        "## MY TOP PERFORMING VIDEOS (compact)",
        "",
        "Real creator videos with confirmed sales — mirror mechanics, not words.",
        "",
      ]
    : [
        "## MY TOP PERFORMING VIDEOS — learn from these, apply patterns to every script",
        "",
        "These are real videos from this creator's account with confirmed sales data.",
        "Study the hook, structure, audience split, watch time percentage, and GMV.",
        "When writing a new script, mirror what worked. Do not copy words — copy the mechanic.",
        "",
      ];

  top.forEach((v, i) => {
    const duration = getAnalysisDurationSeconds(v.analysis);
    const watchSec = v.watch_time_seconds;
    const watchPct = v.watch_time_pct;
    const watchLine =
      watchSec != null && duration
        ? `${watchSec}s (${watchPct ?? "?"}% of ${duration}s)`
        : watchPct != null
          ? `${watchPct}%${duration ? ` / ${duration}s` : ""}`
          : "—";

    if (opts.compact) {
      lines.push(
        `${i + 1}. **${hookTextForVideo(v).slice(0, 70)}** · ${v.views ?? "?"} views · ${watchLine} · ${v.sales ?? "?"} sales · £${num(v.gmv).toFixed(0)} GMV · ${v.audience_female_pct ?? "?"}% F · ${v.analysis?.funnel_category || "—"}`
      );
      return;
    }

    lines.push(`### Video ${i + 1} — ${hookTextForVideo(v)}`);
    lines.push(`- Views: ${v.views ?? "—"}`);
    lines.push(`- Likes: ${v.likes ?? "—"}`);
    lines.push(`- Avg watch time: ${watchLine}`);
    lines.push(`- Sales: ${v.sales ?? "—"} units`);
    lines.push(`- GMV: £${num(v.gmv).toFixed(2)}`);
    lines.push(
      `- Audience: ${v.audience_male_pct ?? "—"}% male / ${v.audience_female_pct ?? "—"}% female`
    );
    lines.push(`- Upload date: ${String(v.upload_date || "—").slice(0, 10)}`);
    lines.push(`- Hook used: ${hookTextForVideo(v)}`);
    const worked = whatWorkedForVideo(store, v);
    lines.push(`- What worked: ${worked ? worked.slice(0, 160) : ""}`);
    lines.push(`- Funnel type: ${v.analysis?.funnel_category || "—"}`);
    lines.push("");
    lines.push("PATTERN NOTES FROM THIS VIDEO:");
    if (watchPct != null) {
      lines.push(
        `- Watch time % of ${watchPct}% means the hook held attention for ${watchPct}% of the video — mirror this pacing`
      );
    }
    lines.push(
      `- GMV of £${num(v.gmv).toFixed(2)} from ${v.sales ?? "?"} sales — this structure converted. Replicate the offer framing.`
    );
    if (v.audience_female_pct != null) {
      lines.push(
        `- Audience was ${v.audience_female_pct}% female — write for this audience unless product context overrides`
      );
    }
    if (duration) {
      lines.push(`- Video was ${duration}s — target similar length for this product type`);
    }
    lines.push("");
  });

  if (!opts.compact) {
    lines.push(
      "WHAT TO TAKE FROM THIS DATA:",
      "- Hooks that held watch time above 30% are proven — study their structure and length",
      "- Videos with high GMV relative to views had strong offer framing — mirror the discount reveal structure",
      "- Audience split tells you who is buying — write the relatable mistake line for that person",
      "- Short videos (under 20s) that converted well mean the product sells itself — keep copy tight",
      "- Do not reference these videos directly in the script — extract the mechanic, apply it invisibly"
    );
  } else {
    lines.push("", "Extract mechanics invisibly — do not copy hooks verbatim.");
  }

  return lines.join("\n");
}

export type PerformanceHookDecision = {
  hookType: string;
  poolSize: number;
  assignReason: string;
  performanceContextBlock: string;
  preferredDuration: number | null;
  topPerformersForVisuals: MyVideo[];
};

export function pickHookWithPerformanceContext(
  store: JsonStore,
  productId: string,
  productName: string,
  libraryStats: HookTypeStat[],
  recentHookTypes: string[]
): PerformanceHookDecision {
  const productVideos = listProductPerformingVideos(store, productId, productName);
  const topGlobal = listTopPerformingVideos(store, 5);

  if (!productVideos.length) {
    const lib = pickHookTypeForScript(libraryStats, recentHookTypes);
    return {
      hookType: lib.hookType,
      poolSize: lib.poolSize,
      assignReason: "no personal sales data for this product yet — library variety",
      preferredDuration: null,
      topPerformersForVisuals: topGlobal,
      performanceContextBlock: buildPerformanceContextBlock({
        productName,
        top: null,
        assignedHook: lib.hookType,
        reason: "no data yet — using library engagement + variety rotation",
      }),
    };
  }

  const top = productVideos[0];
  const preferredHook = top.analysis?.hook_type?.trim() || "pattern interrupt";
  const preferredNorm = normalizeHookKey(preferredHook);
  const recent3 = recentHookTypes.slice(0, 3);
  const sameFamily =
    recent3.length >= 3 && recent3.every((h) => normalizeHookKey(h) === preferredNorm);

  let hookType: string;
  let poolSize: number;
  let reason: string;

  if (sameFamily) {
    const lib = pickHookTypeForScript(libraryStats, recentHookTypes);
    hookType = lib.hookType;
    poolSize = lib.poolSize;
    reason = `rotation after 3 consecutive "${preferredHook}" scripts for this product`;
  } else {
    hookType = preferredHook;
    poolSize = 1;
    reason = `top performer match — GMV £${num(top.gmv).toFixed(2)} from ${top.sales ?? "?"} sales`;
  }

  return {
    hookType,
    poolSize,
    assignReason: reason,
    preferredDuration: getAnalysisDurationSeconds(top.analysis),
    topPerformersForVisuals: productVideos.slice(0, 3).length ? productVideos.slice(0, 3) : topGlobal,
    performanceContextBlock: buildPerformanceContextBlock({
      productName,
      top,
      assignedHook: hookType,
      reason,
    }),
  };
}

function buildPerformanceContextBlock(opts: {
  productName: string;
  top: MyVideo | null;
  assignedHook: string;
  reason: string;
}): string {
  const lines = [
    "## PERFORMANCE CONTEXT FOR THIS PRODUCT",
    "",
    `Product: ${opts.productName}`,
    "",
  ];

  if (opts.top) {
    const duration = getAnalysisDurationSeconds(opts.top.analysis);
    lines.push(
      "Best performing script to date:",
      `- Hook: ${hookTextForVideo(opts.top)}`,
      `- Length: ${duration ?? "—"}s`,
      `- Watch time: ${opts.top.watch_time_pct ?? "—"}%`,
      `- GMV: £${num(opts.top.gmv).toFixed(2)}`,
      `- Sales: ${opts.top.sales ?? "—"}`,
      `- Funnel: ${opts.top.analysis?.funnel_category || "—"}`,
      "",
      "This structure worked. Mirror the mechanic — do not copy the words.",
      ""
    );
  } else {
    lines.push("Best performing script to date: none recorded for this product yet.", "");
  }

  lines.push(`Assigned hook this script: ${opts.assignedHook}`);
  lines.push(`Reason: ${opts.reason}`);

  return lines.join("\n");
}

export function buildVisualDirectorRulesBlock(topVideos: MyVideo[]): string {
  const lines: string[] = [
    "## VISUAL DIRECTOR RULES (include visualDirector in JSON output)",
    "",
    "- Write shot descriptions in plain simple English — the creator should be able to read one line and know exactly what to film",
    "- 75% of shots must include human interaction (hands, arms — no face)",
    "- No insane zooms — subtle slow pushes only, maximum 10% zoom, note this where relevant",
    "- Shots should match the audio line playing at that moment — sync description to script timing",
    "- Keep it short — maximum 4 shots for a 15s video, 6 shots for a 30s video",
    "- Every shot description maximum 2 sentences — no essays",
    "- watchTimeHook must describe something visually interesting in the first 2 seconds that makes someone stop scrolling",
  ];

  if (topVideos.length) {
    lines.push("", "Base shot recommendations on what worked in top performing videos:");
    for (const v of topVideos.slice(0, 3)) {
      const hook = hookTextForVideo(v);
      const visual =
        v.analysis?.raw_json &&
        (() => {
          try {
            const row = JSON.parse(v.analysis!.raw_json!) as Record<string, unknown>;
            const hooks = row.hooks as Record<string, unknown> | undefined;
            return String(hooks?.visual_action || row.visual_action || "").slice(0, 120);
          } catch {
            return "";
          }
        })();
      lines.push(
        `- GMV £${num(v.gmv).toFixed(0)} · ${hook.slice(0, 60)}${visual ? ` · visual: ${visual}` : ""}`
      );
    }
    lines.push(
      "- If top GMV videos used product-only close-ups → recommend them",
      "- If top GMV videos used hand interaction → recommend that as the primary shot type",
      "- Match video length to top performers for this product type"
    );
  }

  return lines.join("\n");
}

export function buildVisualDirectorRulesBlockCompact(topVideos: MyVideo[]): string {
  const lines = [
    "## VISUAL DIRECTOR (include visualDirector in JSON)",
    "- Plain English shots synced to audio · 75% hands/no face · max 10% zoom · 4 shots/15s, 6/30s",
    "- watchTimeHook = scroll-stop visual in first 2 seconds",
  ];
  if (topVideos.length) {
    const ref = topVideos[0];
    lines.push(
      `- Top GMV reference: ${hookTextForVideo(ref).slice(0, 50)} · £${num(ref.gmv).toFixed(0)} · match hand/product style from winners`
    );
  }
  return lines.join("\n");
}

export function formatTopGmvPerformersTable(store: JsonStore): string {
  const top = listTopPerformingVideos(store, 3);
  if (!top.length) return "";

  const rows = top.map((v) => {
    const hook = hookTextForVideo(v).replace(/\|/g, "/").slice(0, 80);
    const duration = getAnalysisDurationSeconds(v.analysis);
    return `| ${hook} | £${num(v.gmv).toFixed(2)} | ${v.sales ?? "—"} | ${v.watch_time_pct ?? "—"}% | ${duration ?? "—"}s | ${v.analysis?.funnel_category || "—"} |`;
  });

  return [
    "## TOP GMV PERFORMERS (updated on sync)",
    "",
    "| Hook | GMV | Sales | Watch % | Length | Funnel |",
    "|------|-----|-------|---------|--------|--------|",
    ...rows,
  ].join("\n");
}
