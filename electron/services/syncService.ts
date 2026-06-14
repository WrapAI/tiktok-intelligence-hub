const WHISPER_URL = "http://localhost:5050";

export async function registerDataFolder(dataFolder: string) {
  const res = await fetch(`${WHISPER_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataFolder }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Could not register data folder with whisper-server");
  }
  return data;
}

export async function requestExtensionSync(
  type: "ALL" | "STUDIO" | "COMPASS",
  dataFolder: string,
  dateRange?: Record<string, string>
) {
  await registerDataFolder(dataFolder);
  const res = await fetch(`${WHISPER_URL}/sync-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, dataFolder, timestamp: Date.now(), dateRange }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Sync request failed — is whisper-server running?");
  }
  return data;
}

export async function checkWhisperHealth() {
  try {
    const res = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
