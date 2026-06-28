import { useEffect, useRef, useState } from "react";
import type { AgentBudgetStatus } from "../hub";

type Voice = { voice_id: string; name: string };

export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [handle, setHandle] = useState("");
  const [dataFolder, setDataFolder] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agentEnvironmentId, setAgentEnvironmentId] = useState("");
  const [agentMemoryStoreId, setAgentMemoryStoreId] = useState("");
  const [agentSessionId, setAgentSessionId] = useState("");
  const [googleClientId, setGoogleClientId] = useState(
    "609584253079-uvigalsnk0118tbn7s51ecrgh87atf6o.apps.googleusercontent.com"
  );
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleRootFolder, setGoogleRootFolder] = useState("TikTok - Voiceovers");
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [agentBudget, setAgentBudget] = useState<AgentBudgetStatus | null>(null);
  const [confirmResetGuardrails, setConfirmResetGuardrails] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.hub.getSettings().then((s) => {
      setApiKey(s.anthropicApiKey || "");
      setGrokKey(s.grokApiKey || "");
      setElevenKey(s.elevenLabsApiKey || "");
      setVoiceId(s.elevenLabsVoiceId || "");
      setHandle(s.myTiktokHandle || "");
      setDataFolder(s.dataFolder || "");
      setAgentId(s.tiktokAgentId || "agent_01NxQdQvuQLXgJgMgXbQ1LNz");
      setAgentEnvironmentId(s.tiktokAgentEnvironmentId || "env_0139W3beYzg2rMpMX18KQ69M");
      setAgentMemoryStoreId(s.tiktokAgentMemoryStoreId || "memstore_01Vp97M6cAtSRivSiWnGsL67");
      setAgentSessionId(s.tiktokAgentSessionId || "sesn_01PHBz1sPSVVM61oH2yzNQi9");
      setGoogleClientId(
        s.googleDriveClientId ||
          "609584253079-uvigalsnk0118tbn7s51ecrgh87atf6o.apps.googleusercontent.com"
      );
      setGoogleClientSecret(s.googleDriveClientSecret || "");
      setGoogleRootFolder(s.googleDriveRootFolder || "TikTok - Voiceovers");
      loadedRef.current = true;
    });
    void refreshDriveStatus();
    void refreshAgentBudget();
  }, []);

  async function refreshAgentBudget() {
    setAgentBudget(await window.hub.getAgentBudget());
  }

  async function handleResetGuardrails() {
    const res = await window.hub.resetAgentGuardrails();
    setConfirmResetGuardrails(false);
    setAgentBudget(res.budget);
    setStatus("Agent budget protection reset");
  }

  async function refreshDriveStatus() {
    const res = await window.hub.getGoogleDriveStatus();
    setDriveConnected(!!res.connected);
  }

  async function handleConnectDrive() {
    setDriveBusy(true);
    setError("");
    await window.hub.saveSettings({
      googleDriveClientId: googleClientId.trim(),
      googleDriveClientSecret: googleClientSecret.trim(),
      googleDriveRootFolder: googleRootFolder.trim() || "TikTok - Voiceovers",
    });
    const res = await window.hub.connectGoogleDrive();
    setDriveBusy(false);
    if (!res.ok) {
      setError(res.error || "Google Drive connection failed");
      return;
    }
    setDriveConnected(true);
    setStatus("Google Drive connected");
  }

  function scheduleAutoSave(patch: Record<string, string>) {
    if (!loadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await window.hub.saveSettings(patch);
      setStatus("Saved");
      onSaved?.();
      saveTimerRef.current = null;
    }, 600);
  }

  async function loadVoices() {
    setError("");
    if (elevenKey.trim()) {
      await window.hub.saveSettings({ elevenLabsApiKey: elevenKey.trim() });
    }
    const res = await window.hub.listElevenLabsVoices();
    if (!res.ok) {
      setError(res.error || "Could not load voices");
      return;
    }
    setVoices(res.voices || []);
    if (!voiceId && res.voices?.[0]?.voice_id) {
      setVoiceId(res.voices[0].voice_id);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await window.hub.saveSettings({
      anthropicApiKey: apiKey,
      grokApiKey: grokKey,
      elevenLabsApiKey: elevenKey,
      elevenLabsVoiceId: voiceId,
      myTiktokHandle: handle,
      dataFolder,
      tiktokAgentId: agentId,
      tiktokAgentEnvironmentId: agentEnvironmentId,
      tiktokAgentMemoryStoreId: agentMemoryStoreId,
      tiktokAgentSessionId: agentSessionId,
      googleDriveClientId: googleClientId,
      googleDriveClientSecret: googleClientSecret,
      googleDriveRootFolder: googleRootFolder,
    });
    setStatus("Settings saved locally on this machine");
    onSaved?.();
  }

  return (
    <div>
      <h2 className="page-title">Settings</h2>
      <p className="page-desc">
        API keys are stored only on your computer (never in the repo). Keys auto-save as you type.
      </p>

      <form className="card" style={{ maxWidth: 560 }} onSubmit={save}>
        <div className="card-title">Claude (scripts + predictions)</div>
        <label className="field-label">Anthropic API key</label>
        <input
          type="password"
          className="field-input"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            scheduleAutoSave({ anthropicApiKey: e.target.value });
          }}
          placeholder="sk-ant-..."
          autoComplete="off"
        />

        <div className="card-title" style={{ marginTop: 16 }}>
          Grok / xAI (My Videos analysis)
        </div>
        <label className="field-label">Grok API key</label>
        <input
          type="password"
          className="field-input"
          value={grokKey}
          onChange={(e) => {
            setGrokKey(e.target.value);
            scheduleAutoSave({ grokApiKey: e.target.value });
          }}
          placeholder="xai-..."
          autoComplete="off"
        />
        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
          Used to analyse your own TikTok videos via Grok vision. Get your key at console.x.ai
        </p>

        <div className="card-title" style={{ marginTop: 16 }}>
          ElevenLabs (script → audio)
        </div>
        <label className="field-label">ElevenLabs API key</label>
        <input
          type="password"
          className="field-input"
          value={elevenKey}
          onChange={(e) => {
            setElevenKey(e.target.value);
            scheduleAutoSave({ elevenLabsApiKey: e.target.value });
          }}
          placeholder="Your ElevenLabs key"
          autoComplete="off"
        />

        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={loadVoices}>
            Load my voices
          </button>
        </div>

        <label className="field-label">Voice</label>
        <select
          className="field-select"
          value={voiceId}
          onChange={(e) => {
            setVoiceId(e.target.value);
            scheduleAutoSave({ elevenLabsVoiceId: e.target.value });
          }}
        >
          <option value="">— Select voice —</option>
          {voices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.name}
            </option>
          ))}
        </select>

        <label className="field-label">Your TikTok handle</label>
        <input
          className="field-input"
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            scheduleAutoSave({ myTiktokHandle: e.target.value });
          }}
          placeholder="@yourname"
        />

        <div className="card-title" style={{ marginTop: 20 }}>
          Google Drive (voiceovers → phone)
        </div>
        <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          Client ID is pre-filled. Paste your client secret from{" "}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
            Google Cloud Console → Credentials
          </a>
          {" "}→ your OAuth 2.0 Desktop client. Enable Google Drive API on the project, then click Connect once.
        </p>
        <label className="field-label">Google Drive client ID</label>
        <input
          className="field-input"
          value={googleClientId}
          onChange={(e) => {
            setGoogleClientId(e.target.value);
            scheduleAutoSave({ googleDriveClientId: e.target.value });
          }}
          autoComplete="off"
        />
        <label className="field-label">Google Drive client secret</label>
        <input
          type="password"
          className="field-input"
          value={googleClientSecret}
          onChange={(e) => {
            setGoogleClientSecret(e.target.value);
            scheduleAutoSave({ googleDriveClientSecret: e.target.value });
          }}
          placeholder="GOCSPX-..."
          autoComplete="off"
        />
        <label className="field-label">Root folder on Drive</label>
        <input
          className="field-input"
          value={googleRootFolder}
          onChange={(e) => {
            setGoogleRootFolder(e.target.value);
            scheduleAutoSave({ googleDriveRootFolder: e.target.value });
          }}
          placeholder="TikTok - Voiceovers"
        />
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Each new day, click Create today&apos;s folder on Script Writer — only the date folder is created. Product
          subfolders are added when you send a voiceover.
        </p>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-secondary" disabled={driveBusy} onClick={() => void handleConnectDrive()}>
            {driveBusy ? "Connecting…" : driveConnected ? "Reconnect Google Drive" : "Connect Google Drive"}
          </button>
          <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
            {driveConnected ? "✓ Connected" : "Not connected"}
          </span>
        </div>

        <div className="card-title" style={{ marginTop: 20 }}>
          Agent API budget
        </div>
        <p className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          Hard limits prevent runaway loops (like 30 agent calls in one hour). Normal day: a few scripts + one daily plan.
        </p>
        {agentBudget && (
          <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
            <div>
              Agent calls: {agentBudget.managedAgent.hour}/{agentBudget.managedAgent.hourLimit} this hour ·{" "}
              {agentBudget.managedAgent.day}/{agentBudget.managedAgent.dayLimit} today
            </div>
            <div>
              Spend today: ${agentBudget.spendTodayUsd.toFixed(2)} / ${agentBudget.spendDayLimitUsd.toFixed(2)}
            </div>
            {agentBudget.circuitBreakerActive && (
              <p className="error" style={{ marginTop: 8 }}>
                API locked until {agentBudget.circuitBreakerUntil ? new Date(agentBudget.circuitBreakerUntil).toLocaleString() : "—"}
                {agentBudget.circuitBreakerReason ? ` — ${agentBudget.circuitBreakerReason}` : ""}
              </p>
            )}
          </div>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => void refreshAgentBudget()}>
            Refresh budget
          </button>
          {!confirmResetGuardrails ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmResetGuardrails(true)}>
              Reset protection
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" onClick={() => void handleResetGuardrails()}>
                Confirm reset
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmResetGuardrails(false)}>
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="card-title" style={{ marginTop: 20 }}>
          TikTok Claude Agent
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Managed agent session + memory store. Agent ID is pre-filled; add your environment and memory store IDs from
          the Anthropic Console.
        </p>
        <label className="field-label">Agent ID</label>
        <input className="field-input" value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="agent_01NxQdQvuQLXgJgMgXbQ1LNz" />
        <label className="field-label">Environment ID</label>
        <input className="field-input" value={agentEnvironmentId} onChange={(e) => setAgentEnvironmentId(e.target.value)} placeholder="env_0139W3beYzg2rMpMX18KQ69M" />
        <label className="field-label">Memory store ID</label>
        <input className="field-input" value={agentMemoryStoreId} onChange={(e) => setAgentMemoryStoreId(e.target.value)} placeholder="memstore_01Vp97M6cAtSRivSiWnGsL67" />
        <label className="field-label">Session ID (optional — reuse existing session)</label>
        <input className="field-input" value={agentSessionId} onChange={(e) => setAgentSessionId(e.target.value)} placeholder="sesn_01PHBz1sPSVVM61oH2yzNQi9" />

        <label className="field-label">Data folder (extension sync + imports)</label>
        <input className="field-input" value={dataFolder} onChange={(e) => setDataFolder(e.target.value)} />
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Inside this folder the hub creates: library/, memory/, products/, sales-data/, studio/, compass/, inbox/, and
          archive/ for every successful import.
        </p>

        <button type="submit" className="btn btn-primary">
          Save all settings
        </button>
        {status && <p className="success">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
