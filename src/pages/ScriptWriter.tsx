import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentCostBreakdown, Product, ScriptDetail, ScriptInsights, ScriptResult } from "../hub";
import AgentCostBadge from "../components/AgentCostBadge";
import AgentSessionStatus from "../components/AgentSessionStatus";
import ScriptContentCard from "../components/ScriptContentCard";

type PacingRef = {
  id: string;
  hook: string;
  hookType: string;
  views: number;
  likes: number;
  replicationScore: number;
};

function scriptDetailToResult(detail: ScriptDetail): ScriptResult {
  return {
    id: detail.id,
    title: detail.title,
    script: detail.script_text,
    ssml: detail.ssml,
    hookType: detail.hook_type,
    productId: detail.product_id,
    createdAt: detail.created_at,
    onScreenCaption: detail.on_screen_caption,
    tiktokCaption: detail.tiktok_caption,
    audioPath: detail.audio_path || undefined,
    sectionFeedback: detail.section_feedback,
  };
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ScriptWriter() {
  const [products, setProducts] = useState<Product[]>([]);
  const [insights, setInsights] = useState<ScriptInsights | null>(null);
  const [pacingRefs, setPacingRefs] = useState<PacingRef[]>([]);
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productSearchOpen, setProductSearchOpen] = useState(true);
  const [referenceLibraryId, setReferenceLibraryId] = useState("");
  const [duration, setDuration] = useState(45);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveNotice, setDriveNotice] = useState("");
  const [todaysDriveFolder, setTodaysDriveFolder] = useState("");
  const [todaysFolderReady, setTodaysFolderReady] = useState(false);
  const [driveFolderBusy, setDriveFolderBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [feedbackComplete, setFeedbackComplete] = useState(false);
  const [lastCost, setLastCost] = useState<AgentCostBreakdown | null>(null);
  const [bypassApiLimit, setBypassApiLimit] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const needsFeedback = !!result && !feedbackComplete;
  const duplicateBlocked = error.includes("Duplicate agent request blocked");
  const apiLimitBlocked = /direct API limit reached|Daily direct API limit reached|Daily spend cap reached/i.test(error);
  const feedbackBlocked = error.includes("Rate every script section");

  const restorePendingScript = useCallback(async () => {
    const pending = await window.hub.getPendingScriptFeedback();
    if (!pending) return false;
    setResult(scriptDetailToResult(pending));
    if (pending.product_id) {
      setProductId(pending.product_id);
      setProductSearchOpen(false);
    }
    const rated = ["audio", "on_screen_caption", "tiktok_caption", "pace"] as const;
    setFeedbackComplete(rated.every((s) => !!pending.section_feedback?.[s]?.rating));
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return true;
  }, []);

  const refreshTodaysDriveFolder = useCallback(async () => {
    const status = await window.hub.getTodaysDriveFolderStatus();
    if (!status.ok || !status.connected) {
      setTodaysFolderReady(false);
      setTodaysDriveFolder("");
      return;
    }
    setTodaysFolderReady(!!status.ready);
    setTodaysDriveFolder(status.folderPath || "");
  }, []);

  useEffect(() => {
    window.hub.listProducts().then(setProducts);
    window.hub.getScriptInsights().then(setInsights);
    window.hub.listPacingReferences().then((rows) => setPacingRefs(rows as PacingRef[]));
    window.hub.getGoogleDriveStatus().then((s) => {
      setDriveConnected(!!s.connected);
      if (s.connected) void refreshTodaysDriveFolder();
    });
    void restorePendingScript();
  }, [restorePendingScript, refreshTodaysDriveFolder]);

  async function handleCreateTodaysFolder() {
    setDriveFolderBusy(true);
    setError("");
    const res = await window.hub.createTodaysDriveFolders();
    setDriveFolderBusy(false);
    if (!res.ok) {
      setError(res.error || "Could not create today's Drive folder");
      return;
    }
    await refreshTodaysDriveFolder();
    setDriveNotice(
      res.alreadySetup
        ? `Today's folder already on Drive: ${res.folderPath}`
        : `Created today's folder: ${res.folderPath}`
    );
  }

  async function handleDismissFeedback() {
    let scriptId = result?.id;
    if (!scriptId) {
      const pending = await window.hub.getPendingScriptFeedback();
      scriptId = pending?.id;
    }
    const res = scriptId
      ? await window.hub.dismissScriptFeedback(scriptId)
      : await window.hub.dismissBlockingScriptFeedback();
    if (!res.ok) {
      setError(res.error || "Could not skip ratings");
      return;
    }
    setResult(null);
    setFeedbackComplete(true);
    setError("");
  }

  async function handleGenerate(skipDuplicateCheck = false, bypassApiLimits = bypassApiLimit) {
    if (!productId) {
      setError("Search and select a product first.");
      return;
    }
    setLoading(true);
    setError("");
    const useBypass = bypassApiLimits || bypassApiLimit;
    const res = await window.hub.generateScript({
      productId,
      durationSeconds: duration,
      referenceLibraryId: referenceLibraryId || undefined,
      additionalInfo: additionalInfo.trim() || undefined,
      skipDuplicateCheck: skipDuplicateCheck || useBypass,
      bypassApiLimits: useBypass,
      generationNonce: Date.now(),
    });
    setLoading(false);
    if (!res.ok || !res.result) {
      setError(res.error || "Script generation failed");
      if (res.error?.includes("Rate every script section")) {
        await restorePendingScript();
      }
      return;
    }
    setResult(res.result);
    setFeedbackComplete(res.validationBlocked ? true : false);
    setLastCost(res.cost || res.result.cost || null);
    setDriveNotice("");
    if (res.validationBlocked) {
      setError("");
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
  }

  const selectedProduct = products.find((p) => p.id === productId);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return products.slice(0, 80);
    return products
      .filter((p) =>
        [p.name, p.brand, p.price, p.description].filter(Boolean).join(" ").toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [products, productQuery]);

  return (
    <div>
      <h2 className="page-title">Script Writer</h2>
      <p className="page-desc">
        Search your product, then generate. Your TikTok agent reads separated library hooks, researches packaging
        (tub/bottle/can/bag), writes the full audio script + SSML, and auto-generates ElevenLabs MP3 when configured.
      </p>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">1 · Product</div>

          {selectedProduct && !productSearchOpen ? (
            <div className="product-chip">
              <div className="product-chip-body">
                <div className="product-chip-name">{selectedProduct.name}</div>
                <div className="product-chip-meta">
                  {[selectedProduct.brand, selectedProduct.price].filter(Boolean).join(" · ") || "No brand/price"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary product-chip-change"
                onClick={() => {
                  setProductSearchOpen(true);
                  setProductQuery("");
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <label className="field-label" htmlFor="product-search">
                Search products ({products.length.toLocaleString()} in catalog)
              </label>
              <input
                id="product-search"
                className="field-input"
                placeholder="Type name, brand, or price…"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                autoFocus={productSearchOpen && !productId}
              />
              <div className="product-picker">
                {filteredProducts.length === 0 ? (
                  <p className="muted product-picker-empty">No matches — import XLSX/JSON on Dashboard first.</p>
                ) : (
                  filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="product-picker-item"
                      onClick={() => {
                        setProductId(p.id);
                        setProductQuery("");
                        setProductSearchOpen(false);
                        setError("");
                      }}
                    >
                      <span className="product-picker-name">{p.name}</span>
                      <span className="product-picker-meta">
                        {[p.brand, p.price].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          <div className="card-title">2 · Pacing reference (optional)</div>
          <select
            className="field-select"
            value={referenceLibraryId}
            onChange={(e) => setReferenceLibraryId(e.target.value)}
          >
            <option value="">
              Auto — top performer with pacing
              {insights?.recommendedReferenceId ? " ✓" : ""}
            </option>
            {pacingRefs.map((r) => (
              <option key={r.id} value={r.id}>
                {formatCount(r.views)} views · {formatCount(r.likes)} likes · {r.hookType} · {r.hook.slice(0, 50)}
              </option>
            ))}
          </select>

          <label className="field-label">Target length (seconds)</label>
          <input
            type="number"
            className="field-input"
            min={15}
            max={90}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 45)}
          />

          <label className="field-label" style={{ marginTop: 14 }}>Additional information (optional)</label>
          <textarea
            className="field-textarea"
            rows={3}
            placeholder="e.g. No face on camera today. Mention the bundle deal. Avoid the word 'cheap'."
            value={additionalInfo}
            onChange={(e) => setAdditionalInfo(e.target.value)}
          />
          <p className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 16 }}>
            Anything specific to do, avoid, or focus on for this script.
          </p>

          {driveConnected && (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 12px",
                border: "1px solid #333",
                borderRadius: 8,
              }}
            >
              <div className="field-label" style={{ marginBottom: 6 }}>
                Google Drive — today
              </div>
              {todaysFolderReady ? (
                <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  ✓ Folder ready: <strong>{todaysDriveFolder}</strong>
                </p>
              ) : (
                <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Create today&apos;s date folder before sending voiceovers. Product subfolders are made on upload.
                </p>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={driveFolderBusy}
                onClick={() => void handleCreateTodaysFolder()}
              >
                {driveFolderBusy ? "Creating folders…" : "Create today's folder"}
              </button>
            </div>
          )}

          <label
            className="muted"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              marginBottom: 12,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={bypassApiLimit}
              onChange={(e) => setBypassApiLimit(e.target.checked)}
            />
            Bypass hourly API limit and duplicate protection for this generate
          </label>

          <div className="btn-row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || needsFeedback}
              onClick={() => void handleGenerate()}
              title={needsFeedback ? "Rate the current script before generating another" : undefined}
            >
              {loading ? "Agent writing…" : "Generate script"}
            </button>
            {!loading && (
              <AgentCostBadge action="generate_script" durationSeconds={duration} actualCost={lastCost} />
            )}
          </div>
          {needsFeedback && (
            <div style={{ marginTop: 8 }}>
              <p className="error">
                Rate every section below (audio, captions, pace) before generating another.
              </p>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => void handleDismissFeedback()}
              >
                Skip ratings & generate new
              </button>
            </div>
          )}
          <AgentSessionStatus active={loading} tasks={["generate_script", "analyze_data"]} />
          {error && (
            <div style={{ marginTop: 8 }}>
              <p className="error">{error}</p>
              {(duplicateBlocked || apiLimitBlocked) && (
                <div className="btn-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={loading}
                    onClick={() => void handleGenerate(true, true)}
                  >
                    Generate anyway (bypass all limits)
                  </button>
                </div>
              )}
              {feedbackBlocked && (
                <div className="btn-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                  {!result && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void restorePendingScript()}
                    >
                      Show script to rate
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleDismissFeedback()}
                  >
                    Skip ratings & generate new
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">What Claude reads from your library</div>
          {!insights?.topVideos.length ? (
            <p className="muted">Import library.json from the extension to rank videos by performance.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Each script rotates hook type and pacing reference by performance weight — not always{" "}
                <strong>{insights.recommendedHookType}</strong> (#1 in library). Recent openings and discount frames
                are avoided so you can A/B test formats.
              </p>
              {insights.hookTypeStats.slice(0, 5).map((stat) => (
                <div key={stat.hookType} className="pattern-list-item">
                  <strong>{stat.hookType}</strong> — {stat.count} videos · avg {formatCount(stat.avgViews)} views
                </div>
              ))}
              <div className="card-title" style={{ marginTop: 16 }}>
                Top performers
              </div>
              {insights.topVideos.slice(0, 6).map((video) => (
                <div key={video.libraryId} className="pattern-list-item">
                  {formatCount(video.views)} views · {formatCount(video.likes)} likes · {formatCount(video.comments)}{" "}
                  comments
                  <br />
                  <span className="muted">{video.hookType}</span>
                  {video.hookText !== "—" && <> · "{video.hookText.slice(0, 80)}"</>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {result && (
        <div className="card" ref={resultRef}>
          <div className="card-title">{result.title}</div>
          {selectedProduct && (
            <p className="muted" style={{ marginBottom: 8 }}>
              Product: <strong>{selectedProduct.name}</strong>
            </p>
          )}

          {result.validationBlocked ? (
            <>
              <div
                style={{
                  background: "rgba(254, 44, 85, 0.12)",
                  border: "1px solid #fe2c55",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginBottom: 14,
                }}
              >
                <p className="error" style={{ margin: 0, fontWeight: 600 }}>
                  Script rejected — not saved to library.
                  {result.validationLessonSaved !== false
                    ? " Saved as a lesson — the next generate will avoid this."
                    : " Regenerate to try again."}
                </p>
                <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13 }}>
                  {(result.validationViolations || []).map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
              <div className="field-label">Preview (not saved)</div>
              <div className="script-output" style={{ marginBottom: 10 }}>{result.script}</div>
              {result.onScreenCaption && (
                <>
                  <div className="field-label">On-screen caption</div>
                  <div className="script-output" style={{ marginBottom: 10 }}>{result.onScreenCaption}</div>
                </>
              )}
              {result.tiktokCaption && (
                <>
                  <div className="field-label">TikTok caption</div>
                  <div className="script-output">{result.tiktokCaption}</div>
                </>
              )}
            </>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 12 }}>
                {result.hookType} · {new Date(result.createdAt).toLocaleString()}
                {result.audioPath ? " · MP3 ready" : " · No audio yet"}
              </p>

              <ScriptContentCard
                scriptId={result.id}
                showSectionFeedback
                showDriveUpload
                driveConnected={driveConnected}
                todaysFolderReady={todaysFolderReady}
                onError={setError}
                onDriveUploaded={(msg) => {
                  setDriveNotice(msg);
                  void refreshTodaysDriveFolder();
                }}
                onFeedbackChange={setFeedbackComplete}
              />
              {!driveConnected && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Connect Google Drive in Settings to upload voiceovers to your phone.
                </p>
              )}
              {driveNotice && <p className="success" style={{ marginTop: 8 }}>{driveNotice}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
