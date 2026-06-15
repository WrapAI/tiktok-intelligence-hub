import type { BrowserWindow } from "electron";

export type AgentSessionPhase =
  | "connecting"
  | "sending"
  | "running"
  | "waiting_json"
  | "finalizing"
  | "done"
  | "error";

export type AgentSessionLiveStatus = {
  active: boolean;
  phase: AgentSessionPhase;
  message: string;
  sessionStatus?: string;
  task?: string;
  sessionId?: string;
  at: string;
};

let statusWindow: BrowserWindow | null = null;

export function setAgentStatusWindow(win: BrowserWindow | null) {
  statusWindow = win;
}

export function emitAgentSessionStatus(status: AgentSessionLiveStatus) {
  statusWindow?.webContents.send("hub:agent-session-status", status);
}

export function clearAgentSessionStatus(task?: string) {
  emitAgentSessionStatus({
    active: false,
    phase: "done",
    message: "",
    task,
    at: new Date().toISOString(),
  });
}
