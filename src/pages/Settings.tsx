import { useEffect, useState } from "react";

type Voice = { voice_id: string; name: string };

export default function Settings({ onSaved }: { onSaved?: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [handle, setHandle] = useState("");
  const [dataFolder, setDataFolder] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    window.hub.getSettings().then((s) => {
      setApiKey(s.anthropicApiKey || "");
      setElevenKey(s.elevenLabsApiKey || "");
      setVoiceId(s.elevenLabsVoiceId || "");
      setHandle(s.myTiktokHandle || "");
      setDataFolder(s.dataFolder || "");
    });
  }, []);

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
    await window.hub.saveSettings({
      anthropicApiKey: apiKey,
      elevenLabsApiKey: elevenKey,
      elevenLabsVoiceId: voiceId,
      myTiktokHandle: handle,
      dataFolder,
    });
    setStatus("Settings saved locally on this machine");
    onSaved?.();
  }

  return (
    <div>
      <h2 className="page-title">Settings</h2>
      <p className="page-desc">
        API keys are stored only on your computer (never in the repo). Paste keys here once, then Save.
      </p>

      <form className="card" style={{ maxWidth: 560 }} onSubmit={save}>
        <div className="card-title">Claude (scripts + predictions)</div>
        <label className="field-label">Anthropic API key</label>
        <input
          type="password"
          className="field-input"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          autoComplete="off"
        />

        <div className="card-title" style={{ marginTop: 16 }}>
          ElevenLabs (script → audio)
        </div>
        <label className="field-label">ElevenLabs API key</label>
        <input
          type="password"
          className="field-input"
          value={elevenKey}
          onChange={(e) => setElevenKey(e.target.value)}
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
          onChange={(e) => setVoiceId(e.target.value)}
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
          onChange={(e) => setHandle(e.target.value)}
          placeholder="@yourname"
        />

        <label className="field-label">Data folder (extension sync + imports)</label>
        <input className="field-input" value={dataFolder} onChange={(e) => setDataFolder(e.target.value)} />
        <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Inside this folder the hub creates: library/, memory/, products/, sales-data/, studio/, compass/, inbox/, and
          archive/ for every successful import.
        </p>

        <button type="submit" className="btn btn-primary">
          Save settings
        </button>
        {status && <p className="success">{status}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
