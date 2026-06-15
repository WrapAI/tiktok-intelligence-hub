import { useEffect, useMemo, useState } from "react";
import type { AgentCostBreakdown, DailyPlan, FunnelLimits, PlannerSummary, PlanVideo } from "../hub";
import AgentCostBadge from "../components/AgentCostBadge";
import AgentSessionStatus from "../components/AgentSessionStatus";

const FUNNEL_META = [
  { key: "bottom" as const, label: "Bottom funnel", hint: "Hard sell / orange cart" },
  { key: "middle" as const, label: "Middle funnel", hint: "Demo + trust" },
  { key: "top" as const, label: "Top funnel", hint: "Awareness / hook only" },
];

function formatMoney(n: number): string {
  if (!n) return "—";
  return n >= 1000 ? `£${(n / 1000).toFixed(1)}K` : `£${n.toFixed(0)}`;
}

export default function DailyPlanner() {
  const [summary, setSummary] = useState<PlannerSummary | null>(null);
  const [limits, setLimits] = useState<FunnelLimits>({ top: 5, middle: 5, bottom: 20 });
  const [maxPosts, setMaxPosts] = useState(30);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [expandedVideo, setExpandedVideo] = useState<string | null>(null);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [lastCost, setLastCost] = useState<AgentCostBreakdown | null>(null);

  const totalPosts = limits.top + limits.middle + limits.bottom;
  const overLimit = totalPosts > maxPosts;

  async function refresh() {
    const [s, max] = await Promise.all([
      window.hub.getPlannerSummary(),
      window.hub.getMaxDailyPosts(),
    ]);
    setSummary(s);
    setLimits(s.defaultLimits);
    setMaxPosts(max);
    if (s.topProducts.length && selectedProducts.size === 0) {
      setSelectedProducts(new Set(s.topProducts.slice(0, 8).map((p) => p.name)));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function setLimit(key: keyof FunnelLimits, value: number) {
    setLimits((prev) => ({ ...prev, [key]: Math.max(0, Math.min(maxPosts, value)) }));
  }

  function toggleProduct(name: string) {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleImportSales() {
    setImporting(true);
    setError("");
    setMessage("");
    const res = await window.hub.importSalesFile();
    setImporting(false);
    if (res.canceled) return;
    if (!res.ok) {
      setError(res.error || "Import failed");
      return;
    }
    setMessage(`Imported ${res.count} products from ${res.file}`);
    await refresh();
  }

  async function handleGenerate() {
    if (overLimit) {
      setError(`Total posts (${totalPosts}) exceeds the daily limit of ${maxPosts}.`);
      return;
    }
    if (!summary?.salesCount) {
      setError("Import your 28-day sales CSV or XLSX first.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    setLastCost(null);
    const res = await window.hub.generateDailyPlan({
      limits,
      selectedProductNames: Array.from(selectedProducts),
      additionalInfo: additionalInfo.trim() || undefined,
    });
    setLoading(false);
    if (!res.ok || !res.plan) {
      setError(res.error || "Could not generate plan");
      return;
    }
    setPlan(res.plan);
    setLastCost(res.cost || res.plan.cost || null);
    const costNote = res.cost ? ` · API cost $${res.cost.totalUsd.toFixed(2)}` : "";
    setMessage(`Plan ready — ${res.plan.totalVideos} videos to film today${costNote}.`);
  }

  const productBreakdown = useMemo(() => {
    if (!plan) return [];
    const map = new Map<string, { name: string; total: number; byFunnel: Record<string, number> }>();
    for (const v of plan.videos) {
      if (!map.has(v.productName)) {
        map.set(v.productName, { name: v.productName, total: 0, byFunnel: {} });
      }
      const row = map.get(v.productName)!;
      row.total += 1;
      row.byFunnel[v.funnelLabel] = (row.byFunnel[v.funnelLabel] || 0) + 1;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [plan]);

  const videosByFunnel = useMemo(() => {
    if (!plan) return {} as Record<string, PlanVideo[]>;
    const groups: Record<string, PlanVideo[]> = {};
    for (const v of plan.videos) {
      if (!groups[v.funnelLabel]) groups[v.funnelLabel] = [];
      groups[v.funnelLabel].push(v);
    }
    return groups;
  }, [plan]);

  return (
    <div>
      <h2 className="page-title">Daily Planner</h2>
      <p className="page-desc">
        Plan up to {maxPosts} posts per day. Import 28-day sales, set your funnel mix, and your TikTok agent builds
        the full filming plan with shot lists from library analyses.
        <span className="muted" style={{ display: "block", marginTop: 6 }}>
          Shot lists borrow hook structure and visual style from analysed videos — always for your product, never their
          products, backgrounds, or props.
        </span>
      </p>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">1 · Daily post limits</div>
          <p className="muted" style={{ marginBottom: 12 }}>
            Adjust how many videos you want per funnel. Total cannot exceed {maxPosts}.
          </p>

          {FUNNEL_META.map(({ key, label, hint }) => (
            <div key={key} className="limit-row">
              <div className="limit-label">
                <strong>{label}</strong>
                <span className="muted">{hint}</span>
              </div>
              <input
                type="number"
                className="field-input limit-input"
                min={0}
                max={maxPosts}
                value={limits[key]}
                onChange={(e) => setLimit(key, Number(e.target.value) || 0)}
              />
            </div>
          ))}

          <div className={`limit-total ${overLimit ? "over" : ""}`}>
            Total today: <strong>{totalPosts}</strong> / {maxPosts}
            {overLimit && <span className="error"> — reduce counts</span>}
          </div>

          <div className="card-title" style={{ marginTop: 20 }}>
            2 · Sales data (last 28 days)
          </div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Export from TikTok Shop / Affiliate Centre as CSV or XLSX. Needs product name + GMV or orders.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={importing} onClick={handleImportSales}>
              {importing ? "Importing…" : "Import sales CSV / XLSX"}
            </button>
          </div>
          {summary?.lastSalesFile && (
            <p className="muted" style={{ marginTop: 8 }}>
              Last import: {summary.lastSalesFile} · {summary.salesCount} products
            </p>
          )}

          {summary?.topProducts.length ? (
            <>
              <div className="card-title" style={{ marginTop: 20 }}>
                3 · Focus products (top sellers)
              </div>
              <p className="muted" style={{ marginBottom: 8 }}>
                Tick the products you want in today's plan. Higher sellers get more bottom-funnel videos.
              </p>
              <div className="product-checklist">
                {summary.topProducts.map((p) => (
                  <label key={p.fullName || p.name} className="product-check-item" title={p.fullName}>
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(p.name)}
                      onChange={() => toggleProduct(p.name)}
                    />
                    <span className="product-check-body">
                      <span className="product-check-name">
                        #{p.rank} {p.name}
                      </span>
                      <span className="product-check-meta">
                        {formatMoney(p.gmv)} GMV · {p.orders || p.units || 0} orders
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <label className="field-label">Additional information (optional)</label>
            <textarea
              className="field-input"
              rows={3}
              placeholder="e.g. 2 hours to film. No tripod. Product-only angles only."
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              style={{ resize: "vertical", fontFamily: "inherit", width: "100%", boxSizing: "border-box", display: "block" }}
            />
            <p className="muted" style={{ fontSize: 11, marginTop: 4, marginBottom: 16 }}>
              Any constraints or specifics for today's plan.
            </p>
          </div>

          <div className="btn-row" style={{ marginTop: 0, alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || overLimit || !summary?.salesCount}
              onClick={handleGenerate}
            >
              {loading ? "Agent planning…" : "Generate today's filming plan"}
            </button>
            {!loading && (
              <AgentCostBadge action="generate_daily_plan" totalVideos={totalPosts} actualCost={lastCost} />
            )}
          </div>
          <AgentSessionStatus active={loading} tasks={["generate_daily_plan"]} />
          {message && <p className="success">{message}</p>}
          {error && <p className="error">{error}</p>}
        </div>

        <div className="card">
          <div className="card-title">Library knowledge used</div>
          {summary ? (
            <>
              <p className="muted" style={{ marginBottom: 12 }}>
                Shot lists are based on Grok analyses from your extension library, filtered by funnel type.
              </p>
              <div className="stat-grid-mini">
                <div className="stat-mini">
                  <div className="stat-mini-label">Top funnel refs</div>
                  <div className="stat-mini-value">{summary.funnelLibraryCounts.top}</div>
                </div>
                <div className="stat-mini">
                  <div className="stat-mini-label">Middle funnel refs</div>
                  <div className="stat-mini-value">{summary.funnelLibraryCounts.middle}</div>
                </div>
                <div className="stat-mini">
                  <div className="stat-mini-label">Bottom funnel refs</div>
                  <div className="stat-mini-value">{summary.funnelLibraryCounts.bottom}</div>
                </div>
              </div>
              {summary.funnelLibraryCounts.bottom + summary.funnelLibraryCounts.middle + summary.funnelLibraryCounts.top === 0 && (
                <p className="error" style={{ marginTop: 12 }}>
                  Import library.json from the extension so the planner knows what clips work.
                </p>
              )}
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>
      </div>

      {plan && (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">Today's filming schedule — {plan.totalVideos} videos</div>
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Videos today</th>
                  <th>Mix</th>
                </tr>
              </thead>
              <tbody>
                {productBreakdown.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>
                      <strong>{row.total}</strong>
                    </td>
                    <td className="muted">
                      {Object.entries(row.byFunnel)
                        .map(([f, n]) => `${n}× ${f}`)
                        .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {Object.entries(videosByFunnel).map(([funnelLabel, videos]) => (
            <div key={funnelLabel} className="card" style={{ marginTop: 16 }}>
              <div className="card-title">
                {funnelLabel} — {videos.length} video{videos.length !== 1 ? "s" : ""}
              </div>
              {videos.map((video) => (
                <div key={video.id} className="plan-video">
                  <button
                    type="button"
                    className="plan-video-head"
                    onClick={() => setExpandedVideo(expandedVideo === video.id ? null : video.id)}
                  >
                    <div>
                      <strong>{video.title}</strong>
                      <p className="muted">{video.summary}</p>
                    </div>
                    <span className="plan-video-toggle">{expandedVideo === video.id ? "▲" : "▼"}</span>
                  </button>
                  {expandedVideo === video.id && (
                    <div className="clip-list">
                      <div className="plan-meta-grid" style={{ marginBottom: 14 }}>
                        <p>
                          <strong>Product:</strong> {video.productName}
                          {video.productBrand ? ` (${video.productBrand})` : ""}
                        </p>
                        <p>
                          <strong>Funnel category:</strong> {video.funnelCategory || video.funnelLabel}
                        </p>
                        <p className="muted">
                          Video {video.videoIndex} of {video.videoCountForProduct} for this product · Hook style:{" "}
                          {video.hookType}
                        </p>
                      </div>

                      <div className="plan-script-block">
                        <div className="card-title" style={{ fontSize: "0.95rem" }}>
                          Full audio script
                        </div>
                        <div className="script-output">{video.fullAudioScript}</div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ marginTop: 8 }}
                          onClick={() => navigator.clipboard.writeText(video.fullAudioScript)}
                        >
                          Copy audio script
                        </button>
                      </div>

                      {video.onScreenCaption ? (
                        <div className="plan-script-block" style={{ marginTop: 12 }}>
                          <div className="card-title" style={{ fontSize: "0.95rem" }}>
                            On-screen caption
                          </div>
                          <div className="script-output">{video.onScreenCaption}</div>
                        </div>
                      ) : null}

                      {video.tiktokCaption ? (
                        <div className="plan-script-block" style={{ marginTop: 12 }}>
                          <div className="card-title" style={{ fontSize: "0.95rem" }}>
                            TikTok caption
                          </div>
                          <div className="script-output">{video.tiktokCaption}</div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ marginTop: 8 }}
                            onClick={() => navigator.clipboard.writeText(video.tiktokCaption)}
                          >
                            Copy TikTok caption
                          </button>
                        </div>
                      ) : null}

                      <div className="card-title" style={{ marginTop: 16, fontSize: "0.95rem" }}>
                        Filming clips
                      </div>
                      {video.clips.map((clip) => (
                        <div key={clip.step} className="clip-card">
                          <div className="clip-step">
                            Clip {clip.step} · {clip.duration}
                          </div>
                          <p>
                            <strong>Film:</strong> {clip.whatToFilm}
                          </p>
                          <p>
                            <strong>Say:</strong> {clip.whatToSay}
                          </p>
                          {clip.onScreenText && (
                            <p>
                              <strong>On-screen text:</strong> {clip.onScreenText}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
