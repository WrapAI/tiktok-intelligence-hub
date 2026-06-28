import { useEffect, useRef, useState } from "react";
import type {
  AgentBudgetStatus,
  AgentCostBreakdown,
  AgentMessage,
  AgentStatus,
  CreatorGuidanceEntry,
  CreatorGuidanceKind,
} from "../hub";
import AgentCostBadge from "../components/AgentCostBadge";
import AgentSessionStatus from "../components/AgentSessionStatus";

type InputMode = "ask" | "rule" | "idea";

export default function TikTokAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [guidance, setGuidance] = useState<CreatorGuidanceEntry[]>([]);
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("ask");
  const [loading, setLoading] = useState(false);
  const [savingGuidance, setSavingGuidance] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [budget, setBudget] = useState<AgentBudgetStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSendCost, setLastSendCost] = useState<AgentCostBreakdown | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [s, history, b, g] = await Promise.all([
      window.hub.getAgentStatus(),
      window.hub.listAgentChatHistory(),
      window.hub.getAgentBudget(),
      window.hub.listCreatorGuidance(),
    ]);
    setStatus(s);
    setMessages(history);
    setBudget(b);
    setGuidance(g);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSync(bypassLimits = false) {
    setSyncing(true);
    setError("");
    setNotice("");
    const res = await window.hub.syncAgentMemory({ bypassLimits });
    setSyncing(false);
    if (!res.ok) {
      setError(res.error || "Sync failed");
      return;
    }
    const unchanged = res.skipped ? ` (${res.skipped} unchanged)` : "";
    setNotice(
      bypassLimits
        ? `Force-synced ${res.uploaded ?? 0} context files to memory store${unchanged}.`
        : `Synced ${res.uploaded ?? 0} context files to memory store${unchanged}.`
    );
    await refresh();
  }

  const syncAtHourlyLimit =
    !!budget && budget.memorySync.hour >= budget.memorySync.hourLimit;

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

  async function handleDeleteGuidance(id: string) {
    const res = await window.hub.deleteCreatorGuidance(id);
    if (!res.ok) {
      setError(res.error || "Could not delete");
      return;
    }
    await refresh();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading || savingGuidance) return;

    if (inputMode === "rule" || inputMode === "idea") {
      setSavingGuidance(true);
      setError("");
      setNotice("");
      const res = await window.hub.addCreatorGuidance({ kind: inputMode, text });
      setSavingGuidance(false);
      if (!res.ok) {
        setError(res.error || "Could not save");
        return;
      }
      setInput("");
      setNotice(
        inputMode === "rule"
          ? "Rule saved — included in Script Writer and synced to agent memory."
          : "Idea saved — synced to agent memory for future plans and chat."
      );
      await refresh();
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    setLastSendCost(null);
    setInput("");

    const res = await window.hub.sendAgentMessage(text);
    setLoading(false);

    if (!res.ok) {
      setError(res.error || "Agent request failed");
      setInput(text);
      return;
    }

    setLastSendCost(res.cost || null);
    await refresh();
  }

  const ready = status?.configured && status?.hasApiKey;
  const rules = guidance.filter((g) => g.kind === "rule");
  const ideas = guidance.filter((g) => g.kind === "idea");

  const placeholders: Record<InputMode, string> = {
    ask: "Ask e.g. “What should I film this week for my top seller?”",
    rule: "e.g. Never mention competitor brands. Always use “the yellow basket” CTA.",
    idea: "e.g. Try a “3 things I wish I knew” hook for bottom-funnel WildGut videos.",
  };

  const submitLabel =
    inputMode === "ask" ? "Send" : inputMode === "rule" ? "Save rule" : "Save idea";

  return (
    <div>
      <h2 className="page-title">TikTok Agent</h2>
      <p className="page-desc">
        Chat with your Claude agent, save persistent <strong>rules</strong> (always follow) and{" "}
        <strong>ideas</strong> (creative direction). Rules and script feedback flow into Script Writer; everything syncs
        to the agent memory store.
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
          <p className="muted">Memory store ID required for auto-sync on imports.</p>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          Manual sync: {budget?.memorySync.hourLimit ?? 2}/hour
          {budget ? ` (${budget.memorySync.hour} used)` : ""}.
        </p>
        <div className="btn-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={syncing || !status?.memoryConfigured}
            onClick={() => void handleSync(false)}
          >
            {syncing ? "Syncing…" : "Sync hub context → memory"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={syncing || !status?.memoryConfigured}
            onClick={() => void handleSync(true)}
            title="Bypass the hourly memory sync limit"
            style={syncAtHourlyLimit ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
          >
            Force sync (bypass limit)
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void handleNewSession()}>
            New session
          </button>
        </div>
        {notice && <p className="success" style={{ marginTop: 8 }}>{notice}</p>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">Your rules & ideas</div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Stored in <code>database/creator_guidance.json</code> and synced to{" "}
          <code>/hub/creator-guidance.md</code> in the agent memory store.
        </p>
        {guidance.length === 0 ? (
          <p className="muted">No rules or ideas yet — use the form below.</p>
        ) : (
          <>
            {rules.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="field-label">Rules</div>
                {rules.map((g) => (
                  <div key={g.id} className="pattern-list-item" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>{g.text}</div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: "4px 8px", flexShrink: 0 }}
                      onClick={() => void handleDeleteGuidance(g.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {ideas.length > 0 && (
              <div>
                <div className="field-label">Ideas</div>
                {ideas.map((g) => (
                  <div key={g.id} className="pattern-list-item" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>{g.text}</div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: "4px 8px", flexShrink: 0 }}
                      onClick={() => void handleDeleteGuidance(g.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card agent-chat">
        <div className="btn-row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
          {(
            [
              ["ask", "Ask agent"],
              ["rule", "Add rule"],
              ["idea", "Add idea"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={inputMode === mode ? "btn btn-primary" : "btn btn-secondary"}
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => setInputMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        {inputMode === "ask" && (
          <div className="agent-chat-log">
            {!messages.length && !loading && (
              <p className="muted">
                {ready ? placeholders.ask : "Complete Settings first, then sync hub context."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
                <div className="agent-msg-role">{m.role === "user" ? "You" : "Agent"}</div>
                <div className="agent-msg-text">{m.text}</div>
                {m.cost && (
                  <div className="agent-msg-cost muted">
                    ${m.cost.totalUsd.toFixed(3)} · {m.cost.modelLabel}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {inputMode !== "ask" && (
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            {inputMode === "rule"
              ? "Rules are hard constraints — the agent and Script Writer must follow them every time."
              : "Ideas are creative direction — the agent considers them when planning and writing."}
          </p>
        )}

        <form className="agent-chat-form" onSubmit={handleSubmit}>
          <div className="agent-chat-form-main">
            <textarea
              className="field-input agent-chat-input"
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ready ? placeholders[inputMode] : "Configure agent in Settings first"}
              disabled={!ready || loading || savingGuidance}
            />
            <div className="agent-chat-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!ready || loading || savingGuidance || !input.trim()}
              >
                {loading ? "Sending…" : savingGuidance ? "Saving…" : submitLabel}
              </button>
              {inputMode === "ask" && !loading && input.trim() && (
                <AgentCostBadge action="agent_chat" messageChars={input.trim().length} actualCost={lastSendCost} />
              )}
            </div>
            {inputMode === "ask" && <AgentSessionStatus active={loading} tasks={["agent_chat"]} />}
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
