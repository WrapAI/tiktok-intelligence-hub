import { useEffect, useRef, useState } from "react";
import type { MyVideo } from "../hub";
import { previewAverageWatchTimePct, getAnalysisDurationSeconds } from "../utils/watchTime";

const EMPTY_FORM = {
  url: "",
  views: "",
  likes: "",
  comments: "",
  watch_time_seconds: "",
  sales: "",
  gmv: "",
  commission: "",
  audience_male_pct: "",
  audience_female_pct: "",
  audience_other_pct: "",
  upload_date: new Date().toISOString().slice(0, 10),
};

type FormState = typeof EMPTY_FORM;

function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function scoreColor(score: number | null) {
  if (score == null) return "#666";
  if (score >= 70) return "#4caf50";
  if (score >= 40) return "#ff9800";
  return "#f44336";
}

function videoThumbnail(video: MyVideo): string | null {
  if (video.thumbnail_url) return video.thumbnail_url;
  if (!video.analysis?.raw_json) return null;
  try {
    const row = JSON.parse(video.analysis.raw_json) as Record<string, unknown>;
    const direct = row.frameDataUrl ?? row.thumbnail_url;
    return typeof direct === "string" && direct.trim() ? direct.trim() : null;
  } catch {
    return null;
  }
}

function videoToForm(v: MyVideo): FormState {
  const durationSeconds = getAnalysisDurationSeconds(v.analysis);
  return {
    url: v.url || "",
    views: v.views != null ? String(v.views) : "",
    likes: v.likes != null ? String(v.likes) : "",
    comments: v.comments != null ? String(v.comments) : "",
    watch_time_seconds:
      v.watch_time_seconds != null
        ? String(v.watch_time_seconds)
        : v.watch_time_pct != null && durationSeconds
          ? String(Math.round((v.watch_time_pct / 100) * durationSeconds * 10) / 10)
          : "",
    sales: v.sales != null ? String(v.sales) : "",
    gmv: v.gmv != null ? String(v.gmv) : "",
    commission: v.commission != null ? String(v.commission) : "",
    audience_male_pct: v.audience_male_pct != null ? String(v.audience_male_pct) : "",
    audience_female_pct: v.audience_female_pct != null ? String(v.audience_female_pct) : "",
    audience_other_pct: v.audience_other_pct != null ? String(v.audience_other_pct) : "",
    upload_date: v.upload_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  };
}

type VideoEditFormProps = {
  form: FormState;
  durationSeconds: number | null;
  onChange: (next: FormState) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
  submitLabel: string;
  thumbnailUrl: string | null;
};

function VideoEditForm({
  form,
  durationSeconds,
  onChange,
  onSubmit,
  onCancel,
  saving,
  title,
  submitLabel,
  thumbnailUrl,
}: VideoEditFormProps) {
  const set = (key: keyof FormState, value: string) => onChange({ ...form, [key]: value });
  const previewPct = previewAverageWatchTimePct(num(form.watch_time_seconds), durationSeconds);

  return (
    <form
      onSubmit={onSubmit}
      style={{ marginTop: 12, borderTop: "1px solid #222", paddingTop: 12 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>{title}</div>

          <label className="field-label">TikTok Video URL *</label>
          <input
            className="field-input"
            type="text"
            autoComplete="off"
            placeholder="https://www.tiktok.com/@..."
            value={form.url}
            onChange={(e) => set("url", e.target.value)}
          />

          <div className="card-title" style={{ marginTop: 4, fontSize: 12, color: "#aaa", fontWeight: 400 }}>
            PERFORMANCE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {(["views", "likes", "comments"] as const).map((key) => (
              <div key={key}>
                <label className="field-label">{key.charAt(0).toUpperCase() + key.slice(1)}</label>
                <input
                  className="field-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 4 }}>
            <label className="field-label">Avg watch time (seconds)</label>
            <input
              className="field-input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={durationSeconds ? "e.g. 8.5" : "Analyse video first"}
              disabled={durationSeconds == null}
              value={form.watch_time_seconds}
              onChange={(e) => set("watch_time_seconds", e.target.value)}
            />
            <p className="muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 8 }}>
              {durationSeconds == null
                ? "Run Grok analysis first — it confirms video duration."
                : previewPct != null
                  ? `→ ${previewPct}% average watch time (${form.watch_time_seconds}s of ${durationSeconds}s)`
                  : "Enter average watch time in seconds from TikTok Studio."}
            </p>
          </div>

          <div className="card-title" style={{ fontSize: 12, color: "#aaa", fontWeight: 400 }}>SALES</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label">Sales (units)</label>
              <input className="field-input" type="text" inputMode="numeric" autoComplete="off" placeholder="0" value={form.sales} onChange={(e) => set("sales", e.target.value)} />
            </div>
            <div>
              <label className="field-label">GMV (£)</label>
              <input className="field-input" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.gmv} onChange={(e) => set("gmv", e.target.value)} />
            </div>
            <div>
              <label className="field-label">Commission (£)</label>
              <input className="field-input" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={form.commission} onChange={(e) => set("commission", e.target.value)} />
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 4, fontSize: 12, color: "#aaa", fontWeight: 400 }}>
            AUDIENCE SPLIT %
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {(["audience_male_pct", "audience_female_pct", "audience_other_pct"] as const).map((key) => (
              <div key={key}>
                <label className="field-label">
                  {key === "audience_male_pct"
                    ? "Male %"
                    : key === "audience_female_pct"
                      ? "Female %"
                      : "Other %"}
                </label>
                <input className="field-input" type="text" inputMode="numeric" autoComplete="off" placeholder="0" value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 4 }}>
            <label className="field-label">Upload Date</label>
            <input className="field-input" type="date" value={form.upload_date} onChange={(e) => set("upload_date", e.target.value)} />
          </div>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : submitLabel}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>

        <div style={{ flexShrink: 0, width: 120 }}>
          <div style={{
            width: 120,
            height: 160,
            borderRadius: 8,
            background: "#1a1a1a",
            overflow: "hidden",
            border: "2px solid #333",
          }}>
            {thumbnailUrl ? (
              <img src={thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 11, textAlign: "center", padding: 8 }}>
                No thumbnail
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

export default function MyVideos({ tabActive = true }: { tabActive?: boolean }) {
  const [videos, setVideos] = useState<MyVideo[]>([]);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editFormRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const list = await window.hub.listMyVideos();
    setVideos(list);
  }

  async function syncFromExtension() {
    setSaving(true);
    setError("");
    setNotice("");
    const res = await window.hub.importPersonalLibrary();
    setSaving(false);
    if (!res.ok) { setError(res.error || "Sync failed"); return; }
    if (res.count === 0) {
      setNotice(res.message || "No new videos — save some from the extension first.");
    } else {
      setNotice(`Synced ${res.count} video${res.count !== 1 ? "s" : ""} from extension.`);
    }
    void load();
  }

  useEffect(() => {
    if (!tabActive) return;
    window.hub.importPersonalLibrary().then(() => load());
  }, [tabActive]);

  async function saveVideo(form: FormState, id?: string) {
    if (!form.url.trim()) { setError("Video URL is required."); return false; }
    setSaving(true);
    setError("");
    try {
      const res = await window.hub.saveMyVideo({
        ...(id ? { id } : {}),
        url: form.url.trim(),
        views: num(form.views),
        likes: num(form.likes),
        comments: num(form.comments),
        watch_time_seconds: num(form.watch_time_seconds),
        sales: num(form.sales),
        gmv: num(form.gmv),
        commission: num(form.commission),
        audience_male_pct: num(form.audience_male_pct),
        audience_female_pct: num(form.audience_female_pct),
        audience_other_pct: num(form.audience_other_pct),
        upload_date: form.upload_date,
        submitted_at: new Date().toISOString(),
      });
      if (!res.ok) {
        setError(res.error || "Save failed");
        return false;
      }
      setNotice(id ? "Video updated." : "Video saved.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await saveVideo(addForm);
    if (!ok) return;
    setShowAddForm(false);
    setAddForm(EMPTY_FORM);
    void load();
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    const ok = await saveVideo(editForm, editingId);
    if (!ok) return;
    setEditingId(null);
    void load();
  }

  function startEdit(v: MyVideo) {
    setShowAddForm(false);
    setExpandedId(null);
    setEditingId(v.id);
    setEditForm(videoToForm(v));
    setError("");
    setTimeout(() => {
      editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function cancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video?")) return;
    if (editingId === id) setEditingId(null);
    await window.hub.deleteMyVideo(id);
    void load();
  }

  async function handleAnalyse(id: string) {
    setAnalysingId(id);
    setError("");
    setNotice("");
    const res = await window.hub.analyseMyVideo(id);
    setAnalysingId(null);
    if (!res.ok) { setError(res.error || "Analysis failed"); return; }
    setNotice(`Analysis complete. Score: ${res.score ?? "—"}`);
    setExpandedId(id);
    void load();
  }

  const shortUrl = (url: string) => {
    try { return new URL(url).pathname.split("/").filter(Boolean).slice(-2).join("/"); }
    catch { return url.slice(0, 40) + "…"; }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          My Videos{videos.length > 0 ? ` (${videos.length})` : ""}
        </h2>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12 }}
          disabled={saving}
          onClick={() => void load()}
        >
          ↻ Refresh
        </button>
        <button
          className="btn btn-secondary"
          style={{ marginLeft: "auto", fontSize: 12 }}
          disabled={saving}
          onClick={() => void syncFromExtension()}
        >
          ↓ Sync from extension
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowAddForm(!showAddForm);
            setEditingId(null);
            setAddForm(EMPTY_FORM);
            setError("");
          }}
        >
          {showAddForm ? "Cancel" : "+ Add Video"}
        </button>
      </div>
      <p className="page-desc">
        Log your own TikTok videos with performance data. Grok analyses the video structure, hook, and CTA so the agent can learn what converts for you.
      </p>

      {notice && <p className="success" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

      {showAddForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <VideoEditForm
            form={addForm}
            durationSeconds={null}
            onChange={setAddForm}
            onSubmit={handleAddSubmit}
            onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
            saving={saving}
            title="Add Video"
            submitLabel="Save Video"
            thumbnailUrl={null}
          />
        </div>
      )}

      {videos.length === 0 && !showAddForm && (
        <div className="card" style={{ color: "#666", textAlign: "center", padding: 40 }}>
          No videos yet. Add your first video to start building your performance library.
        </div>
      )}

      {videos.some((v) => (v as MyVideo & { pending_hub_review?: boolean }).pending_hub_review) && (
        <div style={{ background: "#1a0a0a", border: "1px solid #fe2c55", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#fe2c55" }}>
          ⭐ You have videos imported from the extension that need performance data filled in — click Edit on each one below.
        </div>
      )}

      {videos.map((v) => {
        const isPending = (v as MyVideo & { pending_hub_review?: boolean }).pending_hub_review;
        const isExpanded = expandedId === v.id;
        const isEditing = editingId === v.id;
        const isAnalysing = analysingId === v.id;
        const thumb = videoThumbnail(v);
        return (
          <div
            key={v.id}
            ref={isEditing ? editFormRef : undefined}
            className="card"
            style={{ marginBottom: 12, borderColor: isPending ? "#fe2c55" : undefined }}
          >
            {isPending && !isEditing && (
              <div style={{ fontSize: 11, color: "#fe2c55", marginBottom: 8, fontWeight: 700 }}>
                ⭐ FROM EXTENSION — fill in GMV, Commission &amp; performance data below
              </div>
            )}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={{
                  width: 72,
                  height: 96,
                  borderRadius: 8,
                  background: "#1a1a1a",
                  overflow: "hidden",
                  border: `2px solid ${isPending ? "#fe2c55" : "#333"}`,
                }}>
                  {thumb ? (
                    <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 11 }}>
                      No frame
                    </div>
                  )}
                </div>
                <div style={{
                  position: "absolute",
                  bottom: 4,
                  right: 4,
                  minWidth: 28,
                  padding: "2px 4px",
                  borderRadius: 4,
                  background: "rgba(0,0,0,0.75)",
                  border: `1px solid ${scoreColor(v.score)}`,
                  textAlign: "center",
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor(v.score), lineHeight: 1 }}>
                    {v.score ?? "—"}
                  </span>
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#fe2c55", fontFamily: "monospace", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUrl(v.url)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "#aaa" }}>
                  {v.views != null && <span>👁 {v.views.toLocaleString()}</span>}
                  {v.likes != null && <span>❤️ {v.likes.toLocaleString()}</span>}
                  {v.comments != null && <span>💬 {v.comments.toLocaleString()}</span>}
                  {v.watch_time_pct != null && (
                    <span>
                      ⏱ {v.watch_time_seconds != null ? `${v.watch_time_seconds}s · ` : ""}
                      {v.watch_time_pct}% avg watch
                    </span>
                  )}
                  {v.analysis?.duration_seconds != null && (
                    <span>{v.watch_time_pct != null ? " · " : ""}{v.analysis.duration_seconds}s video</span>
                  )}
                  {v.gmv != null && v.gmv > 0 && <span>💰 £{v.gmv.toFixed(2)} GMV</span>}
                  {v.commission != null && v.commission > 0 && <span>🤑 £{v.commission.toFixed(2)} comm.</span>}
                  {v.sales != null && v.sales > 0 && <span>📦 {v.sales} sales</span>}
                </div>
                {v.upload_date && (
                  <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                    Uploaded {v.upload_date.slice(0, 10)}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {v.analysis_status !== "complete" && !isEditing && (
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} disabled={isAnalysing} onClick={() => void handleAnalyse(v.id)}>
                    {isAnalysing ? "Analysing…" : "Analyse"}
                  </button>
                )}
                {v.analysis_status === "complete" && !isEditing && (
                  <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setExpandedId(isExpanded ? null : v.id)}>
                    {isExpanded ? "Hide" : "View"}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px", ...(isEditing ? { borderColor: "#fe2c55", color: "#fe2c55" } : {}) }}
                  onClick={() => (isEditing ? cancelEdit() : startEdit(v))}
                >
                  {isEditing ? "Close" : "Edit"}
                </button>
                <button className="btn btn-secondary" style={{ fontSize: 12, padding: "4px 10px", color: "#f44" }} onClick={() => void handleDelete(v.id)}>
                  ✕
                </button>
              </div>
            </div>

            {isEditing && (
              <VideoEditForm
                form={editForm}
                durationSeconds={getAnalysisDurationSeconds(v.analysis)}
                onChange={setEditForm}
                onSubmit={handleEditSubmit}
                onCancel={cancelEdit}
                saving={saving}
                title="Edit performance data"
                submitLabel="Update Video"
                thumbnailUrl={thumb}
              />
            )}

            {v.analysis_status === "error" && (
              <p className="error" style={{ marginTop: 8, fontSize: 12 }}>{v.analysis_error}</p>
            )}

            {isExpanded && !isEditing && v.analysis && (
              <div style={{ marginTop: 16, borderTop: "1px solid #222", paddingTop: 12 }}>
                {v.analysis.onscreen_hook && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>🎣 ONSCREEN HOOK</div>
                    <div style={{ fontSize: 13 }}>{v.analysis.onscreen_hook}</div>
                  </div>
                )}
                {v.analysis.transcript && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>🎤 TRANSCRIPT</div>
                    <div style={{ fontSize: 12, color: "#ccc", whiteSpace: "pre-wrap" }}>{v.analysis.transcript}</div>
                  </div>
                )}
                {v.analysis.video_structure && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>🏗 VIDEO STRUCTURE</div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>{v.analysis.video_structure}</div>
                  </div>
                )}
                {v.analysis.pacing_notes && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>⚡ PACING</div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>{v.analysis.pacing_notes}</div>
                  </div>
                )}
                {v.analysis.detailed_analysis && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>📊 ANALYSIS</div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>{v.analysis.detailed_analysis}</div>
                  </div>
                )}
                {(v.analysis.funnel_category || v.analysis.hook_type) && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#fe2c55", fontWeight: 700, marginBottom: 4 }}>🎯 FUNNEL</div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>
                      {v.analysis.funnel_category && <div>{v.analysis.funnel_category}</div>}
                      {v.analysis.funnel_category_reason && (
                        <div style={{ color: "#aaa", marginTop: 4 }}>{v.analysis.funnel_category_reason}</div>
                      )}
                      {v.analysis.funnel_breakdown?.map((stage, i) => (
                        <div key={i} style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid #333" }}>
                          <strong>{stage.label}</strong>
                          {stage.time_range ? ` (${stage.time_range})` : ""}
                          {stage.what_happens ? ` — ${stage.what_happens}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {v.analysis.cta_timestamps.length > 0 && (
                  <div style={{ fontSize: 12, color: "#aaa" }}>
                    CTA at: {v.analysis.cta_timestamps.map((t) => `${t}s`).join(", ")}
                    {v.analysis.hook_type && ` · Hook: ${v.analysis.hook_type}`}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
