import { lazy, Suspense, useEffect, useState } from "react";
import TabPanel from "./components/TabPanel";
import Dashboard from "./pages/Dashboard";
import DailyPlanner from "./pages/DailyPlanner";
import Products from "./pages/Products";
import Library from "./pages/Library";
import Memory from "./pages/Memory";
import TikTokAgent from "./pages/TikTokAgent";
import Settings from "./pages/Settings";
import MyVideos from "./pages/MyVideos";
import PendingAnalysis from "./pages/PendingAnalysis";

const ScriptWriter = lazy(() => import("./pages/ScriptWriter"));

type Tab = "dashboard" | "planner" | "agent" | "scripts" | "pending" | "products" | "library" | "memory" | "myvideos" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "planner", label: "Daily Planner" },
  { id: "agent", label: "TikTok Agent" },
  { id: "scripts", label: "Script Writer" },
  { id: "pending", label: "Pending Analysis" },
  { id: "products", label: "My Products" },
  { id: "library", label: "Library" },
  { id: "memory", label: "Memory" },
  { id: "myvideos", label: "My Videos" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set(["dashboard"]));
  const [whisperOnline, setWhisperOnline] = useState(false);
  const hubReady = typeof window !== "undefined" && !!window.hub;

  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

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
            <p className="subtitle">Plan · scripts · performance</p>
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
        <TabPanel active={tab === "dashboard"} mounted={mountedTabs.has("dashboard")}>
          <Dashboard />
        </TabPanel>
        <TabPanel active={tab === "planner"} mounted={mountedTabs.has("planner")}>
          <DailyPlanner />
        </TabPanel>
        <TabPanel active={tab === "agent"} mounted={mountedTabs.has("agent")}>
          <TikTokAgent />
        </TabPanel>
        <TabPanel active={tab === "scripts"} mounted={mountedTabs.has("scripts")}>
          <Suspense fallback={<p className="muted">Loading Script Writer…</p>}>
            <ScriptWriter />
          </Suspense>
        </TabPanel>
        <TabPanel active={tab === "pending"} mounted={mountedTabs.has("pending")}>
          <PendingAnalysis />
        </TabPanel>
        <TabPanel active={tab === "products"} mounted={mountedTabs.has("products")}>
          <Products />
        </TabPanel>
        <TabPanel active={tab === "library"} mounted={mountedTabs.has("library")}>
          <Library />
        </TabPanel>
        <TabPanel active={tab === "memory"} mounted={mountedTabs.has("memory")}>
          <Memory />
        </TabPanel>
        <TabPanel active={tab === "myvideos"} mounted={mountedTabs.has("myvideos")}>
          <MyVideos />
        </TabPanel>
        <TabPanel active={tab === "settings"} mounted={mountedTabs.has("settings")}>
          <Settings onSaved={() => window.hub.checkWhisper().then(setWhisperOnline)} />
        </TabPanel>
      </main>
    </div>
  );
}
