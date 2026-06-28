import { useAgentSessionStatus } from "../hooks/useAgentSessionStatus";

type Props = {
  active: boolean;
  tasks?: string[];
};

export default function AgentSessionStatus({ active, tasks }: Props) {
  const live = useAgentSessionStatus(active, tasks);

  if (!active || !live?.active || !live.message) return null;

  return (
    <div className="agent-session-status" role="status" aria-live="polite">
      <span className="agent-session-status-dot" aria-hidden />
      <div className="agent-session-status-body">
        <span className="agent-session-status-message">{live.message}</span>
        <span className="agent-session-status-meta muted">
          Session status: {live.sessionStatus || "—"}
          {live.sessionId ? ` · ${live.sessionId.slice(0, 14)}…` : ""}
        </span>
      </div>
    </div>
  );
}
