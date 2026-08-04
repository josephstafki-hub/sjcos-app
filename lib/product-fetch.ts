import "server-only";

// Product-page scraper for the selections board. Joe pastes a Ferguson /
// Wayfair / Menards / Build.com link on an option and we try to pull back the
// name, brand, price, and hero image so he doesn't retype them.
//
// This is deliberately best-effort. Vendor sites block bots, render prices in
// client-side JS, and change markup without notice, so EVERY failure path
// returns a plain { ok: false } with a human reason — the UI then asks Joe to
// fill the fields in by hand rather than pretending the option is broken.
//
// Security: the URL comes from a form, so this is a server-side request to an
// attacker-influenceable address (SSRF). We only allow http/https, resolve the
// hostname first and refuse private/loopback/link-local/CGNAT ranges, cap the
// response size, and re-check the target on every redirect hop.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { storeBuffer } from "./upload-store";

export interface ProductDraft {
  name: string;
  brand: string;
  sku: string;
  price: number;
  /** files row id for the downloaded hero image, when we got one. */
  imageFileId: string | null;
  /** True when we found an image but could not store it. */
  imageFailed: boolean;
}

export type ProductFetchResult =
  | { ok: true; draft: ProductDraft }
  | { ok: false; error: string };

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

// A real browser UA. Plenty of retail sites 403 anything that looks scripted;
// this gets us through the polite ones and we degrade gracefully on the rest.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Private, loopback, link-local, and carrier-NAT ranges we refuse to fetch —
 *  the addresses that would turn "paste a link" into a probe of Joe's own LAN
 *  or the cloud metadata endpoint. */
function isBlockedAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    // IPv4-mapped (::ffff:10.0.0.1) — re-check the embedded v4 address.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;             // link-local + AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
  if (a >= 224) return true;                            // multicast + reserved
  return false;
}

/** Validate a URL and confirm its host resolves to a public address. */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links can be fetched.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("That address isn't allowed.");
    return url;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`Couldn't resolve ${url.hostname}.`);
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new Error("That address isn't allowed.");
  }
  return url;
}

/** Fetch with manual redirect handling so every hop is re-validated — a public
 *  URL that 302s to 169.254.169.254 must not slip through. */
async function safeFetch(raw: string, accept: string): Promise<Response> {
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(target);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": UA, accept, "accept-language": "en-US,en;q=0.9" },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return res;
      target = new URL(next, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}

/** Read a response body with a hard byte cap so a huge page can't exhaust the
 *  server's memory. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw new Error("Response too large.");

  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error("Response too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim();
}

/** Pull a <meta> value by property/name, whichever order the attributes land in. */
function meta(html: string, key: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return "";
}

/** Walk every JSON-LD block for the first schema.org Product node. */
function jsonLdProduct(html: string): Record<string, unknown> | null {
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const b of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(b[1].trim());
    } catch {
      continue; // malformed JSON-LD is common; just skip the block
    }
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const rec = node as Record<string, unknown>;
      const type = rec["@type"];
      const types = Array.isArray(type) ? type : [type];
      if (types.some((t) => typeof t === "string" && t.toLowerCase() === "product")) return rec;
      if (rec["@graph"]) stack.push(rec["@graph"]);
    }
  }
  return null;
}

/** Dollars from "$1,299.00" / "1299.00" / 1299. Cents are dropped — the board
 *  works in whole dollars. Returns 0 when there's nothing sane to read. */
function parsePrice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== "string") return 0;
  const m = value.replace(/[^\d.,]/g, "").match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function str(value: unknown): string {
  if (typeof value === "string") return decodeEntities(value);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.name === "string") return decodeEntities(rec.name);
  }
  return "";
}

/** Price from a Product node's offers (which may be one, a list, or aggregate). */
function offerPrice(product: Record<string, unknown>): number {
  const offers = product.offers;
  const list = Array.isArray(offers) ? offers : [offers];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const rec = o as Record<string, unknown>;
    const p = parsePrice(rec.price ?? rec.lowPrice ?? rec.highPrice);
    if (p > 0) return p;
    const spec = rec.priceSpecification;
    if (spec && typeof spec === "object") {
      const sp = parsePrice((spec as Record<string, unknown>).price);
      if (sp > 0) return sp;
    }
  }
  return 0;
}

function firstImage(product: Record<string, unknown> | null, html: string): string {
  const fromLd = product?.image;
  if (typeof fromLd === "string") return fromLd;
  if (Array.isArray(fromLd) && typeof fromLd[0] === "string") return fromLd[0];
  if (fromLd && typeof fromLd === "object") {
    const u = (fromLd as Record<string, unknown>).url;
    if (typeof u === "string") return u;
  }
  return meta(html, "og:image") || meta(html, "twitter:image");
}

/** Download the hero image and file it in the upload store. Failure here is
 *  non-fatal — the option still gets its text, and Joe can upload a photo. */
async function storeImage(rawUrl: string, pageUrl: URL, label: string): Promise<string | null> {
  let absolute: string;
  try {
    absolute = new URL(rawUrl, pageUrl).toString();
  } catch {
    return null;
  }
  try {
    const res = await safeFetch(absolute, "image/*");
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mime.startsWith("image/")) return null;
    const bytes = await readCapped(res, MAX_IMAGE_BYTES);
    if (bytes.length === 0) return null;

    const ext = mime.replace("image/", "").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "jpg";
    const stored = await storeBuffer(bytes, {
      filename: `${label.slice(0, 60).replace(/[^\w.\- ]+/g, "_") || "option"}.${ext}`,
      mime,
      idPrefix: "sel",
      tag: "SELECTION",
      subtitle: `Selection option · ${pageUrl.hostname}`,
    });
    return stored.ok ? stored.id : null;
  } catch {
    return null;
  }
}

/** Titles the big retailers serve from their bot walls and redirect landings.
 *  Matching one means we were bounced, whatever the status code said. */
const INTERSTITIAL =
  /pardon our interruption|access denied|are you a human|robot check|just a moment|verify you are|security check|request unsuccessful|page not found|enable javascript/i;

/** Retail pages trail the store name in <title> and og:title — "Emtek Bronze
 *  Lever | Rejuvenation". Drop that tail, but only when it really names the
 *  store: product names use dashes themselves ("Zellige 4x4 — Weathered White")
 *  and the finish is the half that tells one option from another. */
function trimStoreSuffix(name: string, pageUrl: URL, siteName: string): string {
  const seps = [...name.matchAll(/\s+[|·—–]\s+/g)];
  if (!seps.length) return name;
  const last = seps[seps.length - 1];
  const at = last.index ?? 0;
  const tail = name.slice(at + last[0].length).toLowerCase().trim();
  const site = siteName.trim().toLowerCase();
  const host = pageUrl.hostname.replace(/^www\./, "").split(".")[0].toLowerCase();
  const isStore =
    (!!site && tail === site) ||
    (host.length > 2 && tail.replace(/[^a-z0-9]/g, "").includes(host));
  return isStore ? name.slice(0, at).trim() : name;
}

export type ParseResult =
  | { ok: true; fields: Omit<ProductDraft, "imageFileId" | "imageFailed">; imageUrl: string }
  | { ok: false; error: string };

/** Pull the option fields out of a fetched product page. Split from the network
 *  path so it can be exercised against fixtures — the vendor sites that matter
 *  most here are exactly the ones that won't answer a test run. */
export function parseProductHtml(html: string, pageUrl: URL): ParseResult {
  const product = jsonLdProduct(html);
  const siteName = meta(html, "og:site_name");
  // A JSON-LD name is the vendor's own product string — already clean. Only the
  // og:title / <title> fallbacks carry the store suffix worth trimming.
  const ldName = str(product?.name);
  const name =
    ldName ||
    meta(html, "og:title") ||
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const brand = str(product?.brand) || siteName || pageUrl.hostname.replace(/^www\./, "");
  const sku = str(product?.sku) || str(product?.mpn);
  const price = (product ? offerPrice(product) : 0) || parsePrice(meta(html, "product:price:amount"));

  // A bot wall, a category listing, or a redirect to the homepage all answer
  // 200 with a perfectly parseable <title> — "Pardon Our Interruption",
  // "Products", "Online Home Store for Furniture". Accepting those would file
  // an option named after the block page, so require hard evidence this is one
  // product: a schema.org Product node, or a price. `og:type=product` on its
  // own is not enough — IKEA's category pages declare it. A miss here costs
  // nothing; Joe just types the fields in.
  const looksLikeProduct = !!product || price > 0;
  if (!looksLikeProduct || !name) {
    return { ok: false, error: `Couldn't read a product off ${pageUrl.hostname} — enter the details by hand.` };
  }
  if (INTERSTITIAL.test(name)) {
    return {
      ok: false,
      error: `${pageUrl.hostname} served a bot check instead of the product — enter the details by hand.`,
    };
  }

  return {
    ok: true,
    fields: {
      name: (ldName ? name : trimStoreSuffix(name, pageUrl, siteName)).slice(0, 200),
      brand: brand.slice(0, 120),
      sku: sku.slice(0, 80),
      price,
    },
    imageUrl: firstImage(product, html),
  };
}

/** Best-effort scrape of a product page into a draft option. */
export async function fetchProductDraft(rawUrl: string): Promise<ProductFetchResult> {
  let pageUrl: URL;
  let html: string;
  try {
    pageUrl = await assertPublicUrl(rawUrl);
    const res = await safeFetch(pageUrl.toString(), "text/html,application/xhtml+xml");
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 403 || res.status === 401
            ? `${pageUrl.hostname} blocked the request — enter the details by hand.`
            : `${pageUrl.hostname} returned ${res.status} — enter the details by hand.`,
      };
    }
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (ct && !ct.includes("html") && !ct.includes("xml")) {
      return { ok: false, error: "That link isn't a product page." };
    }
    html = (await readCapped(res, MAX_HTML_BYTES)).toString("utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed.";
    const timedOut = /timeout|abort/i.test(msg);
    return { ok: false, error: timedOut ? "That site took too long to answer — enter the details by hand." : msg };
  }

  const parsed = parseProductHtml(html, pageUrl);
  if (!parsed.ok) return parsed;

  const imageFileId = parsed.imageUrl
    ? await storeImage(parsed.imageUrl, pageUrl, parsed.fields.name || "option")
    : null;

  return {
    ok: true,
    draft: {
      ...parsed.fields,
      imageFileId,
      imageFailed: !!parsed.imageUrl && !imageFileId,
    },
  };
}
