import { useEffect, useState } from "react";
import type { AgentSessionLiveStatus } from "../hub";

export function useAgentSessionStatus(active: boolean, tasks?: string[]) {
  const [live, setLive] = useState<AgentSessionLiveStatus | null>(null);

  useEffect(() => {
    const handler = (_event: unknown, status: AgentSessionLiveStatus) => {
      if (tasks?.length && status.task && !tasks.includes(status.task)) return;
      setLive(status);
    };

    const unsubscribe = window.hub.onAgentSessionStatus(handler);
    return unsubscribe;
  }, [tasks?.join("|")]);

  useEffect(() => {
    if (!active && live?.phase !== "error") setLive(null);
  }, [active, live?.phase]);

  return live;
}
