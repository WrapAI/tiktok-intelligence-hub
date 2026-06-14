import { useEffect, useState } from "react";

export default function Memory() {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      rating: number;
      my_views: number;
      my_gmv: number;
      what_i_took: string;
      payload_json: string;
    }>
  >([]);

  useEffect(() => {
    window.hub.listMemory().then((r) => setRows(r as typeof rows));
  }, []);

  return (
    <div>
      <h2 className="page-title">Positive Memory</h2>
      <p className="page-desc">Strategies you copied and how they performed — feeds Script Writer and predictions.</p>
      <div className="card">
        {rows.length === 0 ? (
          <p className="muted">Import positive_memory.json from the extension.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Rating</th>
                <th>What you took</th>
                <th>Your views</th>
                <th>GMV</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.rating ? `${row.rating}/5` : "—"}</td>
                  <td>{row.what_i_took || "—"}</td>
                  <td>{row.my_views?.toLocaleString() || "—"}</td>
                  <td>{row.my_gmv ? `£${row.my_gmv}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
