import type { JsonStore } from "../db.js";

export type PacingReference = {
  libraryId: string;
  hook: string;
  pacingTranscript: string;
  ssml: string;
  replicationScore: number;
};

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function findPacingReference(store: JsonStore, libraryId?: string): PacingReference | null {
  const rows = store.list<{ id: string; payload_json: string }>("library_items");

  if (libraryId) {
    const row = rows.find((r) => r.id === libraryId);
    if (row) return rowToReference(row);
  }

  const ranked = rows
    .map(rowToReference)
    .filter((r): r is PacingReference => !!r && (!!r.pacingTranscript || !!r.ssml))
    .sort((a, b) => b.replicationScore - a.replicationScore);

  return ranked[0] || null;
}

function rowToReference(row: { id: string; payload_json: string }): PacingReference | null {
  const item = parsePayload(row.payload_json);
  const wtw = (item.why_this_worked as Record<string, unknown>) || {};
  const hookDetail = (item.hook_detail as Record<string, unknown>) || {};
  const pacing = String(item.pacing_transcript || "");
  const ssml = String(item.ssml || "");
  if (!pacing && !ssml) return null;

  return {
    libraryId: row.id,
    hook: String(hookDetail.text || item.hook || ""),
    pacingTranscript: pacing,
    ssml,
    replicationScore: Number(wtw.replication_score) || 0,
  };
}

export function formatPacingBlock(ref: PacingReference | null): string {
  if (!ref) return "";
  return [
    "## Reference video pacing (match this rhythm — same beat structure, not same words)",
    `Original hook studied: "${ref.hook}"`,
    "",
    "### Timestamp pacing from winning video",
    ref.pacingTranscript || "(no pacing transcript)",
    "",
    "### Reference SSML break pattern",
    ref.ssml || "(no SSML)",
    "",
    "Your SSML must mirror the same pause lengths and fast/slow sections at similar points in the script.",
  ].join("\n");
}
