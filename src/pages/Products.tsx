import { useCallback, useEffect, useMemo, useState } from "react";
import type { Product, ProductResearchStatus } from "../hub";

function parseContainerNouns(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function researchStatusFor(product: Product): ProductResearchStatus | "done" {
  if (product.research_completed_at) return "done";
  return product.research_status || "pending";
}

function ResearchBadge({ product }: { product: Product }) {
  const status = researchStatusFor(product);
  const nouns = parseContainerNouns(product.container_nouns);

  if (status === "researching") {
    return (
      <span className="research-pill researching" title="Agent is researching packaging and container language">
        Researching…
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="research-pill pending" title="Queued for one-time packaging research">
        Queued
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="research-pill error" title={product.research_error || "Research failed"}>
        Research failed
      </span>
    );
  }

  const label = product.packaging_type
    ? `Researched · ${product.packaging_type}${nouns.length ? ` (${nouns.join(", ")})` : ""}`
    : "Researched";

  return (
    <span className="research-pill complete" title={product.research_notes || label}>
      {label}
    </span>
  );
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.brand, p.price, p.description, p.packaging_type, p.research_notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [products, query]);

  const activeResearch = useMemo(
    () =>
      products.filter((p) => {
        const status = researchStatusFor(p);
        return status === "researching" || status === "pending";
      }),
    [products]
  );

  const refresh = useCallback(async () => {
    setProducts(await window.hub.listProducts());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeResearch.length) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeResearch.length, refresh]);

  async function importFiles() {
    setMessage("");
    const res = await window.hub.importFiles();
    if (res.canceled) return;
    if (res.message) setMessage(res.message);
    else if (res.error) setMessage(res.error);
    else if (res.errors?.length) {
      setMessage(res.errors.map((e) => `${e.file}: ${e.error}`).join(" · "));
    } else {
      setMessage(res.ok ? "Import complete" : "Import failed");
    }
    await refresh();
  }

  async function refreshFromLibrary() {
    const res = await window.hub.refreshProductsFromLibrary();
    await refresh();
    setMessage(`Extracted ${res.count} products from library analyses.`);
  }

  async function handleRetry(productId: string) {
    await window.hub.retryProductResearch(productId);
    await refresh();
  }

  return (
    <div>
      <h2 className="page-title">My Products</h2>
      <p className="page-desc">
        Products are imported automatically from extension JSON, TikTok Shop/Affiliate <strong>XLSX</strong>{" "}
        exports, or <code>products.json</code> / <code>library.json</code>. New products get one-time packaging
        research (tub, bottle, can, bag) for script writing.
      </p>

      {activeResearch.length > 0 && (
        <div className="card research-banner">
          <div className="research-banner-body">
            <span className="research-spinner" aria-hidden />
            <div>
              <strong>
                Researching packaging for {activeResearch.length} product
                {activeResearch.length !== 1 ? "s" : ""}…
              </strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                The agent is learning container language (tub, bottle, can, bag) so scripts sound natural on camera.
                This runs once per product.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={importFiles}>
            Import files…
          </button>
          <button type="button" className="btn btn-secondary" onClick={refreshFromLibrary}>
            Re-extract from library
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => window.hub.openDataFolder()}>
            Open data folder
          </button>
        </div>
        {message && <p className="success">{message}</p>}
      </div>

      <div className="card">
        <div className="card-title">Catalog ({products.length})</div>
        {products.length > 0 && (
          <input
            className="field-input"
            placeholder="Search products…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ marginBottom: 12 }}
          />
        )}
        {products.length === 0 ? (
          <p className="muted">
            No products yet. Export from the extension (Library analyses include shop products) or sync Compass when
            product scraping is available.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Brand</th>
                <th>Price</th>
                <th>Packaging research</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const status = researchStatusFor(p);
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.brand || "—"}</td>
                    <td>{p.price || "—"}</td>
                    <td>
                      <div className="research-cell">
                        <ResearchBadge product={p} />
                        {status === "error" && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleRetry(p.id)}
                          >
                            Retry
                          </button>
                        )}
                      </div>
                      {p.research_notes && status === "done" && (
                        <p className="muted research-notes">{p.research_notes}</p>
                      )}
                    </td>
                    <td>{p.source || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
