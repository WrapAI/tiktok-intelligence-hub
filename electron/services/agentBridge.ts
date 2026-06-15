import type { JsonStore } from "../db.js";
import { syncHubContextToMemoryStore } from "./tiktokAgent.js";

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

async function flushPending() {
  if (!ctx || syncInFlight || !pending.length) return;

  syncInFlight = true;
  pending = [];
  timer = null;

  const { store, dataDir, dbDir } = ctx;

  try {
    if (!agentConfigured(store)) return;

    // Sync memory store only — do NOT send agent messages on auto-sync.
    // The agent reads fresh from memory store on every user-triggered task.
    // Sending notifications creates new sessions and wastes money.
    await syncHubContextToMemoryStore(store, dataDir, dbDir);
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
