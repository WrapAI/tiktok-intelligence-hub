import { useEffect, useState } from "react";

export default function Dashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.hub.getDashboard>> | null>(null);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  async function refresh() {
    setData(await window.hub.getDashboard());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function sync(type: "ALL" | "STUDIO" | "COMPASS") {
    setMessage("");
    setMessageIsError(false);
    const res = await window.hub.requestSync(type);
    setMessageIsError(!res.ok);
    setMessage(res.ok ? res.message || "Sync requested" : res.error || "Sync failed");
  }

  async function importFiles() {
    setMessage("");
    setMessageIsError(false);
    const res = await window.hub.importFiles();
    if (res.canceled) return;
    if (res.message) {
      setMessageIsError(!res.ok);
      setMessage(res.message);
    } else if (res.error) {
      setMessageIsError(true);
      setMessage(res.error);
    } else if (res.errors?.length) {
      setMessageIsError(true);
      setMessage(res.errors.map((e) => `${e.file}: ${e.error}`).join(" · "));
    } else {
      setMessageIsError(!res.ok);
      setMessage(res.ok ? "Import complete" : "Import failed");
    }
    refresh();
  }

  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-desc">
        Central database for your TikTok Hook Analyzer extension. Import JSON from the extension or XLSX
        from TikTok Shop / Affiliate Centre exports.
      </p>

      <div className="grid-3">
        <div className="stat-card">
          <div className="stat-label">Library</div>
          <div className="stat-value">{data.libraryCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Positive memory</div>
          <div className="stat-value">{data.memoryCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Products</div>
          <div className="stat-value">{data.productCount}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Sync & import</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          Data folder: {data.dataFolder}
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.openDataFolder()}>
            Open data folder
          </button>
          <button type="button" className="btn btn-secondary" onClick={importFiles}>
            Import files…
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.rescanDataFolder().then(refresh)}>
            Rescan folder
          </button>
          <button type="button" className="btn btn-primary" onClick={() => sync("ALL")}>
            Request extension sync (Studio + Compass)
          </button>
        </div>
        {message && <p className={messageIsError ? "error" : "success"}>{message}</p>}
        <p className="muted" style={{ marginTop: 10 }}>
          Studio last sync: {data.latestStudioSync || "—"} · Compass last sync: {data.latestCompassSync || "—"}
        </p>
      </div>

      <div className="card">
        <div className="card-title">Your win rate memory</div>
        <p className="muted">
          Avg rating {data.summary.avgRating.toFixed(1)}/5 · Avg views{" "}
          {Math.round(data.summary.avgMyViews).toLocaleString()} · Avg GMV £
          {data.summary.avgMyGmv.toFixed(2)}
        </p>
      </div>
    </div>
  );
}
