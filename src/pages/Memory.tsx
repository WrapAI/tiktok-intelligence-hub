import { Fragment, useEffect, useState } from "react";

type MemoryRow = {
  id: string;
  rating: number;
  my_views: number;
  my_gmv: number;
  my_commission?: number;
  my_sales?: number;
  what_i_took: string;
  title?: string;
  entry_type?: string;
  source?: string;
  hook_type?: string;
  funnel_category?: string;
  payload_json: string;
};

function entryLabel(row: MemoryRow): string {
  if (row.title?.trim()) return row.title.trim();
  try {
    const p = JSON.parse(row.payload_json) as Record<string, unknown>;
    if (typeof p.title === "string" && p.title.trim()) return p.title.trim();
    if (typeof p.source_hook === "string" && p.source_hook.trim()) return p.source_hook.trim();
  } catch {
    /* ignore */
  }
  return row.what_i_took || "—";
}

function entryTypeLabel(row: MemoryRow): string {
  const t = row.entry_type || "";
  if (t === "own_video") return "My converted video";
  if (t === "public_reference") return "Public reference";
  if (t === "copied_strategy") return "Copied strategy";
  return row.source === "hub_my_videos" ? "My converted video" : "Imported";
}

export default function Memory() {
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    window.hub.listMemory().then((r) => setRows(r as MemoryRow[]));
  }, []);

  return (
    <div>
      <h2 className="page-title">Positive Memory</h2>
      <p className="page-desc">
        Your wins library — converted videos (yours or public references with sales data), full analysis + performance.
        The agent reads this alongside My Videos.
      </p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">No wins yet. Save a converted My Video with GMV/commission, or import positive_memory.json from the extension.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Video / strategy</th>
                <th>Hook</th>
                <th>Funnel</th>
                <th>Views</th>
                <th>GMV</th>
                <th>Comm.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr>
                    <td style={{ fontSize: 11, color: "#888" }}>{entryTypeLabel(row)}</td>
                    <td>{entryLabel(row)}</td>
                    <td>{row.hook_type || "—"}</td>
                    <td>{row.funnel_category || "—"}</td>
                    <td>{row.my_views?.toLocaleString() || "—"}</td>
                    <td>{row.my_gmv ? `£${row.my_gmv.toFixed(2)}` : "—"}</td>
                    <td>{row.my_commission ? `£${row.my_commission.toFixed(2)}` : "—"}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      >
                        {expandedId === row.id ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr>
                      <td colSpan={8} style={{ fontSize: 12, color: "#aaa", paddingTop: 0 }}>
                        <div style={{ marginBottom: 6 }}>{row.what_i_took}</div>
                        {row.my_sales != null && row.my_sales > 0 && <div>Sales: {row.my_sales} units</div>}
                        {row.rating ? <div>Rating: {row.rating}/5</div> : null}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
