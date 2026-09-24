// Price fetcher contract + the fake adapter. The live adapter (fetcher-live.ts)
// wraps lib/product-fetch.ts and is server-only; this file is pure so tests
// and the MCP process can use the fake. Under SJC_OUTBOUND_DISABLED=1 nothing
// leaves the box: the fake returns configured fixtures or "not found".

import type { FetchedPrice, PriceFetcher, ProductIdentity } from "./types.ts";
import { productKey } from "./rules.ts";

export function outboundDisabled(): boolean {
  return process.env.SJC_OUTBOUND_DISABLED === "1";
}

/** Fixtures keyed by productKey() (or "*" for everything). */
export function fakeFetcher(fixtures: Record<string, FetchedPrice[]> = {}): PriceFetcher {
  return {
    mode: "fake",
    async lookup(product: ProductIdentity) {
      const key = productKey(product);
      const hit = fixtures[key] ?? fixtures["*"];
      if (!hit) return { ok: true, results: [] };
      return { ok: true, results: hit.map((r) => ({ ...r, observed_at: r.observed_at ?? new Date().toISOString(), matched_product: r.matched_product ?? product })) };
    },
  };
}

/** Pick the fetcher for the current process: fake when outbound is disabled
 *  or no live factory was supplied. */
export function chooseFetcher(live: (() => PriceFetcher) | null, fixtures?: Record<string, FetchedPrice[]>): PriceFetcher {
  if (outboundDisabled() || !live) return fakeFetcher(fixtures);
  return live();
}
