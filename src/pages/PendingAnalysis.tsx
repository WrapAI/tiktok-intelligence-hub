import { useEffect, useState } from "react";
import type { PendingAnalysis, PendingAnalysisSubmit } from "../hub";
import ScriptContentCard from "../components/ScriptContentCard";

const EMPTY_SUBMIT: PendingAnalysisSubmit = {
  upload_date: new Date().toISOString().slice(0, 10),
  watch_time_pct: null,
  sales: null,
  gmv: null,
  commission: null,
  audience_male_pct: null,
  audience_female_pct: null,
  audience_other_pct: null,
};

function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

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

export default function PendingAnalysisPage() {
  const [items, setItems] = useState<PendingAnalysis[]>([]);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [submitDrafts, setSubmitDrafts] = useState<Record<string, PendingAnalysisSubmit>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [driveConnected, setDriveConnected] = useState(false);
  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);

  async function load() {
    const list = await window.hub.listPendingAnalysis();
    setItems(list);
  }

  useEffect(() => {
    void load();
    window.hub.getGoogleDriveStatus().then((s) => setDriveConnected(!!s.connected));
    window.hub.checkWhisper().then(setWhisperOk);
  }, []);

  const active = items.filter((i) => i.status !== "complete");
  const completed = items.filter((i) => i.status === "complete");

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
    const res = await window.hub.pullPendingAnalysis(id);
    setLoadingId(null);
    if (!res.ok) {
      setError(res.error || "Pull stats / analysis failed");
      return;
    }
    setNotice("Latest stats pulled and Grok analysis complete.");
    setExpandedId(id);
    void load();
  }

  function getSubmitDraft(item: PendingAnalysis): PendingAnalysisSubmit {
    return (
      submitDrafts[item.id] || {
        ...EMPTY_SUBMIT,
        upload_date: item.upload_date || new Date().toISOString().slice(0, 10),
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

  async function handleSubmit(id: string) {
    const draft = submitDrafts[id] || getSubmitDraft(items.find((i) => i.id === id)!);
    setLoadingId(id);
    setError("");
    setNotice("");
    const res = await window.hub.submitPendingAnalysis({ id, data: draft });
    setLoadingId(null);
    if (!res.ok) {
      setError(res.error || "Submit failed");
      return;
    }
    setNotice(`Submitted to memory — score ${res.score ?? "—"}/100`);
    void load();
  }

  async function handleDelete(id: string, deleteScript = false) {
    const msg = deleteScript
      ? "Delete this entry and its script permanently?"
      : "Remove this pending analysis entry?";
    if (!confirm(msg)) return;
    const res = await window.hub.deletePendingAnalysis({ id, deleteScript });
    if (!res.ok) {
      setError(res.error || "Delete failed");
      return;
    }
    void load();
  }

  function renderCard(item: PendingAnalysis) {
    const trackingDays = daysSince(item.url_added_at);
    const draft = getSubmitDraft(item);
    const isLoading = loadingId === item.id;

    return (
      <div key={item.id} className={`card pending-card${item.status === "awaiting_url" ? " pending-card-urgent" : ""}`}>
        <div className="pending-card-header">
          <div>
            <div className="card-title">{item.script_title}</div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {item.product_name} · Drive upload {new Date(item.drive_uploaded_at).toLocaleString()}
            </p>
          </div>
          <span className={statusClass(item.status)}>{statusLabel(item.status)}</span>
        </div>

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

            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginBottom: 12 }}
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
            >
              {expandedId === item.id ? "Hide Grok analysis" : "Show Grok analysis"}
            </button>

            {expandedId === item.id && item.analysis && (
              <div className="script-output" style={{ marginBottom: 14, fontSize: 13 }}>
                <strong>Hook:</strong> {item.analysis.onscreen_hook || "—"}
                <br />
                <strong>Type:</strong> {item.analysis.hook_type || "—"} · {item.analysis.funnel_category || "—"}
                <br />
                <br />
                {item.analysis.detailed_analysis}
              </div>
            )}

            <div className="card-title" style={{ fontSize: "0.9rem" }}>Your performance data</div>
            <div className="grid-2">
              <div>
                <label className="field-label">Upload date</label>
                <input
                  className="field-input"
                  type="date"
                  value={draft.upload_date}
                  onChange={(e) => updateSubmitDraft(item.id, { upload_date: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label">Watch time %</label>
                <input
                  className="field-input"
                  type="number"
                  placeholder="e.g. 42"
                  value={draft.watch_time_pct ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { watch_time_pct: num(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">Sales (units)</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.sales ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { sales: num(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">GMV (£)</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.gmv ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { gmv: num(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">Commission (£)</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.commission ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { commission: num(e.target.value) })}
                />
              </div>
            </div>
            <div className="card-title" style={{ fontSize: "0.85rem", marginTop: 12 }}>Audience split %</div>
            <div className="grid-2">
              <div>
                <label className="field-label">Male %</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.audience_male_pct ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { audience_male_pct: num(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">Female %</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.audience_female_pct ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { audience_female_pct: num(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">Other %</label>
                <input
                  className="field-input"
                  type="number"
                  value={draft.audience_other_pct ?? ""}
                  onChange={(e) => updateSubmitDraft(item.id, { audience_other_pct: num(e.target.value) })}
                />
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLoading}
                onClick={() => void handleSubmit(item.id)}
              >
                {isLoading ? "Submitting…" : "Submit to memory & score"}
              </button>
            </div>
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
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: "6px 10px" }}
            onClick={() => void handleDelete(item.id, false)}
          >
            Remove entry
          </button>
          {item.source_script_id && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 11, padding: "6px 10px", color: "var(--accent)" }}
              onClick={() => void handleDelete(item.id, true)}
            >
              Delete script & entry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="page-title">Pending Analysis</h2>
      <p className="page-desc">
        After you upload a voiceover to Google Drive, it lands here. Edit the script, regenerate audio, or re-upload
        anytime — changes reset tracking. Add your TikTok URL once posted, pull stats + Grok analysis, then submit.
        Completed outcomes are saved to <code>video_outcomes.json</code> for AI learning.
      </p>

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

      {active.length === 0 && completed.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing pending yet.</p>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Generate a script → create ElevenLabs audio → Send to Google Drive. It will appear here automatically.
          </p>
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
