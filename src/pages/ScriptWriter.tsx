import { useEffect, useMemo, useState } from "react";
import type { AgentCostBreakdown, Product, ScriptInsights, ScriptResult } from "../hub";
import AgentCostBadge from "../components/AgentCostBadge";
import AgentSessionStatus from "../components/AgentSessionStatus";

type PacingRef = {
  id: string;
  hook: string;
  hookType: string;
  views: number;
  likes: number;
  replicationScore: number;
};

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
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [result, setResult] = useState<ScriptResult | null>(null);
  const [lastCost, setLastCost] = useState<AgentCostBreakdown | null>(null);

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

  useEffect(() => {
    window.hub.listProducts().then(setProducts);
    window.hub.getScriptInsights().then(setInsights);
    window.hub.listPacingReferences().then((rows) => setPacingRefs(rows as PacingRef[]));
  }, []);

  async function handleGenerate() {
    if (!productId) {
      setError("Search and select a product first.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setLastCost(null);
    setAudioPath("");
    const res = await window.hub.generateScript({
      productId,
      durationSeconds: duration,
      referenceLibraryId: referenceLibraryId || undefined,
    });
    setLoading(false);
    if (!res.ok || !res.result) {
      setError(res.error || "Script generation failed");
      return;
    }
    setResult(res.result);
    setLastCost(res.cost || res.result.cost || null);
    if (res.result.audioPath) {
      setAudioPath(res.result.audioPath);
    }
  }

  async function handleAudio() {
    if (!result?.id) return;
    setAudioLoading(true);
    setError("");
    const res = await window.hub.generateAudio(result.id);
    setAudioLoading(false);
    if (!res.ok) {
      setError(res.error || "Audio generation failed");
      return;
    }
    setAudioPath(res.filePath || "");
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
  }

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

          <div className="btn-row" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={handleGenerate}>
              {loading ? "Agent writing…" : "Generate script"}
            </button>
            {!loading && (
              <AgentCostBadge action="generate_script" durationSeconds={duration} actualCost={lastCost} />
            )}
          </div>
          <AgentSessionStatus active={loading} tasks={["generate_script", "analyze_data"]} />
          {error && <p className="error">{error}</p>}
        </div>

        <div className="card">
          <div className="card-title">What Claude reads from your library</div>
          {!insights?.topVideos.length ? (
            <p className="muted">Import library.json from the extension to rank videos by performance.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Auto-selected approach: <strong>{insights.recommendedHookType}</strong> (highest engagement in your
                library). No manual hook picking needed.
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
        <div className="card">
          <div className="card-title">{result.title}</div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Inferred from library stats: {result.hookType} · {new Date(result.createdAt).toLocaleString()}
            {result.audioPath ? " · ElevenLabs MP3 ready" : ""}
          </p>

          <div className="card-title" style={{ fontSize: "0.95rem" }}>
            Full audio script
          </div>
          <div className="script-output">{result.script}</div>

          {result.onScreenCaption ? (
            <>
              <div className="card-title" style={{ marginTop: 16, fontSize: "0.95rem" }}>
                On-screen caption
              </div>
              <div className="script-output">{result.onScreenCaption}</div>
            </>
          ) : null}

          {result.tiktokCaption ? (
            <>
              <div className="card-title" style={{ marginTop: 16, fontSize: "0.95rem" }}>
                TikTok caption
              </div>
              <div className="script-output">{result.tiktokCaption}</div>
            </>
          ) : null}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={() => copyText(result.script)}>
              Copy script
            </button>
            {result.onScreenCaption && (
              <button type="button" className="btn btn-secondary" onClick={() => copyText(result.onScreenCaption)}>
                Copy on-screen text
              </button>
            )}
            {result.tiktokCaption && (
              <button type="button" className="btn btn-secondary" onClick={() => copyText(result.tiktokCaption)}>
                Copy TikTok caption
              </button>
            )}
            {result.ssml && (
              <button type="button" className="btn btn-secondary" onClick={() => copyText(result.ssml)}>
                Copy SSML
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={audioLoading}
              onClick={handleAudio}
            >
              {audioLoading
                ? "Generating audio…"
                : result.audioPath
                  ? "Regenerate ElevenLabs audio"
                  : "Generate ElevenLabs audio"}
            </button>
            {(audioPath || result.audioPath) && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.hub.openAudioFile(audioPath || result.audioPath!)}
              >
                Show audio file
              </button>
            )}
          </div>
          {result.ssml && (
            <>
              <div className="card-title" style={{ marginTop: 16 }}>
                ElevenLabs SSML
              </div>
              <div className="script-output">{result.ssml}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
