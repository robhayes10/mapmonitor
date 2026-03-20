import { useState, useRef, useCallback, useEffect } from "react";

function parseCSV(text) {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj = {};
    headers.forEach((h, i) => (obj[h] = values[i] || ""));
    return obj;
  });
}

export default function App() {
  const [authToken, setAuthToken] = useState(() => {
    try { return sessionStorage.getItem("map_token") || ""; } catch { return ""; }
  });
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [products, setProducts] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [results, setResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, label: "" });
  const [activeTab, setActiveTab] = useState("setup");
  const [manualProduct, setManualProduct] = useState({ upc: "", name: "", map: "" });
  const [manualRetailer, setManualRetailer] = useState({ name: "", domain: "" });
  const [filterStatus, setFilterStatus] = useState("all");
  const [slackStatus, setSlackStatus] = useState(""); // "", "sending", "sent", "skipped", "error"
  const abortRef = useRef(false);

  const handleLogin = async () => {
    if (!loginPassword) return;
    setLoginLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || "Invalid password");
        setLoginLoading(false);
        return;
      }
      setAuthToken(data.token);
      try { sessionStorage.setItem("map_token", data.token); } catch {}
      setLoginPassword("");
    } catch (err) {
      setLoginError("Connection error. Try again.");
    }
    setLoginLoading(false);
  };

  const handleLogout = () => {
    setAuthToken("");
    try { sessionStorage.removeItem("map_token"); } catch {}
  };

  const handleLoginKeyDown = (e) => { if (e.key === "Enter") handleLogin(); };

  const loadSampleData = () => {
    setProducts([
      { upc: "012345678901", name: "Premium Wireless Headphones X500", map: "149.99" },
      { upc: "012345678902", name: "Bluetooth Speaker ProMax 200", map: "89.99" },
      { upc: "012345678903", name: "Noise Cancelling Earbuds Z3", map: "79.99" },
    ]);
    setRetailers([
      { name: "Amazon", domain: "amazon.com" },
      { name: "Best Buy", domain: "bestbuy.com" },
      { name: "Walmart", domain: "walmart.com" },
    ]);
  };

  const addManualProduct = () => {
    if (manualProduct.name && manualProduct.map) {
      setProducts((p) => [...p, { ...manualProduct }]);
      setManualProduct({ upc: "", name: "", map: "" });
    }
  };

  const addManualRetailer = () => {
    if (manualRetailer.domain) {
      setRetailers((r) => [
        ...r,
        { ...manualRetailer, name: manualRetailer.name || manualRetailer.domain },
      ]);
      setManualRetailer({ name: "", domain: "" });
    }
  };

  const removeProduct = (i) => setProducts((p) => p.filter((_, idx) => idx !== i));
  const removeRetailer = (i) => setRetailers((r) => r.filter((_, idx) => idx !== i));

  const handleProductCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      const mapped = parsed.map((r) => ({
        upc: r.upc || r.barcode || r.ean || "",
        name: r.name || r.product || r["product name"] || "",
        map: r.map || r.price || r["map price"] || "",
      }));
      setProducts((p) => [...p, ...mapped.filter((m) => m.name && m.map)]);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleRetailerCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result);
      const mapped = parsed.map((r) => ({
        name: r.name || r.retailer || r.domain || "",
        domain: r.domain || r.url || r.website || "",
      }));
      setRetailers((ret) => [...ret, ...mapped.filter((m) => m.domain)]);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleProductKeyDown = (e) => { if (e.key === "Enter") addManualProduct(); };
  const handleRetailerKeyDown = (e) => { if (e.key === "Enter") addManualRetailer(); };

  const scanForPricing = useCallback(async () => {
    if (!products.length || !retailers.length) return;
    setScanning(true);
    setActiveTab("results");
    setResults([]);
    setFilterStatus("all");
    abortRef.current = false;

    const totalScans = products.length * retailers.length;
    let current = 0;
    const allResults = [];

    for (const product of products) {
      for (const retailer of retailers) {
        if (abortRef.current) break;
        current++;
        setScanProgress({
          current,
          total: totalScans,
          label: `${product.name} → ${retailer.name}`,
        });

        try {
          const response = await fetch("/api/scan", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${authToken}`,
            },
            body: JSON.stringify({ product, retailer }),
          });

          const parsed = await response.json();

          if (response.status === 401) {
            setAuthToken("");
            try { sessionStorage.removeItem("map_token"); } catch {}
            throw new Error("Session expired. Please log in again.");
          }

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          const mapPrice = parseFloat(product.map);
          const foundPrice = parsed.price ? parseFloat(parsed.price) : null;
          let status = "not_found";
          if (parsed.found && foundPrice !== null) {
            status = foundPrice < mapPrice ? "violation" : foundPrice === mapPrice ? "compliant" : "above_map";
          }

          allResults.push({
            product,
            retailer,
            ...parsed,
            status,
            mapPrice,
            foundPrice,
            difference: foundPrice !== null ? foundPrice - mapPrice : null,
          });
          setResults([...allResults]);
        } catch (err) {
          allResults.push({
            product,
            retailer,
            found: false,
            price: null,
            status: "error",
            notes: err.message,
            mapPrice: parseFloat(product.map),
            foundPrice: null,
            difference: null,
          });
          setResults([...allResults]);
        }
      }
      if (abortRef.current) break;
    }

    // Send Slack alert if there are violations
    const finalViolations = allResults.filter((r) => r.status === "violation");
    if (finalViolations.length > 0 && !abortRef.current) {
      setSlackStatus("sending");
      try {
        const notifyRes = await fetch("/api/notify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            violations: finalViolations,
            summary: {
              total: allResults.length,
              violations: finalViolations.length,
              compliant: allResults.filter((r) => r.status === "compliant" || r.status === "above_map").length,
              notFound: allResults.filter((r) => r.status === "not_found" || r.status === "error").length,
            },
          }),
        });
        const notifyData = await notifyRes.json();
        if (notifyData.skipped) {
          setSlackStatus("skipped");
        } else if (notifyData.sent) {
          setSlackStatus("sent");
        } else {
          setSlackStatus("error");
        }
      } catch {
        setSlackStatus("error");
      }
    } else {
      setSlackStatus("");
    }

    setScanning(false);
  }, [products, retailers, authToken]);

  const stopScan = () => { abortRef.current = true; };

  const exportCSV = () => {
    const headers = ["Product", "UPC", "MAP Price", "Retailer", "Found Price", "Difference", "Status", "URL", "Notes"];
    const rows = results.map((r) => [
      r.product.name,
      r.product.upc,
      r.mapPrice,
      r.retailer.name,
      r.foundPrice ?? "",
      r.difference !== null ? r.difference.toFixed(2) : "",
      r.status,
      r.product_url || "",
      r.notes || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-violations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const violations = results.filter((r) => r.status === "violation");
  const compliant = results.filter((r) => r.status === "compliant" || r.status === "above_map");
  const notFound = results.filter((r) => r.status === "not_found" || r.status === "error");

  const filteredResults = filterStatus === "all"
    ? results
    : filterStatus === "violations"
    ? violations
    : filterStatus === "compliant"
    ? compliant
    : notFound;

  return (
    <>
      <style>{`
        :root {
          --bg: #0C0E12;
          --surface: #14171E;
          --surface2: #1A1E28;
          --border: #252A36;
          --border-light: #2E3444;
          --text: #E4E7EE;
          --text-dim: #8891A5;
          --text-faint: #565E72;
          --accent: #4F8EFF;
          --accent-dim: rgba(79, 142, 255, 0.12);
          --red: #FF5C5C;
          --red-dim: rgba(255, 92, 92, 0.12);
          --green: #34D399;
          --green-dim: rgba(52, 211, 153, 0.12);
          --yellow: #FBBF24;
          --yellow-dim: rgba(251, 191, 36, 0.12);
          --font: 'DM Sans', sans-serif;
          --mono: 'JetBrains Mono', monospace;
        }
        .app { font-family: var(--font); background: var(--bg); color: var(--text); min-height: 100vh; padding: 24px; max-width: 1100px; margin: 0 auto; }
        .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
        .logo { width: 44px; height: 44px; background: linear-gradient(135deg, var(--accent), #7C5CFF); border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: white; flex-shrink: 0; }
        .header h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.3px; }
        .header p { color: var(--text-dim); font-size: 13px; margin-top: 2px; }
        .tabs { display: flex; gap: 2px; background: var(--surface); border-radius: 10px; padding: 3px; margin-bottom: 24px; width: fit-content; }
        .tab { padding: 8px 20px; border-radius: 8px; border: none; background: none; color: var(--text-dim); font-family: var(--font); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; }
        .tab:hover { color: var(--text); }
        .tab.active { background: var(--accent); color: white; }
        .tab .badge { display: inline-flex; align-items: center; justify-content: center; background: var(--red); color: white; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; margin-left: 6px; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-bottom: 16px; }
        .card-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
        .card-desc { font-size: 12px; color: var(--text-dim); margin-bottom: 16px; }
        .input-row { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        input[type="text"], input[type="number"] { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-family: var(--font); font-size: 13px; outline: none; transition: border-color 0.15s; flex: 1; min-width: 100px; }
        input:focus { border-color: var(--accent); }
        input::placeholder { color: var(--text-faint); }
        .btn { padding: 9px 16px; border-radius: 8px; border: none; font-family: var(--font); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover { background: #3D7AED; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-secondary { background: var(--surface2); color: var(--text-dim); border: 1px solid var(--border); }
        .btn-secondary:hover { color: var(--text); border-color: var(--border-light); }
        .btn-danger { background: var(--red-dim); color: var(--red); }
        .btn-danger:hover { background: rgba(255,92,92,0.2); }
        .btn-sm { padding: 5px 10px; font-size: 12px; }
        .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .tag { display: inline-flex; align-items: center; gap: 6px; background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 6px 10px; font-size: 12px; color: var(--text-dim); }
        .tag .name { color: var(--text); font-weight: 500; }
        .tag .remove { cursor: pointer; color: var(--text-faint); font-size: 14px; line-height: 1; }
        .tag .remove:hover { color: var(--red); }
        .tag .map-val { font-family: var(--mono); font-size: 11px; color: var(--accent); }
        .scan-btn-area { display: flex; gap: 12px; align-items: center; margin-top: 20px; flex-wrap: wrap; }
        .progress-bar-wrap { width: 100%; background: var(--surface); border-radius: 8px; overflow: hidden; margin-bottom: 8px; border: 1px solid var(--border); }
        .progress-bar { height: 6px; background: linear-gradient(90deg, var(--accent), #7C5CFF); transition: width 0.3s ease; border-radius: 8px; }
        .progress-label { font-size: 12px; color: var(--text-dim); margin-bottom: 16px; font-family: var(--mono); }
        .stats-row { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat-card { flex: 1; min-width: 120px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.15s; }
        .stat-card:hover { border-color: var(--border-light); }
        .stat-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .stat-card .label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
        .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
        .stat-card.violations .value { color: var(--red); }
        .stat-card.compliant .value { color: var(--green); }
        .stat-card.notfound .value { color: var(--text-faint); }
        .results-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .results-table th { text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-dim); border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); }
        .results-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
        .results-table tr:last-child td { border-bottom: none; }
        .results-table tr:hover td { background: rgba(79, 142, 255, 0.03); }
        .status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
        .status-badge.violation { background: var(--red-dim); color: var(--red); }
        .status-badge.compliant, .status-badge.above_map { background: var(--green-dim); color: var(--green); }
        .status-badge.not_found, .status-badge.error { background: var(--yellow-dim); color: var(--yellow); }
        .price { font-family: var(--mono); font-size: 13px; }
        .price.violation { color: var(--red); font-weight: 600; }
        .price.ok { color: var(--green); }
        .diff { font-family: var(--mono); font-size: 12px; }
        .diff.neg { color: var(--red); }
        .diff.pos { color: var(--green); }
        .link { color: var(--accent); text-decoration: none; font-size: 12px; }
        .link:hover { text-decoration: underline; }
        .notes-text { font-size: 11px; color: var(--text-dim); max-width: 200px; }
        .empty-state { text-align: center; padding: 48px 24px; color: var(--text-dim); }
        .empty-state .icon { font-size: 40px; margin-bottom: 12px; opacity: 0.5; }
        .file-upload-label { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); color: var(--text-dim); font-family: var(--font); font-size: 13px; cursor: pointer; transition: all 0.15s; }
        .file-upload-label:hover { border-color: var(--border-light); color: var(--text); }
        .section-divider { display: flex; align-items: center; gap: 12px; margin: 12px 0; font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 1px; }
        .section-divider::before, .section-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
        .overflow-x { overflow-x: auto; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .scanning-pulse { animation: pulse 1.5s infinite; }
        .sample-banner { display: flex; align-items: center; justify-content: space-between; background: var(--accent-dim); border: 1px solid rgba(79, 142, 255, 0.2); border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: var(--accent); flex-wrap: wrap; gap: 8px; }
        .slack-status { font-size: 12px; margin-left: 4px; }
        .slack-status.sent { color: var(--green); }
        .slack-status.skipped { color: var(--text-faint); }
        .slack-status.error { color: var(--red); }
        @media (max-width: 640px) {
          .app { padding: 16px; }
          .stats-row { gap: 8px; }
          .stat-card { min-width: 70px; padding: 12px; }
          .stat-card .value { font-size: 22px; }
          .input-row { flex-direction: column; }
          input[type="text"] { min-width: unset; }
          .login-box { margin: 16px; padding: 32px 24px; }
        }
        .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); font-family: var(--font); }
        .login-box { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 40px; width: 100%; max-width: 380px; }
        .login-box .logo { margin: 0 auto 20px; }
        .login-box h2 { color: var(--text); font-size: 18px; font-weight: 600; text-align: center; margin-bottom: 4px; }
        .login-box .subtitle { color: var(--text-dim); font-size: 13px; text-align: center; margin-bottom: 24px; }
        .login-box input { width: 100%; margin-bottom: 12px; }
        .login-box .btn { width: 100%; }
        .login-error { color: var(--red); font-size: 12px; margin-bottom: 12px; text-align: center; }
        .logout-btn { margin-left: auto; padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border); background: none; color: var(--text-dim); font-family: var(--font); font-size: 12px; cursor: pointer; transition: all 0.15s; }
        .logout-btn:hover { border-color: var(--red); color: var(--red); }
      `}</style>

      {!authToken ? (
        <div className="login-wrap">
          <div className="login-box">
            <div className="logo" style={{ width: 48, height: 48, fontSize: 22 }}>M</div>
            <h2>MAP Policy Monitor</h2>
            <div className="subtitle">Enter your team password to continue</div>
            {loginError && <div className="login-error">{loginError}</div>}
            <input
              type="password"
              placeholder="Password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              onKeyDown={handleLoginKeyDown}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleLogin} disabled={loginLoading || !loginPassword}>
              {loginLoading ? "Verifying..." : "Sign In"}
            </button>
          </div>
        </div>
      ) : (

      <div className="app">
        <div className="header">
          <div className="logo">M</div>
          <div>
            <h1>MAP Policy Monitor</h1>
            <p>Scan retailer sites for pricing compliance violations</p>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Sign Out</button>
        </div>

        <div className="tabs">
          <button className={`tab ${activeTab === "setup" ? "active" : ""}`} onClick={() => setActiveTab("setup")}>
            Setup
          </button>
          <button className={`tab ${activeTab === "results" ? "active" : ""}`} onClick={() => setActiveTab("results")}>
            Results
            {violations.length > 0 && <span className="badge">{violations.length}</span>}
          </button>
        </div>

        {activeTab === "setup" && (
          <>
            {products.length === 0 && retailers.length === 0 && (
              <div className="sample-banner">
                <span>New here? Load sample data to see how it works</span>
                <button className="btn btn-primary btn-sm" onClick={loadSampleData}>Load Sample Data</button>
              </div>
            )}

            <div className="card">
              <div className="card-title">Products</div>
              <div className="card-desc">Add your products with UPC (optional), name, and MAP price</div>
              <div className="input-row">
                <input type="text" placeholder="UPC (optional)" value={manualProduct.upc} onChange={(e) => setManualProduct((p) => ({ ...p, upc: e.target.value }))} onKeyDown={handleProductKeyDown} style={{ maxWidth: 150 }} />
                <input type="text" placeholder="Product name" value={manualProduct.name} onChange={(e) => setManualProduct((p) => ({ ...p, name: e.target.value }))} onKeyDown={handleProductKeyDown} />
                <input type="text" placeholder="MAP price" value={manualProduct.map} onChange={(e) => setManualProduct((p) => ({ ...p, map: e.target.value }))} onKeyDown={handleProductKeyDown} style={{ maxWidth: 120 }} />
                <button className="btn btn-primary" onClick={addManualProduct}>Add</button>
              </div>
              <div className="section-divider">or upload CSV</div>
              <label className="file-upload-label">
                Upload CSV (columns: upc, name, map)
                <input type="file" accept=".csv" onChange={handleProductCSV} hidden />
              </label>
              {products.length > 0 && (
                <div className="tag-list">
                  {products.map((p, i) => (
                    <div className="tag" key={i}>
                      <span className="name">{p.name}</span>
                      {p.upc && <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{p.upc}</span>}
                      <span className="map-val">${p.map}</span>
                      <span className="remove" onClick={() => removeProduct(i)}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Retailers</div>
              <div className="card-desc">Add retailer names and domains to scan</div>
              <div className="input-row">
                <input type="text" placeholder="Retailer name" value={manualRetailer.name} onChange={(e) => setManualRetailer((r) => ({ ...r, name: e.target.value }))} onKeyDown={handleRetailerKeyDown} />
                <input type="text" placeholder="domain.com" value={manualRetailer.domain} onChange={(e) => setManualRetailer((r) => ({ ...r, domain: e.target.value }))} onKeyDown={handleRetailerKeyDown} />
                <button className="btn btn-primary" onClick={addManualRetailer}>Add</button>
              </div>
              <div className="section-divider">or upload CSV</div>
              <label className="file-upload-label">
                Upload CSV (columns: name, domain)
                <input type="file" accept=".csv" onChange={handleRetailerCSV} hidden />
              </label>
              {retailers.length > 0 && (
                <div className="tag-list">
                  {retailers.map((r, i) => (
                    <div className="tag" key={i}>
                      <span className="name">{r.name}</span>
                      <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{r.domain}</span>
                      <span className="remove" onClick={() => removeRetailer(i)}>×</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="scan-btn-area">
              <button className="btn btn-primary" disabled={!products.length || !retailers.length || scanning} onClick={scanForPricing} style={{ padding: "12px 28px", fontSize: 14 }}>
                {scanning ? "Scanning..." : `Scan ${products.length * retailers.length} combinations`}
              </button>
              {products.length > 0 && retailers.length > 0 && (
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  {products.length} products × {retailers.length} retailers
                </span>
              )}
            </div>
          </>
        )}

        {activeTab === "results" && (
          <>
            {scanning && (
              <div style={{ marginBottom: 20 }}>
                <div className="progress-bar-wrap">
                  <div className="progress-bar" style={{ width: `${(scanProgress.current / scanProgress.total) * 100}%` }} />
                </div>
                <div className="progress-label scanning-pulse">
                  [{scanProgress.current}/{scanProgress.total}] {scanProgress.label}
                </div>
                <button className="btn btn-danger btn-sm" onClick={stopScan}>Stop Scan</button>
              </div>
            )}

            {results.length > 0 && (
              <>
                <div className="stats-row">
                  <div className={`stat-card violations ${filterStatus === "violations" ? "selected" : ""}`} onClick={() => setFilterStatus(filterStatus === "violations" ? "all" : "violations")}>
                    <div className="label">Violations</div>
                    <div className="value">{violations.length}</div>
                  </div>
                  <div className={`stat-card compliant ${filterStatus === "compliant" ? "selected" : ""}`} onClick={() => setFilterStatus(filterStatus === "compliant" ? "all" : "compliant")}>
                    <div className="label">Compliant</div>
                    <div className="value">{compliant.length}</div>
                  </div>
                  <div className={`stat-card notfound ${filterStatus === "notfound" ? "selected" : ""}`} onClick={() => setFilterStatus(filterStatus === "notfound" ? "all" : "notfound")}>
                    <div className="label">Not Found</div>
                    <div className="value">{notFound.length}</div>
                  </div>
                  <div className={`stat-card ${filterStatus === "all" ? "selected" : ""}`} onClick={() => setFilterStatus("all")}>
                    <div className="label">Total</div>
                    <div className="value" style={{ color: "var(--text)" }}>{results.length}</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-secondary btn-sm" onClick={exportCSV}>Export CSV</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab("setup")}>← Back to Setup</button>
                  {slackStatus === "sending" && (
                    <span className="slack-status scanning-pulse">Sending Slack alert...</span>
                  )}
                  {slackStatus === "sent" && (
                    <span className="slack-status sent">✓ Slack alert sent</span>
                  )}
                  {slackStatus === "skipped" && (
                    <span className="slack-status skipped">Slack not configured — add SLACK_WEBHOOK_URL to enable</span>
                  )}
                  {slackStatus === "error" && (
                    <span className="slack-status error">Slack alert failed</span>
                  )}
                </div>

                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="overflow-x">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Product</th>
                          <th>Retailer</th>
                          <th>MAP</th>
                          <th>Found Price</th>
                          <th>Diff</th>
                          <th>Link</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...filteredResults]
                          .sort((a, b) => {
                            const order = { violation: 0, compliant: 1, above_map: 2, not_found: 3, error: 4 };
                            return (order[a.status] ?? 5) - (order[b.status] ?? 5);
                          })
                          .map((r, i) => (
                            <tr key={i}>
                              <td>
                                <span className={`status-badge ${r.status}`}>
                                  {r.status === "violation" ? "Violation" : r.status === "compliant" ? "Compliant" : r.status === "above_map" ? "Above MAP" : r.status === "error" ? "Error" : "Not Found"}
                                </span>
                              </td>
                              <td>
                                <div style={{ fontWeight: 500, fontSize: 13 }}>{r.product.name}</div>
                                {r.product.upc && <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>{r.product.upc}</div>}
                              </td>
                              <td style={{ fontWeight: 500 }}>{r.retailer.name}</td>
                              <td className="price">${r.mapPrice.toFixed(2)}</td>
                              <td>
                                {r.foundPrice !== null ? (
                                  <span className={`price ${r.status === "violation" ? "violation" : "ok"}`}>${r.foundPrice.toFixed(2)}</span>
                                ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                              </td>
                              <td>
                                {r.difference !== null ? (
                                  <span className={`diff ${r.difference < 0 ? "neg" : "pos"}`}>
                                    {r.difference < 0 ? "-" : "+"}${Math.abs(r.difference).toFixed(2)}
                                  </span>
                                ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                              </td>
                              <td>
                                {r.product_url ? (
                                  <a href={r.product_url} target="_blank" rel="noopener noreferrer" className="link">View →</a>
                                ) : <span style={{ color: "var(--text-faint)" }}>—</span>}
                              </td>
                              <td className="notes-text">{r.notes || "—"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {!scanning && results.length === 0 && (
              <div className="empty-state">
                <div className="icon">📡</div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>No scan results yet</div>
                <div style={{ fontSize: 13 }}>Add products and retailers in Setup, then run a scan</div>
              </div>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}
