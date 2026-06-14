import { useEffect, useMemo, useState } from "react";
import type { Product } from "../hub";

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.name, p.brand, p.price, p.description].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }, [products, query]);

  async function refresh() {
    setProducts(await window.hub.listProducts());
  }

  useEffect(() => {
    refresh();
  }, []);

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

  return (
    <div>
      <h2 className="page-title">My Products</h2>
      <p className="page-desc">
        Products are imported automatically from extension JSON, TikTok Shop/Affiliate <strong>XLSX</strong>{" "}
        exports, or <code>products.json</code> / <code>library.json</code>.
      </p>

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
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.brand || "—"}</td>
                  <td>{p.price || "—"}</td>
                  <td>{(p as Product & { source?: string }).source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
