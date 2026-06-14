import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";
import ScriptWriter from "./pages/ScriptWriter";
import Products from "./pages/Products";
import Library from "./pages/Library";
import Memory from "./pages/Memory";
import Settings from "./pages/Settings";

type Tab = "dashboard" | "scripts" | "products" | "library" | "memory" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "scripts", label: "Script Writer" },
  { id: "products", label: "My Products" },
  { id: "library", label: "Library" },
  { id: "memory", label: "Memory" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [whisperOnline, setWhisperOnline] = useState(false);
  const hubReady = typeof window !== "undefined" && !!window.hub;

  useEffect(() => {
    if (!window.hub) return;
    window.hub.checkWhisper().then(setWhisperOnline).catch(() => setWhisperOnline(false));
  }, []);

  if (!hubReady) {
    return (
      <div className="app">
        <main className="main">
          <div className="card">
            <div className="card-title">TikTok Intelligence Hub</div>
            <p className="error">App bridge failed to load (preload script error).</p>
            <p className="muted">
              Close all Electron windows, run <code>git pull</code>, then <code>npm.cmd run dev</code> again.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎣</span>
          <div>
            <h1>TikTok Intelligence Hub</h1>
            <p className="subtitle">Extension database · performance · scripts</p>
          </div>
        </div>
        <div className={`status-pill ${whisperOnline ? "online" : "offline"}`}>
          {whisperOnline ? "Whisper online" : "Whisper offline"}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "dashboard" && <Dashboard />}
        {tab === "scripts" && <ScriptWriter />}
        {tab === "products" && <Products />}
        {tab === "library" && <Library />}
        {tab === "memory" && <Memory />}
        {tab === "settings" && <Settings onSaved={() => window.hub.checkWhisper().then(setWhisperOnline)} />}
      </main>
    </div>
  );
}
