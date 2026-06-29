import { useEffect, useState } from "react";
import type { PendingAnalysis, PendingAnalysisSubmit, Product } from "../hub";
import ScriptContentCard from "../components/ScriptContentCard";
import PendingPerformanceForm from "../components/PendingPerformanceForm";
import { getAnalysisDurationSeconds } from "../utils/watchTime";

const EMPTY_SUBMIT: PendingAnalysisSubmit = {
  upload_date: new Date().toISOString().slice(0, 10),
  watch_time_seconds: null,
  sales: null,
  gmv: null,
  commission: null,
  audience_male_pct: null,
  audience_female_pct: null,
  audience_other_pct: null,
};

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

type DateFilter = "all" | "1" | "7" | "28";
type StatusFilter = "all" | "active" | "complete";

function matchesDateFilter(item: PendingAnalysis, filter: DateFilter): boolean {
  if (filter === "all") return true;
  const days = Number(filter);
  const iso = item.script_created_at || item.created_at;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return d >= cutoff;
}

function statusLabel(status: PendingAnalysis["status"]) {
  switch (status) {
    case "awaiting_url":
      return "Needs TikTok URL";
    case "tracking":
      return "Tracking";
    case "ready_for_review":
      return "Ready to submit";
    case "complete":
      return "Complete";
  }
}

function statusClass(status: PendingAnalysis["status"]) {
  switch (status) {
    case "awaiting_url":
      return "pending-status awaiting";
    case "tracking":
      return "pending-status tracking";
    case "ready_for_review":
      return "pending-status ready";
    case "complete":
      return "pending-status complete";
  }
}

function scoreColor(score: number | null) {
  if (score == null) return "#666";
  if (score >= 70) return "#4caf50";
  if (score >= 40) return "#ff9800";
  return "#f44336";
}

function StatsBlock({
  label,
  stats,
}: {
  label: string;
  stats: PendingAnalysis["initial_stats"];
}) {
  if (!stats) return null;
  return (
    <div className="pending-stats-block">
      <div className="card-title" style={{ fontSize: "0.85rem", marginBottom: 6 }}>
        {label}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {formatCount(stats.views)} views · {formatCount(stats.likes)} likes · {formatCount(stats.comments)} comments
        {stats.reposts != null ? ` · ${formatCount(stats.reposts)} shares` : ""}
        <br />
        <span style={{ opacity: 0.7 }}>Captured {new Date(stats.captured_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function PendingAnalysisPage({ tabActive = true }: { tabActive?: boolean }) {
  const [items, setItems] = useState<PendingAnalysis[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [submitDrafts, setSubmitDrafts] = useState<Record<string, PendingAnalysisSubmit>>({});
  const [statsDrafts, setStatsDrafts] = useState<
    Record<string, { views: number | null; likes: number | null; comments: number | null }>
  >({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [productFilter, setProductFilter] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [batchLoading, setBatchLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; deleteScript: boolean } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [performanceErrors, setPerformanceErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [driveConnected, setDriveConnected] = useState(false);
  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);

  async function load() {
    const list = await window.hub.listPendingAnalysis();
    setItems(list);
  }

  useEffect(() => {
    if (!tabActive) return;
    void load();
    window.hub.getGoogleDriveStatus().then((s) => setDriveConnected(!!s.connected));
    window.hub.checkWhisper().then(setWhisperOk);
    window.hub.listProducts().then(setProducts);
  }, [tabActive]);

  function applyFilters(list: PendingAnalysis[]) {
    return list.filter((item) => {
      if (productFilter) {
        if (item.product_id) {
          if (item.product_id !== productFilter) return false;
        } else {
          const name = products.find((p) => p.id === productFilter)?.name;
          if (name && item.product_name !== name) return false;
        }
      }
      if (!matchesDateFilter(item, dateFilter)) return false;
      if (statusFilter === "active" && item.status === "complete") return false;
      if (statusFilter === "complete" && item.status !== "complete") return false;
      return true;
    });
  }

  const filtered = applyFilters(items);
  const active = filtered.filter((i) => i.status !== "complete");
  const completed = filtered.filter((i) => i.status === "complete");

  async function handleBatchImport(daysBack: number) {
    setBatchLoading(true);
    setError("");
    setNotice("");
    const res = await window.hub.batchPendingScripts({ daysBack });
    setBatchLoading(false);
    if (!res.ok) {
      setError(res.error || "Import failed");
      return;
    }
    const parts = [`${res.added ?? 0} added`];
    if (res.skipped) parts.push(`${res.skipped} already pending`);
    if (res.skippedMyVideos) parts.push(`${res.skippedMyVideos} already in My Videos`);
    if (res.dismissed) parts.push(`${res.dismissed} previously removed`);
    if (res.scriptsCreated) parts.push(`${res.scriptsCreated} scripts recovered from audio`);
    setNotice(`Imported scripts from last ${daysBack} day${daysBack === 1 ? "" : "s"}: ${parts.join(", ")}.`);
    void load();
  }

  async function handleRemoveDuplicates() {
    setCleanupLoading(true);
    setError("");
    setNotice("");
    const res = await window.hub.removeDuplicatePending();
    setCleanupLoading(false);
    if (!res.ok) {
      setError(res.error || "Could not remove duplicates");
      return;
    }
    setNotice(
      res.removed
        ? `Removed ${res.removed} duplicate pending ${res.removed === 1 ? "entry" : "entries"}.`
        : "No duplicate pending entries found."
    );
    void load();
  }

  async function handleClearDismissals() {
    setCleanupLoading(true);
    setError("");
    setNotice("");
    const res = await window.hub.clearPendingDismissals();
    setCleanupLoading(false);
    if (!res.ok) {
      setError(res.error || "Could not clear removal blocklist");
      return;
    }
    setNotice(
      res.cleared
        ? `Cleared ${res.cleared} previously removed ${res.cleared === 1 ? "entry" : "entries"} — those scripts can be imported again.`
        : "No previously removed entries on the blocklist."
    );
  }

  async function handleSetUrl(id: string) {
    const item = items.find((i) => i.id === id);
    const url = (urlDrafts[id] ?? item?.tiktok_url ?? "").trim();
    if (!url) {
      setError("Enter a TikTok URL.");
      return;
    }
    if (whisperOk === false) {
      setError("Whisper server is not running. Start whisper-server/start.bat, then try again.");
      return;
    }
    setLoadingId(id);
    setError("");
    setNotice("");
    const res = await window.hub.setPendingAnalysisUrl({ id, url });
    setLoadingId(null);
    if (!res.ok) {
      setError(res.error || "Could not capture stats");
      void load();
      return;
    }
    setNotice("URL saved — initial stats captured.");
    void load();
  }

  async function handlePull(id: string) {
    setLoadingId(id);
    setError("");
    setNotice("");
    try {
      const res = await window.hub.pullPendingAnalysis(id);
      if (!res.ok) {
        setError(res.error || "Pull stats / analysis failed");
        return;
      }
      setNotice("Latest stats pulled and Grok analysis complete.");
      setExpandedId(id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingId(null);
    }
  }

  function getSubmitDraft(item: PendingAnalysis): PendingAnalysisSubmit {
    return (
      submitDrafts[item.id] || {
        ...EMPTY_SUBMIT,
        upload_date: item.upload_date || new Date().toISOString().slice(0, 10),
        watch_time_seconds: item.watch_time_seconds,
        watch_time_pct: item.watch_time_pct,
        sales: item.sales,
        gmv: item.gmv,
        commission: item.commission,
        audience_male_pct: item.audience_male_pct,
        audience_female_pct: item.audience_female_pct,
        audience_other_pct: item.audience_other_pct,
      }
    );
  }

  function updateSubmitDraft(id: string, patch: Partial<PendingAnalysisSubmit>) {
    setSubmitDrafts((prev) => {
      const item = items.find((i) => i.id === id);
      const base = item ? getSubmitDraft(item) : EMPTY_SUBMIT;
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  function getStatsDraft(item: PendingAnalysis) {
    return (
      statsDrafts[item.id] || {
        views: item.views,
        likes: item.likes,
        comments: item.comments,
      }
    );
  }

  function updateStatsDraft(
    id: string,
    patch: Partial<{ views: number | null; likes: number | null; comments: number | null }>
  ) {
    setStatsDrafts((prev) => {
      const item = items.find((i) => i.id === id);
      const base = item ? getStatsDraft(item) : { views: null, likes: null, comments: null };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  function buildPayload(item: PendingAnalysis): PendingAnalysisSubmit {
    const draft = submitDrafts[item.id] || getSubmitDraft(item);
    const stats = getStatsDraft(item);
    return {
      ...draft,
      views: stats.views,
      likes: stats.likes,
      comments: stats.comments,
    };
  }

  async function handleSavePerformance(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setLoadingId(id);
    setError("");
    setPerformanceErrors((prev) => ({ ...prev, [id]: "" }));
    setNotice("");
    try {
      if (typeof window.hub.updatePendingPerformance !== "function") {
        throw new Error("Hub is out of date — quit and restart from start.bat, then try again.");
      }
      const res = await window.hub.updatePendingPerformance({ id, data: buildPayload(item) });
      if (!res.ok) {
        setPerformanceErrors((prev) => ({ ...prev, [id]: res.error || "Could not save performance data" }));
        return;
      }
      setNotice("Performance data saved.");
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPerformanceErrors((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleSubmit(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const payload = buildPayload(item);
    setLoadingId(id);
    setError("");
    setPerformanceErrors((prev) => ({ ...prev, [id]: "" }));
    setNotice("");
    try {
      const duration = getAnalysisDurationSeconds(item.analysis);
      if (duration == null) {
        setPerformanceErrors((prev) => ({
          ...prev,
          [id]: "Video duration missing — click Pull stats & analyse again (restart whisper-server first).",
        }));
        return;
      }
      if (payload.watch_time_seconds == null && payload.watch_time_pct == null) {
        setPerformanceErrors((prev) => ({
          ...prev,
          [id]: "Enter average watch time in seconds from TikTok Studio.",
        }));
        return;
      }
      const res = await window.hub.submitPendingAnalysis({ id, data: payload });
      if (!res.ok) {
        setPerformanceErrors((prev) => ({ ...prev, [id]: res.error || "Submit failed" }));
        return;
      }
      setNotice(`Sent to My Videos & memory — score ${res.score ?? "—"}/100`);
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPerformanceErrors((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: string, deleteScript = false) {
    setError("");
    const res = await window.hub.deletePendingAnalysis({ id, deleteScript });
    setConfirmDelete(null);
    if (!res.ok) {
      setError(res.error || "Delete failed");
      return;
    }
    setNotice(deleteScript ? "Entry and script deleted permanently." : "Entry removed — will not be re-imported.");
    void load();
  }

  function renderPerformanceSection(item: PendingAnalysis, isLoading: boolean, showAnalysis: boolean) {
    const draft = getSubmitDraft(item);
    const stats = getStatsDraft(item);
    const durationSeconds = getAnalysisDurationSeconds(item.analysis);
    const canComplete = item.status === "ready_for_review" && item.analysis_status === "complete";
    const performanceError = performanceErrors[item.id];

    return (
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
        <div className="card-title" style={{ fontSize: "0.9rem", marginBottom: 10 }}>
          Performance data (from TikTok Studio / Compass)
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Fill in GMV, watch time, audience split, and sales — same fields as My Videos. Save as you go, then
          complete once Grok analysis is done.
        </p>

        <PendingPerformanceForm
          draft={draft}
          durationSeconds={durationSeconds}
          views={stats.views}
          likes={stats.likes}
          comments={stats.comments}
          onChange={(patch) => updateSubmitDraft(item.id, patch)}
          onViewsChange={(v) => updateStatsDraft(item.id, { views: v })}
          onLikesChange={(v) => updateStatsDraft(item.id, { likes: v })}
          onCommentsChange={(v) => updateStatsDraft(item.id, { comments: v })}
        />

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isLoading}
            onClick={() => void handleSavePerformance(item.id)}
          >
            {isLoading ? "Saving…" : "Save performance data"}
          </button>
          {canComplete && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={isLoading}
              onClick={() => void handleSubmit(item.id)}
            >
              {isLoading ? "Completing…" : "Complete → My Videos & memory"}
            </button>
          )}
        </div>

        {performanceError && <p className="error" style={{ marginTop: 10, fontSize: 13 }}>{performanceError}</p>}

        {!canComplete && item.status === "tracking" && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Run <strong>Pull stats & analyse</strong> above when ready — then you can complete and send to My Videos.
          </p>
        )}

        {showAnalysis && item.analysis && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: 14, marginBottom: 12 }}
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              {expandedId === item.id ? "Hide Grok analysis" : "Show Grok analysis"}
            </button>
            {expandedId === item.id && (
              <div className="script-output" style={{ marginBottom: 14, fontSize: 13 }}>
                <strong>Hook:</strong> {item.analysis.onscreen_hook || "—"}
                <br />
                <strong>Type:</strong> {item.analysis.hook_type || "—"} · {item.analysis.funnel_category || "—"}
                <br />
                <br />
                {item.analysis.detailed_analysis}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderCard(item: PendingAnalysis) {
    const trackingDays = daysSince(item.url_added_at);
    const isLoading = loadingId === item.id;

    return (
      <div key={item.id} className={`card pending-card${item.status === "awaiting_url" ? " pending-card-urgent" : ""}`}>
        <div className="pending-card-header">
          <div>
            <div className="card-title">{item.script_title}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {item.product_name} · Generated{" "}
              {new Date(item.script_created_at || item.created_at).toLocaleString()}
              {item.drive_uploaded_at
                ? ` · Drive upload ${new Date(item.drive_uploaded_at).toLocaleString()}`
                : ""}
            </p>
          </div>
          <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
        </div>

        {(item.on_screen_caption || item.tiktok_caption) && (
          <div className="pending-captions" style={{ marginTop: 10, fontSize: 13 }}>
            {item.on_screen_caption && (
              <div style={{ marginBottom: 8 }}>
                <span className="field-label">On-screen caption</span>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{item.on_screen_caption}</p>
              </div>
            )}
            {item.tiktok_caption && (
              <div>
                <span className="field-label">TikTok caption</span>
                <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{item.tiktok_caption}</p>
              </div>
            )}
          </div>
        )}

        {item.source_script_id && (
          <div style={{ marginTop: 12, marginBottom: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <ScriptContentCard
              scriptId={item.source_script_id}
              pendingAnalysisId={item.status !== "complete" ? item.id : undefined}
              editable={item.status !== "complete"}
              showDriveUpload={item.status !== "complete"}
              driveConnected={driveConnected}
              onUpdated={() => {
                setNotice("Script updated — tracking reset to Needs TikTok URL.");
                void load();
              }}
              onDriveUploaded={(msg) => {
                setNotice(msg);
                void load();
              }}
              onError={setError}
            />
          </div>
        )}

        {item.status === "awaiting_url" && (
          <div style={{ marginTop: 14 }}>
            <label className="field-label">TikTok URL (posted video)</label>
            <input
              className="field-input"
              placeholder="https://www.tiktok.com/@you/video/…"
              value={urlDrafts[item.id] ?? item.tiktok_url ?? ""}
              onChange={(e) => setUrlDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
            />
            {item.tiktok_url && !item.initial_stats && (
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                URL saved — stats capture failed last time. Fix whisper-server / cookies, then click again.
              </p>
            )}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLoading || whisperOk === false}
                onClick={() => void handleSetUrl(item.id)}
              >
                {isLoading ? "Fetching stats…" : item.tiktok_url && !item.initial_stats ? "Retry stats capture" : "Save URL & capture stats"}
              </button>
            </div>
          </div>
        )}

        {item.status === "tracking" && (
          <div style={{ marginTop: 14 }}>
            <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Tracking since {item.url_added_at ? new Date(item.url_added_at).toLocaleDateString() : "—"}
              {trackingDays != null ? ` (${trackingDays} day${trackingDays !== 1 ? "s" : ""})` : ""}
            </p>
            <StatsBlock label="Stats when added" stats={item.initial_stats} />
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              When you're ready (e.g. 24–72h after posting), pull latest stats and run Grok video analysis.
            </p>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLoading}
                onClick={() => void handlePull(item.id)}
              >
                {isLoading ? "Pulling stats & analysing…" : "Pull stats & analyse"}
              </button>
            </div>
            {item.analysis_status === "error" && (
              <p className="error" style={{ marginTop: 8 }}>{item.analysis_error}</p>
            )}
            {renderPerformanceSection(item, isLoading, false)}
          </div>
        )}

        {item.status === "ready_for_review" && (
          <div style={{ marginTop: 14 }}>
            <div className="grid-2" style={{ gap: 12, marginBottom: 12 }}>
              <StatsBlock label="Stats when added" stats={item.initial_stats} />
              <StatsBlock label="Latest stats" stats={item.latest_stats} />
            </div>

            {item.initial_stats && item.latest_stats && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Views: {formatCount(item.initial_stats.views)} → {formatCount(item.latest_stats.views)}
              </p>
            )}

            {renderPerformanceSection(item, isLoading, true)}
          </div>
        )}

        {item.status === "complete" && (
          <div style={{ marginTop: 10 }}>
            <p style={{ fontSize: 14 }}>
              Score:{" "}
              <strong style={{ color: scoreColor(item.score) }}>{item.score ?? "—"}/100</strong>
              {" · "}
              {formatCount(item.views)} views · £{item.commission ?? item.gmv ?? "—"} earned
            </p>
            {item.tiktok_url && (
              <a href={item.tiktok_url} className="muted" style={{ fontSize: 12 }} target="_blank" rel="noreferrer">
                {item.tiktok_url}
              </a>
            )}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 12 }}>
          {confirmDelete?.id === item.id ? (
            <>
              <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
                {confirmDelete.deleteScript ? "Delete script and entry permanently?" : "Remove this entry?"}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 11, padding: "6px 10px" }}
                onClick={() => void handleDelete(item.id, confirmDelete.deleteScript)}
              >
                Confirm delete
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: "6px 10px" }}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: "6px 10px" }}
                onClick={() => setConfirmDelete({ id: item.id, deleteScript: false })}
              >
                Remove entry
              </button>
              {item.source_script_id && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: 11, padding: "6px 10px", color: "var(--accent)" }}
                  onClick={() => setConfirmDelete({ id: item.id, deleteScript: true })}
                >
                  Delete script & entry
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Pending Analysis</h2>
      <p className="page-desc">
        Track scripts from generation through posting. Import scripts by date, add your TikTok URL once posted,
        pull stats + Grok analysis, then submit. Deleted entries stay deleted and will not be re-imported.
      </p>

      <div className="card pending-toolbar" style={{ marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: "0.9rem", marginBottom: 10 }}>
          Import scripts
        </div>
        <div className="btn-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={batchLoading}
            onClick={() => void handleBatchImport(1)}
          >
            {batchLoading ? "Importing…" : "Import today"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={batchLoading}
            onClick={() => void handleBatchImport(7)}
          >
            Last 7 days
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={batchLoading}
            onClick={() => void handleBatchImport(28)}
          >
            Last 28 days
          </button>
        </div>
        <div className="btn-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={cleanupLoading || batchLoading}
            onClick={() => void handleRemoveDuplicates()}
          >
            {cleanupLoading ? "Cleaning…" : "Remove duplicates"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={cleanupLoading || batchLoading}
            onClick={() => void handleClearDismissals()}
          >
            Clear removal blocklist
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Scripts already in My Videos are skipped on import. Duplicate URLs or the same script twice in pending can
          be cleaned up above. Clearing the blocklist lets previously removed scripts be imported again.
        </p>
        <div className="grid-2" style={{ gap: 12 }}>
          <div>
            <label className="field-label">Product</label>
            <select
              className="field-input"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Generated</label>
            <select
              className="field-input"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            >
              <option value="all">All dates</option>
              <option value="1">Today</option>
              <option value="7">Last 7 days</option>
              <option value="28">Last 28 days</option>
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <select
              className="field-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="active">Active only</option>
              <option value="all">All statuses</option>
              <option value="complete">Complete only</option>
            </select>
          </div>
        </div>
      </div>

      {whisperOk === false && (
        <div className="card" style={{ borderColor: "#f44336", marginBottom: 12 }}>
          <p className="error" style={{ margin: 0 }}>
            Whisper server is offline — stats capture will not work until you start{" "}
            <code>tiktok-hook-analyzer/whisper-server/start.bat</code>.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}

      {items.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing pending yet.</p>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Click <strong>Import today</strong> to pull today&apos;s scripts, or generate a script → ElevenLabs audio →
            Send to Google Drive.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="muted">No entries match your filters.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <div className="card-title" style={{ marginBottom: 10 }}>
                Active ({active.length})
              </div>
              {active.map(renderCard)}
            </>
          )}

          {completed.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 16, marginBottom: 10 }}
                onClick={() => setShowCompleted((v) => !v)}
              >
                {showCompleted ? "Hide" : "Show"} completed ({completed.length})
              </button>
              {showCompleted && completed.map(renderCard)}
            </>
          )}
        </>
      )}
    </div>
  );
}
