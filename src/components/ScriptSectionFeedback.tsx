import { useState } from "react";
import type { ScriptSection, ScriptSectionFeedbackEntry, ScriptSectionRating } from "../hub";

type Props = {
  section: ScriptSection;
  label: string;
  content: string;
  feedback?: ScriptSectionFeedbackEntry;
  disabled?: boolean;
  onRate: (
    rating: ScriptSectionRating,
    reason?: string,
    notes?: string
  ) => Promise<{ ok: boolean; error?: string }>;
};

export default function ScriptSectionFeedback({ section, label, content, feedback, disabled, onRate }: Props) {
  const [loading, setLoading] = useState(false);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState("");

  const rated = feedback?.rating;

  async function submit(rating: ScriptSectionRating, r?: string, n?: string) {
    setLoading(true);
    setLocalError("");
    const res = await onRate(rating, r, n);
    setLoading(false);
    if (!res.ok) {
      setLocalError(res.error || "Could not save feedback");
      return;
    }
    setDislikeOpen(false);
    setNotesOpen(false);
    setReason("");
    setNotes("");
  }

  return (
    <div className="script-section-block" data-section={section}>
      <div className="script-section-header">
        <span className="field-label">{label}</span>
        {rated && (
          <span className={`script-section-rated script-section-rated-${rated}`}>
            {rated === "liked" ? "Liked" : rated === "disliked" ? "Disliked" : "Kept with notes"}
          </span>
        )}
      </div>
      {content ? (
        <div className="script-output script-section-content">{content}</div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>—</p>
      )}

      {!rated && (
        <div className="btn-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn script-feedback-btn script-feedback-like"
            disabled={disabled || loading}
            onClick={() => void submit("liked")}
          >
            I like this response
          </button>
          <button
            type="button"
            className="btn script-feedback-btn script-feedback-dislike"
            disabled={disabled || loading}
            onClick={() => {
              setLocalError("");
              setDislikeOpen(true);
              setNotesOpen(false);
            }}
          >
            I don't like this response
          </button>
          <button
            type="button"
            className="btn script-feedback-btn script-feedback-notes"
            disabled={disabled || loading}
            onClick={() => {
              setLocalError("");
              setNotesOpen(true);
              setDislikeOpen(false);
            }}
          >
            Keep this but take notes
          </button>
        </div>
      )}

      {dislikeOpen && !rated && (
        <div className="script-dislike-form">
          <label className="field-label">What didn't work? (required)</label>
          <textarea
            className="field-input"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ resize: "vertical", width: "100%", boxSizing: "border-box" }}
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || !reason.trim()}
              onClick={() => void submit("disliked", reason)}
            >
              Submit
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDislikeOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {notesOpen && !rated && (
        <div className="script-dislike-form">
          <label className="field-label">Notes — what to keep or tweak (required)</label>
          <textarea
            className="field-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ resize: "vertical", width: "100%", boxSizing: "border-box" }}
          />
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || !notes.trim()}
              onClick={() => void submit("keep_with_notes", undefined, notes)}
            >
              Save notes
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setNotesOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rated === "disliked" && feedback?.reason && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Note: {feedback.reason}</p>
      )}
      {rated === "keep_with_notes" && feedback?.notes && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Notes: {feedback.notes}</p>
      )}
      {localError && <p className="error" style={{ marginTop: 6, fontSize: 12 }}>{localError}</p>}
    </div>
  );
}
