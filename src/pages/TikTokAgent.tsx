import { useEffect, useRef, useState } from "react";
import type { AgentMessage, AgentStatus } from "../hub";

export default function TikTokAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [s, history] = await Promise.all([
      window.hub.getAgentStatus(),
      window.hub.listAgentChatHistory(),
    ]);
    setStatus(s);
    setMessages(history);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSync() {
    setSyncing(true);
    setError("");
    setNotice("");
    const res = await window.hub.syncAgentMemory();
    setSyncing(false);
    if (!res.ok) {
      setError(res.error || "Sync failed");
      return;
    }
    setNotice(`Synced ${res.uploaded} context files to memory store.`);
    await refresh();
  }

  async function handleNewSession() {
    setLoading(true);
    setError("");
    const res = await window.hub.resetAgentSession();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Could not reset session");
      return;
    }
    setMessages([]);
    setNotice("New agent session started.");
    await refresh();
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError("");
    setNotice("");
    setInput("");

    const res = await window.hub.sendAgentMessage(text);
    setLoading(false);

    if (!res.ok) {
      setError(res.error || "Agent request failed");
      setInput(text);
      return;
    }

    await refresh();
  }

  const ready = status?.configured && status?.hasApiKey;

  return (
    <div>
      <h2 className="page-title">TikTok Agent</h2>
      <p className="page-desc">
        Your Claude managed agent for TikTok Shop strategy. Sync hub data to the memory store, then ask for filming
        plans, script angles, or product focus using your sales + library context.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Agent status</div>
        {!status ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul className="agent-status-list">
            <li>
              Agent ID: <code>{status.agentId || "—"}</code>
            </li>
            <li>
              Environment: <code>{status.environmentId || "—"}</code>
            </li>
            <li>
              Memory store: <code>{status.memoryStoreId || "—"}</code>
            </li>
            <li>Session: {status.sessionId ? <code>{status.sessionId}</code> : "None yet"}</li>
          </ul>
        )}
        {!status?.hasApiKey && <p className="error">Add your Anthropic API key in Settings.</p>}
        {status?.hasApiKey && !status?.environmentId && (
          <p className="error">Add your Agent environment ID in Settings.</p>
        )}
        {status?.hasApiKey && !status?.memoryStoreId && (
          <p className="muted">Optional: add a memory store ID to persist hub context across sessions.</p>
        )}
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-secondary" disabled={syncing || !status?.memoryConfigured} onClick={handleSync}>
            {syncing ? "Syncing…" : "Sync hub context → memory"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={handleNewSession}>
            New session
          </button>
        </div>
        {notice && <p className="success">{notice}</p>}
      </div>

      <div className="card agent-chat">
        <div className="agent-chat-log">
          {!messages.length && !loading && (
            <p className="muted">
              {ready
                ? "Sync context, then ask e.g. “Plan 5 bottom-funnel ideas for my top seller this week.”"
                : "Complete Settings first, then sync hub context."}
            </p>
          )}
          {messages.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
              <div className="agent-msg-role">{m.role === "user" ? "You" : "Agent"}</div>
              <div className="agent-msg-text">{m.text}</div>
            </div>
          ))}
          {loading && <p className="muted">Agent thinking…</p>}
          <div ref={bottomRef} />
        </div>

        <form className="agent-chat-form" onSubmit={handleSend}>
          <textarea
            className="field-input agent-chat-input"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ready ? "Ask your TikTok agent…" : "Configure agent in Settings first"}
            disabled={!ready || loading}
          />
          <button type="submit" className="btn btn-primary" disabled={!ready || loading || !input.trim()}>
            Send
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
