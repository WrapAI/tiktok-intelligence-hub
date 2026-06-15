import { useEffect, useState } from "react";
import type { DataLayoutSummary, ImportHistoryEntry } from "../hub";

const FOLDER_SHORT: Record<string, string> = {
  library: "library",
  memory: "memory",
  products: "products",
  sales: "sales-data",
  studio: "studio",
  compass: "compass",
  inbox: "inbox",
};

export default function Dashboard() {
  const [data, setData] = useState<Awaited<ReturnType<typeof window.hub.getDashboard>> | null>(null);
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);

  async function refresh() {
    const [dash, imports] = await Promise.all([window.hub.getDashboard(), window.hub.listImportHistory()]);
    setData(dash);
    setHistory(imports);
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

  const layout: DataLayoutSummary = data.dataLayout;

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-desc">
        Central database for your TikTok Hook Analyzer extension. Files are sorted into folders automatically and
        archived over time so you can build a full import history.
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
        <div className="card-title">Data folders</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          Root: {layout.root} · Database: {layout.database} · {layout.archiveCount} archived ·{" "}
          {data.importHistoryCount} imports logged
        </p>
        <div className="folder-grid">
          {layout.folders.map((folder) => (
            <div key={folder.id} className="folder-card">
              <div className="folder-card-head">
                <strong>{folder.label}</strong>
                <span className="muted">{folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}</span>
              </div>
              <p className="muted folder-card-desc">{folder.description}</p>
              <code className="folder-path">{FOLDER_SHORT[folder.id] || folder.id}/</code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => window.hub.openDataSubfolder(folder.id)}
              >
                Open folder
              </button>
            </div>
          ))}
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.openDataFolder()}>
            Open all data
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.openDataSubfolder("archive")}>
            Open archive
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Sync & import</div>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={importFiles}>
            Import files…
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.rescanDataFolder().then(refresh)}>
            Rescan folders
          </button>
          <button type="button" className="btn btn-primary" onClick={() => sync("ALL")}>
            Request extension sync (Studio + Compass)
          </button>
        </div>
        {message && <p className={messageIsError ? "error" : "success"}>{message}</p>}
        <p className="muted" style={{ marginTop: 10 }}>
          Studio last sync: {data.latestStudioSync || "—"} · Compass last sync: {data.latestCompassSync || "—"} · Sales
          rows: {data.salesCount}
        </p>
      </div>

      {history.length ? (
        <div className="card">
          <div className="card-title">Recent imports</div>
          <ul className="import-history-list">
            {history.slice(0, 8).map((row) => (
              <li key={row.id}>
                <span className="import-history-type">{row.import_type}</span>
                <span>{row.file_name}</span>
                <span className="muted">
                  {row.record_count} records · {new Date(row.imported_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
