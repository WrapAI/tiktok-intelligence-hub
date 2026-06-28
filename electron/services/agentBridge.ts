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

/** Batch rapid edits, then enforce a minimum gap between actual API syncs. */
const DEBOUNCE_MS = 60_000;
const MIN_SYNC_INTERVAL_MS = 15 * 60_000;

export function initAgentBridge(store: JsonStore, dataDir: string, dbDir: string) {
  ctx = { store, dataDir, dbDir };
}

function agentConfigured(store: JsonStore): boolean {
  return Boolean(store.getSetting("anthropicApiKey") && store.getSetting("tiktokAgentMemoryStoreId"));
}

function msSinceLastSync(store: JsonStore): number {
  const last = store.getSetting("tiktokAgentLastMemorySyncAt");
  if (!last) return Infinity;
  return Date.now() - new Date(last).getTime();
}

async function flushPending(force = false) {
  if (!ctx || syncInFlight || !pending.length) return;

  const { store, dataDir, dbDir } = ctx;
  if (!agentConfigured(store)) {
    pending = [];
    timer = null;
    return;
  }

  if (!force && msSinceLastSync(store) < MIN_SYNC_INTERVAL_MS) {
    const wait = MIN_SYNC_INTERVAL_MS - msSinceLastSync(store);
    timer = setTimeout(() => void flushPending(true), wait);
    return;
  }

  syncInFlight = true;
  pending = [];
  timer = null;

  try {
    await syncHubContextToMemoryStore(store, dataDir, dbDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Agent memory sync failed:", message);
    store.appendLog("agent_memory", "error", message);
  } finally {
    syncInFlight = false;
    if (pending.length) {
      timer = setTimeout(() => void flushPending(), DEBOUNCE_MS);
    }
  }
}

/** Queue a memory-store sync (debounced, rate-limited). */
export function notifyHubDataChanged(change: HubDataChange) {
  if (!ctx) return;
  pending.push(change);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushPending(), DEBOUNCE_MS);
}

/** Sync immediately (manual rescan in Settings). */
export function notifyHubDataChangedNow(change: HubDataChange) {
  if (!ctx) return;
  pending.push(change);
  if (timer) clearTimeout(timer);
  void flushPending(true);
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
