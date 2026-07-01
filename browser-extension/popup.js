// SJC OS Catalog Clipper — popup logic.
// 1. Load saved endpoint/token from chrome.storage.sync.
// 2. Inject a scraper into the active tab to read product name/price/image/url.
// 3. On "Clip", POST the (editable) fields to the token-authed clip endpoint.

const $ = (id) => document.getElementById(id);
let scraped = { imageUrl: "", url: "" };

/** Runs in the PAGE context (must be self-contained — no outer closure refs). */
function scrapeProduct() {
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";

  // Structured data (schema.org Product) is the most reliable source.
  let ld = {};
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      let data = JSON.parse(el.textContent);
      const arr = Array.isArray(data) ? data : data["@graph"] || [data];
      const prod = arr.find((n) => {
        const t = n && n["@type"];
        return t === "Product" || (Array.isArray(t) && t.includes("Product"));
      });
      if (prod) { ld = prod; break; }
    } catch (_) {}
  }

  const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers || {};

  const name =
    ld.name ||
    meta('meta[property="og:title"]') ||
    meta('meta[name="twitter:title"]') ||
    text("h1") ||
    document.title.split(/[|–\-]/)[0].trim();

  let price =
    (offers && (offers.price || offers.lowPrice)) ||
    meta('meta[property="product:price:amount"]') ||
    meta('meta[property="og:price:amount"]') ||
    meta('meta[itemprop="price"]') ||
    "";
  if (!price) {
    const m = document.body.innerText.match(/\$\s?\d[\d,]*(?:\.\d{2})?/);
    if (m) price = m[0].replace(/\s/g, "");
  } else if (/^\d/.test(String(price))) {
    const cur = (offers && offers.priceCurrency) === "USD" || !offers.priceCurrency ? "$" : "";
    price = cur + price;
  }

  const image =
    (typeof ld.image === "string" ? ld.image : Array.isArray(ld.image) ? ld.image[0] : ld.image?.url) ||
    meta('meta[property="og:image"]') ||
    meta('meta[name="twitter:image"]') ||
    document.querySelector("img[src]")?.src ||
    "";

  const sku = ld.sku || ld.mpn || meta('meta[itemprop="sku"]') || "";
  const supplier =
    ld.brand?.name ||
    (typeof ld.brand === "string" ? ld.brand : "") ||
    meta('meta[property="og:site_name"]') ||
    location.hostname.replace(/^www\./, "");

  return { name, price: String(price), image, sku: String(sku), supplier, url: location.href };
}

async function loadConfig() {
  const cfg = await chrome.storage.sync.get(["endpoint", "token"]);
  $("endpoint").value = cfg.endpoint || "";
  $("token").value = cfg.token || "";
  const missing = !cfg.endpoint || !cfg.token;
  $("config-warning").style.display = missing ? "block" : "none";
  if (missing) $("config").open = true;
  return cfg;
}

async function runScrape() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("page-host").textContent = tab?.url ? new URL(tab.url).hostname : "";
  if (!tab?.id) return;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeProduct });
    const d = res?.result || {};
    $("name").value = d.name || "";
    $("price").value = d.price || "";
    $("supplier").value = d.supplier || "";
    $("sku").value = d.sku || "";
    scraped.imageUrl = d.image || "";
    scraped.url = d.url || tab.url || "";
    if (scraped.imageUrl) {
      $("thumb").src = scraped.imageUrl;
      $("thumb").style.display = "block";
    }
  } catch (e) {
    setStatus("Can't read this page (try a normal product page).", "err");
  }
}

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
}

async function clip() {
  const cfg = await chrome.storage.sync.get(["endpoint", "token"]);
  if (!cfg.endpoint || !cfg.token) {
    setStatus("Set the endpoint & token in Connection settings first.", "err");
    $("config").open = true;
    return;
  }
  const name = $("name").value.trim();
  if (!name) { setStatus("Name is required.", "err"); return; }

  const body = {
    name,
    price: $("price").value.trim(),
    category: $("category").value,
    supplier: $("supplier").value.trim(),
    sku: $("sku").value.trim(),
    url: scraped.url,
    imageUrl: scraped.imageUrl,
  };

  $("clip").disabled = true;
  setStatus("Clipping…");
  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus(`Added “${data.name || name}” to the catalog${data.image ? " (with image)" : ""}.`, "ok");
    } else if (res.status === 401) {
      setStatus("Rejected — token is wrong. Regenerate it in Settings.", "err");
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(`Failed (${res.status}): ${data.error || "server error"}.`, "err");
    }
  } catch (e) {
    setStatus("Network error — check the endpoint URL.", "err");
  } finally {
    $("clip").disabled = false;
  }
}

async function saveConfig() {
  await chrome.storage.sync.set({
    endpoint: $("endpoint").value.trim(),
    token: $("token").value.trim(),
  });
  $("config-warning").style.display = "none";
  setStatus("Settings saved.", "ok");
}

$("clip").addEventListener("click", clip);
$("save-config").addEventListener("click", saveConfig);

(async () => {
  await loadConfig();
  await runScrape();
})();
