import fs from "node:fs";
import path from "node:path";

export type HubPaths = {
  userData: string;
  dataDir: string;
  dbDir: string;
};

export function resolvePaths(userData: string): HubPaths {
  const dataDir = path.join(userData, "hub-data");
  const dbDir = path.join(userData, "database");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(dbDir, { recursive: true });
  return { userData, dataDir, dbDir };
}

type TableName =
  | "settings"
  | "products"
  | "library_items"
  | "positive_memory"
  | "studio_snapshots"
  | "compass_snapshots"
  | "scripts"
  | "predictions"
  | "product_sales"
  | "daily_plans"
  | "sync_log";

const DEFAULTS: Record<TableName, unknown> = {
  settings: {},
  products: [],
  library_items: [],
  positive_memory: [],
  studio_snapshots: [],
  compass_snapshots: [],
  scripts: [],
  predictions: [],
  product_sales: [],
  daily_plans: [],
  sync_log: [],
};

export class JsonStore {
  private dbDir: string;

  constructor(dbDir: string) {
    this.dbDir = dbDir;
    for (const table of Object.keys(DEFAULTS) as TableName[]) {
      this.ensure(table);
    }
  }

  private file(table: TableName) {
    return path.join(this.dbDir, `${table}.json`);
  }

  private ensure(table: TableName) {
    const f = this.file(table);
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, JSON.stringify(DEFAULTS[table], null, 2), "utf8");
    }
  }

  read<T>(table: TableName): T {
    this.ensure(table);
    return JSON.parse(fs.readFileSync(this.file(table), "utf8")) as T;
  }

  write<T>(table: TableName, data: T) {
    fs.writeFileSync(this.file(table), JSON.stringify(data, null, 2), "utf8");
  }

  getSetting(key: string, fallback = ""): string {
    const settings = this.read<Record<string, string>>("settings");
    return settings[key] ?? fallback;
  }

  setSetting(key: string, value: string) {
    const settings = this.read<Record<string, string>>("settings");
    settings[key] = value;
    this.write("settings", settings);
  }

  list<T>(table: TableName): T[] {
    return this.read<T[]>(table);
  }

  upsertById<T extends { id: string }>(table: TableName, row: T) {
    const rows = this.list<T>(table);
    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx >= 0) rows[idx] = row;
    else rows.unshift(row);
    this.write(table, rows);
  }

  upsertManyById<T extends { id: string }>(table: TableName, incoming: T[]) {
    if (!incoming.length) return;
    const byId = new Map(this.list<T>(table).map((row) => [row.id, row]));
    for (const row of incoming) byId.set(row.id, row);
    this.write(table, Array.from(byId.values()));
  }

  deleteById(table: TableName, id: string) {
    const rows = this.list<{ id: string }>(table).filter((r) => r.id !== id);
    this.write(table, rows);
  }

  appendLog(type: string, status: string, message?: string) {
    const rows = this.list<{ id: number; type: string; status: string; message: string; created_at: string }>(
      "sync_log"
    );
    rows.unshift({
      id: Date.now(),
      type,
      status,
      message: message || "",
      created_at: new Date().toISOString(),
    });
    this.write("sync_log", rows.slice(0, 200));
  }
}

export type Store = JsonStore;
