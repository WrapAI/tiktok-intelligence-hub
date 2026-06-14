import { useEffect, useState } from "react";

export default function Library() {
  const [rows, setRows] = useState<
    Array<{ id: string; hook_type: string; funnel_category: string; view_count: number; payload_json: string }>
  >([]);

  useEffect(() => {
    window.hub.listLibrary().then((r) => setRows(r as typeof rows));
  }, []);

  return (
    <div>
      <h2 className="page-title">Competitor Library</h2>
      <p className="page-desc">Analyses imported from the extension swipe file.</p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">Import library.json from the extension Export Data button.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Hook type</th>
                <th>Funnel</th>
                <th>Views</th>
                <th>Hook</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const payload = JSON.parse(row.payload_json);
                const hook = payload.hook_detail?.text || payload.hook || "—";
                return (
                  <tr key={row.id}>
                    <td>{row.hook_type || "—"}</td>
                    <td>{row.funnel_category || "—"}</td>
                    <td>{row.view_count?.toLocaleString() || "—"}</td>
                    <td>{hook}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
