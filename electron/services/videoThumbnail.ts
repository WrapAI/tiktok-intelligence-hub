const WHISPER_URL = "http://localhost:5050";

export async function fetchVideoThumbnail(url: string): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed.includes("tiktok.com")) return null;

  try {
    const res = await fetch(`${WHISPER_URL}/video-thumbnail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      thumbnail_data_url?: string;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.thumbnail_data_url?.trim()) {
      console.warn("[thumbnail]", data.error || `HTTP ${res.status}`);
      return null;
    }
    return data.thumbnail_data_url.trim();
  } catch (err) {
    console.warn("[thumbnail]", err instanceof Error ? err.message : String(err));
    return null;
  }
}
