import { useEffect, useMemo, useState } from "react";
import type { HookTypeOption, Product, ScriptResult } from "../hub";

type PacingRef = { id: string; hook: string; hookType: string; replicationScore: number };

export default function ScriptWriter() {
  const [products, setProducts] = useState<Product[]>([]);
  const [hookTypes, setHookTypes] = useState<HookTypeOption[]>([]);
  const [pacingRefs, setPacingRefs] = useState<PacingRef[]>([]);
  const [hookType, setHookType] = useState("");
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [referenceLibraryId, setReferenceLibraryId] = useState("");
  const [duration, setDuration] = useState(45);
  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [result, setResult] = useState<ScriptResult | null>(null);

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
    window.hub.listHookTypes().then((types) => {
      setHookTypes(types);
      if (types[0]?.id) setHookType(types[0].id);
    });
    window.hub.listPacingReferences().then((rows) => setPacingRefs(rows as PacingRef[]));
  }, []);

  async function handleGenerate() {
    if (!productId) {
      setError("Search and select a product first.");
      return;
    }
    if (!hookType) {
      setError("Select a hook type.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setAudioPath("");
    const res = await window.hub.generateScript({
      hookType,
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
        Pick a hook type from your winning memory, search your product catalog, and generate a script + audio using
        all stored patterns — no manual inspiration needed.
      </p>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">1 · Hook type (from your memory)</div>
          <div className="hook-options">
            {hookTypes.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`hook-option ${hookType === h.id ? "selected" : ""}`}
                onClick={() => setHookType(h.id)}
              >
                <div className="hook-option-head">
                  <strong>{h.label}</strong>
                  {h.wins > 0 && <span className="hook-wins">{h.wins} wins</span>}
                </div>
                <p className="muted">{h.guide.slice(0, 100)}…</p>
              </button>
            ))}
          </div>

          <div className="card-title">2 · Product</div>
          <label className="field-label" htmlFor="product-search">
            Search products ({products.length.toLocaleString()} in catalog)
          </label>
          <input
            id="product-search"
            className="field-input"
            placeholder="Type name, brand, or price…"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
          />
          {selectedProduct && (
            <p className="product-selected">
              Selected: <strong>{selectedProduct.name}</strong>
              {selectedProduct.brand ? ` · ${selectedProduct.brand}` : ""}
              {selectedProduct.price ? ` · ${selectedProduct.price}` : ""}
            </p>
          )}
          <div className="product-picker">
            {filteredProducts.length === 0 ? (
              <p className="muted">No matches — import XLSX/JSON on Dashboard first.</p>
            ) : (
              filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`product-picker-item ${productId === p.id ? "selected" : ""}`}
                  onClick={() => {
                    setProductId(p.id);
                    setProductQuery(p.name);
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

          <div className="card-title">3 · Pacing reference</div>
          <select
            className="field-select"
            value={referenceLibraryId}
            onChange={(e) => setReferenceLibraryId(e.target.value)}
          >
            <option value="">Auto — best scored video with pacing</option>
            {pacingRefs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.replicationScore}/10 · {r.hook.slice(0, 60)}
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

          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={loading} onClick={handleGenerate}>
              {loading ? "Writing script…" : "Generate script"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>

        <div className="card">
          <div className="card-title">Memory driving this script</div>
          {!hookTypes.length ? (
            <p className="muted">Import library.json + positive_memory.json from the extension.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 10 }}>
                Claude uses <strong>all</strong> winning patterns, weighted toward{" "}
                <strong>{hookTypes.find((h) => h.id === hookType)?.label || hookType}</strong>.
              </p>
              {(hookTypes.find((h) => h.id === hookType)?.exampleHooks || []).slice(0, 6).map((hook, i) => (
                <div key={i} className="pattern-list-item">
                  "{hook}"
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
            {result.hookType} · {new Date(result.createdAt).toLocaleString()}
          </p>
          <div className="script-output">{result.script}</div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={() => copyText(result.script)}>
              Copy script
            </button>
            {result.ssml && (
              <button type="button" className="btn btn-secondary" onClick={() => copyText(result.ssml)}>
                Copy SSML
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={audioLoading} onClick={handleAudio}>
              {audioLoading ? "Generating audio…" : "Generate ElevenLabs audio"}
            </button>
            {audioPath && (
              <button type="button" className="btn btn-secondary" onClick={() => window.hub.openAudioFile(audioPath)}>
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
