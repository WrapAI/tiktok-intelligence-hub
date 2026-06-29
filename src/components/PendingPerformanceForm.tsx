import type { PendingAnalysisSubmit } from "../hub";
import { previewAverageWatchTimePct } from "../utils/watchTime";

type Props = {
  draft: PendingAnalysisSubmit;
  durationSeconds: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  onChange: (patch: Partial<PendingAnalysisSubmit>) => void;
  onViewsChange: (v: number | null) => void;
  onLikesChange: (v: number | null) => void;
  onCommentsChange: (v: number | null) => void;
};

function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export default function PendingPerformanceForm({
  draft,
  durationSeconds,
  views,
  likes,
  comments,
  onChange,
  onViewsChange,
  onLikesChange,
  onCommentsChange,
}: Props) {
  const previewPct = previewAverageWatchTimePct(draft.watch_time_seconds, durationSeconds);

  return (
    <>
      <div className="card-title" style={{ fontSize: 12, color: "#aaa", fontWeight: 400, marginTop: 4 }}>
        PERFORMANCE
      </div>
      <div className="grid-3">
        <div>
          <label className="field-label">Views</label>
          <input
            className="field-input"
            type="number"
            placeholder="0"
            value={views ?? ""}
            onChange={(e) => onViewsChange(num(e.target.value))}
          />
        </div>
        <div>
          <label className="field-label">Likes</label>
          <input
            className="field-input"
            type="number"
            placeholder="0"
            value={likes ?? ""}
            onChange={(e) => onLikesChange(num(e.target.value))}
          />
        </div>
        <div>
          <label className="field-label">Comments</label>
          <input
            className="field-input"
            type="number"
            placeholder="0"
            value={comments ?? ""}
            onChange={(e) => onCommentsChange(num(e.target.value))}
          />
        </div>
      </div>

      {durationSeconds != null && (
        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: 0 }}>
          Grok confirmed video duration: <strong>{durationSeconds}s</strong>
        </p>
      )}

      <div style={{ marginTop: 10 }}>
        <label className="field-label">Avg watch time (seconds)</label>
        <input
          className="field-input"
          type="number"
          min="0"
          step="0.1"
          placeholder={durationSeconds ? "e.g. 8.5" : "Run Grok analysis first"}
          disabled={durationSeconds == null}
          value={draft.watch_time_seconds ?? ""}
          onChange={(e) => onChange({ watch_time_seconds: num(e.target.value) })}
        />
        <p className="muted" style={{ fontSize: 11, marginTop: 3 }}>
          {durationSeconds == null
            ? "Duration not found in this analysis — click Pull stats & analyse again (restart whisper-server first)."
            : previewPct != null
              ? `→ ${previewPct}% average watch time (${draft.watch_time_seconds}s of ${durationSeconds}s)`
              : draft.watch_time_pct != null
                ? `Saved: ${draft.watch_time_pct}% average watch time (legacy entry)`
                : "Enter average watch time in seconds from TikTok Studio — % is calculated automatically."}
        </p>
      </div>

      <div className="card-title" style={{ fontSize: 12, color: "#aaa", fontWeight: 400, marginTop: 12 }}>
        SALES
      </div>
      <div className="grid-3">
        <div>
          <label className="field-label">Sales (units)</label>
          <input
            className="field-input"
            type="number"
            placeholder="0"
            value={draft.sales ?? ""}
            onChange={(e) => onChange({ sales: num(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">GMV (£)</label>
          <input
            className="field-input"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={draft.gmv ?? ""}
            onChange={(e) => onChange({ gmv: num(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">Commission (£)</label>
          <input
            className="field-input"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={draft.commission ?? ""}
            onChange={(e) => onChange({ commission: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="card-title" style={{ fontSize: 12, color: "#aaa", fontWeight: 400, marginTop: 12 }}>
        AUDIENCE SPLIT %
      </div>
      <div className="grid-3">
        <div>
          <label className="field-label">Male %</label>
          <input
            className="field-input"
            type="number"
            min="0"
            max="100"
            placeholder="0"
            value={draft.audience_male_pct ?? ""}
            onChange={(e) => onChange({ audience_male_pct: num(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">Female %</label>
          <input
            className="field-input"
            type="number"
            min="0"
            max="100"
            placeholder="0"
            value={draft.audience_female_pct ?? ""}
            onChange={(e) => onChange({ audience_female_pct: num(e.target.value) })}
          />
        </div>
        <div>
          <label className="field-label">Other %</label>
          <input
            className="field-input"
            type="number"
            min="0"
            max="100"
            placeholder="0"
            value={draft.audience_other_pct ?? ""}
            onChange={(e) => onChange({ audience_other_pct: num(e.target.value) })}
          />
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label className="field-label">Upload date</label>
        <input
          className="field-input"
          type="date"
          value={draft.upload_date}
          onChange={(e) => onChange({ upload_date: e.target.value })}
        />
      </div>
    </>
  );
}
