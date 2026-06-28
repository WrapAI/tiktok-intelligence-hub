import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, shell } from "electron";
import { google } from "googleapis";
import type { JsonStore } from "../db.js";
import { shortenProductName } from "./productNaming.js";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const OAUTH_PORT = 42813;
const OAUTH_CALLBACK_PATH = "/oauth2callback";
const DEFAULT_ROOT_FOLDER = "TikTok - Voiceovers";
const DAILY_FOLDERS_SETTING = "googleDriveDailyFoldersDate";
export const DEFAULT_GOOGLE_DRIVE_CLIENT_ID =
  "609584253079-uvigalsnk0118tbn7s51ecrgh87atf6o.apps.googleusercontent.com";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

type CredentialsKeys = {
  client_id: string;
  client_secret: string;
};

function tokenPath(): string {
  return path.join(app.getPath("userData"), "google-drive-token.json");
}

function legacyTokenCandidates(): string[] {
  const candidates: string[] = [];
  const hookAnalyzer = path.resolve(app.getAppPath(), "..", "..", "tiktok-hook-analyzer", "drive_token.json");
  candidates.push(hookAnalyzer);
  candidates.push(path.join(process.cwd(), "tiktok-hook-analyzer", "drive_token.json"));
  return candidates;
}

function parseCredentialsJson(filePath: string): CredentialsKeys | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      installed?: CredentialsKeys;
      web?: CredentialsKeys;
    };
    const keys = parsed.installed || parsed.web;
    if (!keys?.client_id || !keys?.client_secret) return null;
    return { client_id: keys.client_id, client_secret: keys.client_secret };
  } catch {
    return null;
  }
}

function discoverLegacyCredentialsJson(): string | null {
  const downloads = path.join(app.getPath("home"), "Downloads");
  const exact = path.join(
    downloads,
    `client_secret_${DEFAULT_GOOGLE_DRIVE_CLIENT_ID}.json`
  );
  if (fs.existsSync(exact)) return exact;

  if (!fs.existsSync(downloads)) return null;
  const matches = fs
    .readdirSync(downloads)
    .filter((f) => f.startsWith("client_secret") && f.endsWith(".json"))
    .map((f) => path.join(downloads, f));
  return matches[0] || null;
}

function loadOAuthKeys(store: JsonStore): CredentialsKeys {
  let clientId = store.getSetting("googleDriveClientId")?.trim() || DEFAULT_GOOGLE_DRIVE_CLIENT_ID;
  let clientSecret = store.getSetting("googleDriveClientSecret")?.trim() || "";

  if (!clientSecret) {
    const legacyPath = store.getSetting("googleDriveCredentialsPath")?.trim();
    const candidates = [legacyPath, discoverLegacyCredentialsJson()].filter(Boolean) as string[];
    for (const filePath of candidates) {
      const keys = parseCredentialsJson(filePath);
      if (!keys?.client_secret) continue;
      clientSecret = keys.client_secret;
      store.setSetting("googleDriveClientSecret", clientSecret);
      if (!store.getSetting("googleDriveClientId")?.trim()) {
        clientId = keys.client_id;
        store.setSetting("googleDriveClientId", clientId);
      }
      break;
    }
  }

  if (!store.getSetting("googleDriveClientId")?.trim()) {
    store.setSetting("googleDriveClientId", clientId);
  }

  if (!clientSecret) {
    throw new Error(
      "Add your Google Drive client secret in Settings. In Google Cloud Console → Credentials → your OAuth client, copy the client secret."
    );
  }

  return { client_id: clientId, client_secret: clientSecret };
}

function createOAuthClient(keys: CredentialsKeys): { client: OAuth2Client; redirectUri: string } {
  const redirectUri = `http://127.0.0.1:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`;
  const client = new google.auth.OAuth2(keys.client_id, keys.client_secret, redirectUri);
  return { client, redirectUri };
}

function loadStoredToken(client: OAuth2Client): boolean {
  const file = tokenPath();
  if (fs.existsSync(file)) {
    client.setCredentials(JSON.parse(fs.readFileSync(file, "utf8")));
    return true;
  }

  for (const legacy of legacyTokenCandidates()) {
    if (!fs.existsSync(legacy)) continue;
    try {
      const creds = JSON.parse(fs.readFileSync(legacy, "utf8"));
      client.setCredentials(creds);
      fs.writeFileSync(file, JSON.stringify(creds, null, 2), "utf8");
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function saveToken(client: OAuth2Client): void {
  const creds = client.credentials;
  if (!creds?.access_token) return;
  fs.writeFileSync(tokenPath(), JSON.stringify(creds, null, 2), "utf8");
}

async function getAuthenticatedClient(store: JsonStore): Promise<OAuth2Client> {
  const keys = loadOAuthKeys(store);
  const { client } = createOAuthClient(keys);
  const hasToken = loadStoredToken(client);

  if (!hasToken || !client.credentials.access_token) {
    throw new Error("Google Drive not connected — open Settings and click Connect Google Drive.");
  }

  if (client.credentials.expiry_date && client.credentials.expiry_date <= Date.now() + 60_000) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    saveToken(client);
  }

  return client;
}

async function runOAuthFlow(client: OAuth2Client, redirectUri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!req.url?.startsWith(OAUTH_CALLBACK_PATH)) {
          res.writeHead(404);
          res.end();
          return;
        }

        const url = new URL(req.url, redirectUri);
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err) throw new Error(err);
        if (!code) throw new Error("No authorization code returned");

        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        saveToken(client);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body style='font-family:sans-serif;padding:40px'><h2>Google Drive connected</h2><p>You can close this tab and return to TikTok Intelligence Hub.</p></body></html>"
        );
        server.close();
        resolve();
      } catch (e) {
        res.writeHead(500);
        res.end("Authentication failed");
        server.close();
        reject(e);
      }
    });

    server.listen(OAUTH_PORT, "127.0.0.1", () => {
      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
      });
      void shell.openExternal(authUrl);
    });

    server.on("error", reject);
  });
}

export async function connectGoogleDrive(store: JsonStore): Promise<{ ok: boolean; error?: string }> {
  try {
    const keys = loadOAuthKeys(store);
    const { client, redirectUri } = createOAuthClient(keys);
    await runOAuthFlow(client, redirectUri);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getGoogleDriveStatus(
  store: JsonStore
): Promise<{ connected: boolean; hasClientSecret: boolean; error?: string }> {
  try {
    const hasClientSecret = !!store.getSetting("googleDriveClientSecret")?.trim();
    if (!hasClientSecret) {
      try {
        loadOAuthKeys(store);
      } catch {
        return { connected: false, hasClientSecret: false };
      }
    }

    if (!fs.existsSync(tokenPath()) && !legacyTokenCandidates().some((p) => fs.existsSync(p))) {
      return { connected: false, hasClientSecret: !!store.getSetting("googleDriveClientSecret")?.trim() };
    }

    const client = await getAuthenticatedClient(store);
    const drive = google.drive({ version: "v3", auth: client });
    await drive.about.get({ fields: "user" });
    return { connected: true, hasClientSecret: true };
  } catch (err) {
    return {
      connected: false,
      hasClientSecret: !!store.getSetting("googleDriveClientSecret")?.trim(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function findFolderId(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'");
  let query = `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  if (parentId) query += ` and '${parentId}' in parents`;

  const existing = await drive.files.list({ q: query, fields: "files(id,name)", spaces: "drive" });
  return existing.data.files?.[0]?.id || null;
}

async function getOrCreateFolder(drive: ReturnType<typeof google.drive>, name: string, parentId?: string): Promise<string> {
  const hit = await findFolderId(drive, name, parentId);
  if (hit) return hit;

  const metadata: { name: string; mimeType: string; parents?: string[] } = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) metadata.parents = [parentId];

  const created = await drive.files.create({ requestBody: metadata, fields: "id" });
  if (!created.data.id) throw new Error(`Could not create folder: ${name}`);
  return created.data.id;
}

async function deleteExistingFile(drive: ReturnType<typeof google.drive>, name: string, folderId: string): Promise<void> {
  const escaped = name.replace(/'/g, "\\'");
  const query = `name='${escaped}' and '${folderId}' in parents and trashed=false`;
  const existing = await drive.files.list({ q: query, fields: "files(id)" });
  for (const f of existing.data.files || []) {
    if (f.id) await drive.files.delete({ fileId: f.id });
  }
}

export function todayDriveDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function buildDriveFolderPath(rootName: string, dateKey: string, productFolder: string): string {
  return `${rootName} / ${dateKey} / ${productFolder}`;
}

function rootFolderName(store: JsonStore): string {
  return store.getSetting("googleDriveRootFolder", DEFAULT_ROOT_FOLDER).trim() || DEFAULT_ROOT_FOLDER;
}

export function productFolderNameFromProductName(productName: string): string {
  const trimmed = productName.trim();
  if (!trimmed) return "Voiceovers";
  const { shortName } = shortenProductName(trimmed);
  return shortName || trimmed.split("|")[0].slice(0, 48).trim() || "Voiceovers";
}

export type DailyDriveFoldersResult = {
  ok: boolean;
  alreadySetup?: boolean;
  dateFolder?: string;
  folderPath?: string;
  error?: string;
};

export type TodaysDriveFolderStatus = {
  connected: boolean;
  ready: boolean;
  dateFolder: string;
  rootName: string;
  folderPath: string;
  error?: string;
};

export async function getTodaysDriveFolderStatus(store: JsonStore): Promise<TodaysDriveFolderStatus> {
  const today = todayDriveDateKey();
  const rootName = rootFolderName(store);
  const folderPath = `${rootName} / ${today}`;

  const status = await getGoogleDriveStatus(store);
  if (!status.connected) {
    return {
      connected: false,
      ready: false,
      dateFolder: today,
      rootName,
      folderPath,
      error: status.error || "Google Drive not connected",
    };
  }

  try {
    const client = await getAuthenticatedClient(store);
    const drive = google.drive({ version: "v3", auth: client });
    const rootId = await findFolderId(drive, rootName);
    if (!rootId) {
      return { connected: true, ready: false, dateFolder: today, rootName, folderPath };
    }
    const dateId = await findFolderId(drive, today, rootId);
    return {
      connected: true,
      ready: !!dateId,
      dateFolder: today,
      rootName,
      folderPath,
    };
  } catch (err) {
    return {
      connected: true,
      ready: false,
      dateFolder: today,
      rootName,
      folderPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createTodaysDriveFolders(store: JsonStore): Promise<DailyDriveFoldersResult> {
  const status = await getGoogleDriveStatus(store);
  if (!status.connected) {
    return { ok: false, error: status.error || "Google Drive not connected — open Settings and connect first." };
  }

  const wasReady = (await getTodaysDriveFolderStatus(store)).ready;

  const client = await getAuthenticatedClient(store);
  const drive = google.drive({ version: "v3", auth: client });
  const rootName = rootFolderName(store);
  const today = todayDriveDateKey();
  const rootId = await getOrCreateFolder(drive, rootName);
  await getOrCreateFolder(drive, today, rootId);

  store.setSetting(DAILY_FOLDERS_SETTING, today);
  const folderPath = `${rootName} / ${today}`;
  store.appendLog("drive", "ok", `Today's Drive date folder ready: ${folderPath}`);

  return {
    ok: true,
    alreadySetup: wasReady,
    dateFolder: today,
    folderPath,
  };
}

export async function ensureDailyDriveFolders(store: JsonStore): Promise<DailyDriveFoldersResult> {
  const check = await getTodaysDriveFolderStatus(store);
  if (check.ready) {
    return { ok: true, alreadySetup: true, dateFolder: check.dateFolder, folderPath: check.folderPath };
  }
  return createTodaysDriveFolders(store);
}

async function resolveProductUploadFolder(
  drive: ReturnType<typeof google.drive>,
  store: JsonStore,
  productFolderName: string
): Promise<{ productFolderId: string; folderPath: string }> {
  const rootName = rootFolderName(store);
  const dateKey = todayDriveDateKey();
  const rootId = await findFolderId(drive, rootName);
  if (!rootId) {
    throw new Error(`Drive root folder not found: ${rootName}`);
  }
  const dateId = await findFolderId(drive, dateKey, rootId);
  if (!dateId) {
    throw new Error(
      `Today's Drive folder not found (${rootName} / ${dateKey}). Click "Create today's folder" on Script Writer first.`
    );
  }
  const productFolderId = await getOrCreateFolder(drive, productFolderName, dateId);
  return {
    productFolderId,
    folderPath: buildDriveFolderPath(rootName, dateKey, productFolderName),
  };
}

export async function uploadMp4ToDrive(
  store: JsonStore,
  opts: { mp4Path: string; productFolderName: string; fileName: string }
): Promise<{ driveFileId: string; folderPath: string }> {
  if (!fs.existsSync(opts.mp4Path)) throw new Error("MP4 file not found on disk.");

  const folderStatus = await getTodaysDriveFolderStatus(store);
  if (!folderStatus.connected) {
    throw new Error(folderStatus.error || "Google Drive not connected — open Settings and connect first.");
  }
  if (!folderStatus.ready) {
    throw new Error(
      `Today's Drive folder not found (${folderStatus.folderPath}). Click "Create today's folder" on Script Writer first.`
    );
  }

  const client = await getAuthenticatedClient(store);
  const drive = google.drive({ version: "v3", auth: client });

  const { productFolderId, folderPath } = await resolveProductUploadFolder(
    drive,
    store,
    opts.productFolderName
  );

  await deleteExistingFile(drive, opts.fileName, productFolderId);

  const uploaded = await drive.files.create({
    requestBody: { name: opts.fileName, parents: [productFolderId] },
    media: { mimeType: "video/mp4", body: fs.createReadStream(opts.mp4Path) },
    fields: "id",
  });

  if (!uploaded.data.id) throw new Error("Upload failed — no file ID returned.");

  return {
    driveFileId: uploaded.data.id,
    folderPath,
  };
}
