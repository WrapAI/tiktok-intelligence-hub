import { useEffect, useState } from "react";
import type { MyVideo } from "../hub";

const EMPTY_FORM = {
  url: "",
  views: "",
  likes: "",
  comments: "",
  watch_time_pct: "",
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

export default function MyVideos() {
  const [videos, setVideos] = useState<MyVideo[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysingId, setAnalysingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const list = await window.hub.listMyVideos();
    setVideos(list);
  }

  useEffect(() => { void load(); }, []);

  function field(key: keyof FormState, label: string, type = "text", placeholder = "") {
    return (
      <div style={{ marginBottom: 10 }}>
        <label className="field-label">{label}</label>
        <input
          className="field-input"
          type={type}
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      </div>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim()) { setError("Video URL is required."); return; }
    setSaving(true);
    setError("");
    const res = await window.hub.saveMyVideo({
      ...(editingId ? { id: editingId } : {}),
      url: form.url.trim(),
      views: num(form.views),
      likes: num(form.likes),
      comments: num(form.comments),
      watch_time_pct: num(form.watch_time_pct),
      sales: num(form.sales),
      gmv: num(form.gmv),
      commission: num(form.commission),
      audience_male_pct: num(form.audience_male_pct),
      audience_female_pct: num(form.audience_female_pct),
      audience_other_pct: num(form.audience_other_pct),
      upload_date: form.upload_date,
      submitted_at: new Date().toISOString(),
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Save failed"); return; }
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setNotice("Video saved.");
    void load();
  }

  function handleEdit(v: MyVideo) {
    setEditingId(v.id);
    setForm({
      url: v.url || "",
      views: v.views?.toString() || "",
      likes: v.likes?.toString() || "",
      comments: v.comments?.toString() || "",
      watch_time_pct: v.watch_time_pct?.toString() || "",
      sales: v.sales?.toString() || "",
      gmv: v.gmv?.toString() || "",
      commission: v.commission?.toString() || "",
      audience_male_pct: v.audience_male_pct?.toString() || "",
      audience_female_pct: v.audience_female_pct?.toString() || "",
      audience_other_pct: v.audience_other_pct?.toString() || "",
      upload_date: v.upload_date?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    });
    setShowForm(true);
    setError("");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video?")) return;
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
        <h2 className="page-title" style={{ margin: 0 }}>My Videos</h2>
        <button
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
          onClick={() => { setShowForm(!showForm); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
        >
          {showForm ? "Cancel" : "+ Add Video"}
        </button>
      </div>
      <p className="page-desc">
        Log your own TikTok videos with performance data. Grok analyses the video structure, hook, and CTA so the agent can learn what converts for you.
      </p>

      {notice && <p className="success" style={{ marginBottom: 12 }}>{notice}</p>}
      {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

      {showForm && (
        <form className="card" style={{ maxWidth: 640, marginBottom: 20 }} onSubmit={handleSave}>
          <div className="card-title">{editingId ? "Edit Video" : "Add Video"}</div>

          {field("url", "TikTok Video URL *", "url", "https://www.tiktok.com/@...")}

          <div className="card-title" style={{ marginTop: 12, fontSize: 12, color: "#aaa", fontWeight: 400 }}>
            PERFORMANCE
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label">Views</label>
              <input className="field-input" type="number" placeholder="0" value={form.views} onChange={(e) => setForm((f) => ({ ...f, views: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Likes</label>
              <input className="field-input" type="number" placeholder="0" value={form.likes} onChange={(e) => setForm((f) => ({ ...f, likes: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Comments</label>
              <input className="field-input" type="number" placeholder="0" value={form.comments} onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="field-label">Watch Time %</label>
            <input className="field-input" type="number" min="0" max="100" placeholder="e.g. 65" value={form.watch_time_pct} onChange={(e) => setForm((f) => ({ ...f, watch_time_pct: e.target.value }))} />
            <p className="muted" style={{ fontSize: 11, marginTop: 3 }}>Average % of video watched (from TikTok Studio)</p>
          </div>

          <div className="card-title" style={{ marginTop: 12, fontSize: 12, color: "#aaa", fontWeight: 400 }}>
            SALES
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label">Sales (units)</label>
              <input className="field-input" type="number" placeholder="0" value={form.sales} onChange={(e) => setForm((f) => ({ ...f, sales: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">GMV (£)</label>
              <input className="field-input" type="number" step="0.01" placeholder="0.00" value={form.gmv} onChange={(e) => setForm((f) => ({ ...f, gmv: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Commission (£)</label>
              <input className="field-input" type="number" step="0.01" placeholder="0.00" value={form.commission} onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value }))} />
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 12, fontSize: 12, color: "#aaa", fontWeight: 400 }}>
            AUDIENCE SPLIT %
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label">Male %</label>
              <input className="field-input" type="number" min="0" max="100" placeholder="0" value={form.audience_male_pct} onChange={(e) => setForm((f) => ({ ...f, audience_male_pct: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Female %</label>
              <input className="field-input" type="number" min="0" max="100" placeholder="0" value={form.audience_female_pct} onChange={(e) => setForm((f) => ({ ...f, audience_female_pct: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">Other %</label>
              <input className="field-input" type="number" min="0" max="100" placeholder="0" value={form.audience_other_pct} onChange={(e) => setForm((f) => ({ ...f, audience_other_pct: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="field-label">Upload Date</label>
            <input className="field-input" type="date" value={form.upload_date} onChange={(e) => setForm((f) => ({ ...f, upload_date: e.target.value }))} />
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Video" : "Save Video"}
            </button>
          </div>
        </form>
      )}

      {videos.length === 0 && !showForm && (
        <div className="card" style={{ color: "#666", textAlign: "center", padding: 40 }}>
          No videos yet. Add your first video to start building your performance library.
        </div>
      )}

      {videos.some((v) => (v as MyVideo & { pending_hub_review?: boolean }).pending_hub_review) && (
        <div style={{ background: "#1a0a0a", border: "1px solid #fe2c55", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#fe2c55" }}>
          ⭐ You have videos imported from the extension that need performance data filled in — they're marked below.
        </div>
      )}

      {videos.map((v) => {
        const isPending = (v as MyVideo & { pending_hub_review?: boolean }).pending_hub_review;
        const isExpanded = expandedId === v.id;
        const isAnalysing = analysingId === v.id;
        return (
          <div key={v.id} className="card" style={{ marginBottom: 12, borderColor: isPending ? "#fe2c55" : undefined }}>
            {isPending && (
              <div style={{ fontSize: 11, color: "#fe2c55", marginBottom: 8, fontWeight: 700 }}>
                ⭐ FROM EXTENSION — fill in GMV, Commission &amp; performance data below
              </div>
            )}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              {/* Score badge */}
              <div style={{
                minWidth: 52,
                height: 52,
                borderRadius: 8,
                background: "#1a1a1a",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                border: `2px solid ${scoreColor(v.score)}`,
              }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: scoreColor(v.score), lineHeight: 1 }}>
                  {v.score ?? "—"}
                </span>
                <span style={{ fontSize: 9, color: "#666", marginTop: 2 }}>SCORE</span>
              </div>

              {/* Main info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#fe2c55", fontFamily: "monospace", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortUrl(v.url)}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12, color: "#aaa" }}>
                  {v.views != null && <span>👁 {v.views.toLocaleString()}</span>}
                  {v.likes != null && <span>❤️ {v.likes.toLocaleString()}</span>}
                  {v.comments != null && <span>💬 {v.comments.toLocaleString()}</span>}
                  {v.watch_time_pct != null && <span>⏱ {v.watch_time_pct}% watch time</span>}
                  {v.gmv != null && <span>💰 £{v.gmv.toFixed(2)} GMV</span>}
                  {v.commission != null && <span>🤑 £{v.commission.toFixed(2)} comm.</span>}
                  {v.sales != null && <span>📦 {v.sales} sales</span>}
                </div>
                {v.upload_date && (
                  <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                    Uploaded {v.upload_date.slice(0, 10)}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {v.analysis_status !== "complete" && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    disabled={isAnalysing}
                    onClick={() => void handleAnalyse(v.id)}
                  >
                    {isAnalysing ? "Analysing…" : "Analyse"}
                  </button>
                )}
                {v.analysis_status === "complete" && (
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    onClick={() => setExpandedId(isExpanded ? null : v.id)}
                  >
                    {isExpanded ? "Hide" : "View"}
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => handleEdit(v)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px", color: "#f44" }}
                  onClick={() => void handleDelete(v.id)}
                >
                  ✕
                </button>
              </div>
            </div>

            {v.analysis_status === "error" && (
              <p className="error" style={{ marginTop: 8, fontSize: 12 }}>{v.analysis_error}</p>
            )}

            {isExpanded && v.analysis && (
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
                {v.analysis.cta_timestamps.length > 0 && (
                  <div style={{ fontSize: 12, color: "#aaa" }}>
                    CTA at: {v.analysis.cta_timestamps.map((t) => `${t}s`).join(", ")}
                    {v.analysis.hook_type && ` · Hook: ${v.analysis.hook_type}`}
                    {v.analysis.funnel_category && ` · ${v.analysis.funnel_category}`}
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
