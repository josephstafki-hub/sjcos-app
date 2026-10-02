import "server-only";

// Live price fetcher: wraps lib/product-fetch.ts (SSRF-guarded product page
// scrape). Only usable inside the app; the MCP process and tests use the fake
// (fetcher.ts). Honors SJC_OUTBOUND_DISABLED=1 by refusing to fetch.

import { fetchProductDraft } from "../product-fetch";
import { outboundDisabled } from "./fetcher.ts";
import type { PriceFetcher, ProductIdentity } from "./types.ts";

export function liveFetcher(): PriceFetcher {
  return {
    mode: "live",
    async lookup(product: ProductIdentity, opts: { urls?: string[] } = {}) {
      if (outboundDisabled()) return { ok: false, error: "outbound disabled (SJC_OUTBOUND_DISABLED=1)" };
      const urls = [...(opts.urls ?? []), ...(product.url ? [product.url] : [])];
      if (!urls.length) return { ok: false, error: "no product page URL to read — web search is not wired; give the product's page or ask the supplier" };
      const results = [];
      for (const url of urls) {
        const r = await fetchProductDraft(url);
        if (!r.ok) continue;
        // product-fetch reports price in whole dollars (a page listing), unit unknown: the caller records the unit gap honestly.
        results.push({
          price_cents: r.draft.price > 0 ? Math.round(r.draft.price * 100) : null,
          unit: null,
          url,
          supplier_name: new URL(url).hostname,
          observed_at: new Date().toISOString(),
          includes_tax: false,
          includes_freight: null,
          matched_product: { name: r.draft.name, brand: r.draft.brand, sku: r.draft.sku, url },
          substitution_note: product.model && r.draft.name && !r.draft.name.toLowerCase().includes(product.model.toLowerCase()) ? `page title "${r.draft.name}" does not name model ${product.model}` : null,
        });
      }
      return { ok: true, results };
    },
  };
}
