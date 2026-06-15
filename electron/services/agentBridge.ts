import type { JsonStore } from "../db.js";
import { sendAgentTask, syncHubContextToMemoryStore } from "./tiktokAgent.js";

export type HubDataChangeKind =
  | "library"
  | "sales"
  | "products"
  | "memory"
  | "studio"
  | "compass"
  | "script"
  | "daily_plan"
  | "product_edit"
  | "rescan"
  | "import";

export type HubDataChange = {
  kind: HubDataChangeKind;
  summary: string;
  count?: number;
  file?: string;
};

type SyncContext = {
  store: JsonStore;
  dataDir: string;
  dbDir: string;
};

let ctx: SyncContext | null = null;
let pending: HubDataChange[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let syncInFlight = false;

export function initAgentBridge(store: JsonStore, dataDir: string, dbDir: string) {
  ctx = { store, dataDir, dbDir };
}

function agentConfigured(store: JsonStore): boolean {
  return Boolean(store.getSetting("anthropicApiKey") && store.getSetting("tiktokAgentMemoryStoreId"));
}

function formatChangeLine(change: HubDataChange): string {
  const count = change.count != null ? ` (${change.count} records)` : "";
  const file = change.file ? ` — ${change.file}` : "";
  return `- **${change.kind}**: ${change.summary}${count}${file}`;
}

async function flushPending() {
  if (!ctx || syncInFlight || !pending.length) return;

  syncInFlight = true;
  const batch = [...pending];
  pending = [];
  timer = null;

  const { store, dataDir, dbDir } = ctx;

  try {
    if (!agentConfigured(store)) return;

    const result = await syncHubContextToMemoryStore(store, dataDir, dbDir);
    const lines = batch.map(formatChangeLine).join("\n");

    const notifyMessage = `[Hub auto-sync] New hub data was imported and synced to your memory store.

Updated ${result.uploaded} files under /hub/*.md.

Changes:
${lines}

Absorb this for future scripts, daily plans, and product strategy. Reply with a one-line acknowledgment only.`;

    void sendAgentTask(store, notifyMessage, { timeoutMs: 90_000 }).catch((err) => {
      console.error("Agent data notify failed:", err);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Agent memory sync failed:", message);
    store.appendLog("agent_memory", "error", message);
  } finally {
    syncInFlight = false;
    if (pending.length) {
      timer = setTimeout(() => void flushPending(), 1000);
    }
  }
}

/** Queue a memory-store sync + agent notification (debounced ~2s). */
export function notifyHubDataChanged(change: HubDataChange) {
  if (!ctx) return;
  pending.push(change);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushPending(), 2000);
}

/** Sync immediately (e.g. app startup rescan). */
export function notifyHubDataChangedNow(change: HubDataChange) {
  if (!ctx) return;
  pending.push(change);
  if (timer) clearTimeout(timer);
  void flushPending();
}

export function hubChangeFromImport(type: string, count: number, file?: string): HubDataChange {
  const kindMap: Record<string, HubDataChangeKind> = {
    library: "library",
    positive_memory: "memory",
    product_sales: "sales",
    products: "products",
    studio: "studio",
    compass: "compass",
  };
  const kind = kindMap[type] || "import";
  return {
    kind,
    summary: `Imported ${type.replace(/_/g, " ")}`,
    count,
    file,
  };
}
