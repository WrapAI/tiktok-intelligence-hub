import { useEffect, useState } from "react";
import type { ScriptDetail, ScriptSection } from "../hub";
import ScriptSectionFeedback from "./ScriptSectionFeedback";

const SECTIONS: { key: ScriptSection; label: string; field: keyof ScriptDetail }[] = [
  { key: "audio", label: "Audio script", field: "script_text" },
  { key: "on_screen_caption", label: "On-screen caption", field: "on_screen_caption" },
  { key: "tiktok_caption", label: "TikTok caption + hashtags", field: "tiktok_caption" },
  { key: "pace", label: "Pace (SSML)", field: "ssml" },
];

type Props = {
  scriptId: string;
  pendingAnalysisId?: string;
  editable?: boolean;
  showSectionFeedback?: boolean;
  showDriveUpload?: boolean;
  driveConnected?: boolean;
  onUpdated?: () => void;
  onDriveUploaded?: (msg: string) => void;
  onError?: (msg: string) => void;
  onFeedbackChange?: (complete: boolean) => void;
};

export default function ScriptContentCard({
  scriptId,
  pendingAnalysisId,
  editable = false,
  showSectionFeedback = false,
  showDriveUpload = false,
  driveConnected = false,
  onUpdated,
  onDriveUploaded,
  onError,
  onFeedbackChange,
}: Props) {
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Partial<ScriptDetail>>({});
  const [audioPath, setAudioPath] = useState("");
  const [audioLoading, setAudioLoading] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    const s = await window.hub.getScript(scriptId);
    if (s) {
      setScript(s);
      setAudioPath(s.audio_path || "");
      setDraft({
        script_text: s.script_text,
        ssml: s.ssml,
        on_screen_caption: s.on_screen_caption,
        tiktok_caption: s.tiktok_caption,
        title: s.title,
      });
    }
  }

  useEffect(() => {
    void load();
  }, [scriptId]);

  const sectionFeedback = script?.section_feedback || {};
  const allSectionsRated = SECTIONS.every((s) => !!sectionFeedback[s.key]?.rating);

  useEffect(() => {
    if (!showSectionFeedback || !script) return;
    onFeedbackChange?.(allSectionsRated);
  }, [script, showSectionFeedback, onFeedbackChange, allSectionsRated]);

  if (!script) return <p className="muted">Loading script…</p>;

  async function handleSectionRate(
    section: ScriptSection,
    rating: "liked" | "disliked" | "keep_with_notes",
    reason?: string,
    notes?: string
  ) {
    const res = await window.hub.rateScriptSectionFeedback({
      scriptId,
      section,
      rating,
      reason,
      notes,
    });
    if (res.ok) {
      setScript((prev) =>
        prev
          ? {
              ...prev,
              section_feedback: res.sectionFeedback || prev.section_feedback,
              awaiting_feedback: !SECTIONS.every((s) => res.sectionFeedback?.[s.key]?.rating),
            }
          : prev
      );
      if (showSectionFeedback && res.sectionFeedback) {
        onFeedbackChange?.(SECTIONS.every((s) => !!res.sectionFeedback?.[s.key]?.rating));
      }
    }
    return { ok: !!res.ok, error: res.error };
  }

  async function handleSaveEdits() {
    setSaving(true);
    const res = await window.hub.updateScriptContent({
      scriptId,
      pendingAnalysisId,
      updates: {
        script_text: draft.script_text,
        ssml: draft.ssml,
        on_screen_caption: draft.on_screen_caption,
        tiktok_caption: draft.tiktok_caption,
        title: draft.title,
      },
    });
    setSaving(false);
    if (!res.ok) {
      onError?.(res.error || "Save failed");
      return;
    }
    setEditMode(false);
    if (res.script) setScript(res.script);
    if (res.pendingReset) onUpdated?.();
    else void load();
  }

  async function handleAudio() {
    setAudioLoading(true);
    const res = await window.hub.generateAudio(scriptId);
    setAudioLoading(false);
    if (!res.ok) {
      onError?.(res.error || "Audio generation failed");
      return;
    }
    setAudioPath(res.filePath || "");
    void load();
  }

  async function handleDrive() {
    setDriveLoading(true);
    const res = await window.hub.uploadVoiceoverToDrive(scriptId);
    setDriveLoading(false);
    if (!res.ok) {
      onError?.(res.error || "Drive upload failed");
      return;
    }
    onDriveUploaded?.(`Uploaded to Drive: ${res.folderPath} / ${res.fileName}`);
    onUpdated?.();
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="script-content-card">
      <div className="pending-card-header" style={{ marginBottom: 10 }}>
        <div className="card-title" style={{ fontSize: "0.95rem" }}>{script.title}</div>
        {editable && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: "6px 10px" }}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "Cancel edit" : "Edit script"}
          </button>
        )}
      </div>

      {editMode ? (
        <div style={{ marginBottom: 14 }}>
          {SECTIONS.map(({ key, label, field }) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <label className="field-label">{label}</label>
              <textarea
                className="field-input"
                rows={field === "script_text" || field === "ssml" ? 5 : 3}
                value={String(draft[field] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                style={{ resize: "vertical", width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
              />
            </div>
          ))}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleSaveEdits()}>
              {saving ? "Saving…" : pendingAnalysisId ? "Save & reset tracking" : "Save changes"}
            </button>
          </div>
          {pendingAnalysisId && (
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Saving edits resets this entry to “Needs TikTok URL”.
            </p>
          )}
        </div>
      ) : showSectionFeedback ? (
        <>
          <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            {allSectionsRated
              ? "All sections rated — you can generate another script."
              : "Rate each section before generating another script:"}
          </p>
          {SECTIONS.map(({ key, label, field }) => (
            <ScriptSectionFeedback
              key={key}
              section={key}
              label={label}
              content={String(script[field] ?? "")}
              feedback={sectionFeedback[key]}
              onRate={(rating, reason, notes) => handleSectionRate(key, rating, reason, notes)}
            />
          ))}
        </>
      ) : (
        SECTIONS.map(({ key, label, field }) => (
          <div key={key} className="script-section-block">
            <div className="field-label">{label}</div>
            <div className="script-output">{String(script[field] ?? "—")}</div>
          </div>
        ))
      )}

      {!editMode && (
        <div className="btn-row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={() => copyText(script.script_text)}>
            Copy script
          </button>
          {script.on_screen_caption && (
            <button type="button" className="btn btn-secondary" onClick={() => copyText(script.on_screen_caption)}>
              Copy on-screen
            </button>
          )}
          {script.tiktok_caption && (
            <button type="button" className="btn btn-secondary" onClick={() => copyText(script.tiktok_caption)}>
              Copy caption
            </button>
          )}
          {script.ssml && (
            <button type="button" className="btn btn-secondary" onClick={() => copyText(script.ssml)}>
              Copy SSML
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={audioLoading} onClick={() => void handleAudio()}>
            {audioLoading ? "Generating…" : audioPath ? "Regenerate audio" : "Generate audio"}
          </button>
          {audioPath && (
            <button type="button" className="btn btn-secondary" onClick={() => window.hub.openAudioFile(audioPath)}>
              Show audio file
            </button>
          )}
          {showDriveUpload && audioPath && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={driveLoading}
              onClick={() => void handleDrive()}
              title={driveConnected ? undefined : "Connect Google Drive in Settings"}
            >
              {driveLoading ? "Uploading…" : "Send to Google Drive"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
