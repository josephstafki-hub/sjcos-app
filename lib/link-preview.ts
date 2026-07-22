import "server-only";

// Link preview (P7-N4): given a URL — a blog post on sjcarpentryllc.com, a
// press mention, anything with an og:image — fetch its title + preview image
// so a newsletter block can "link a page and pull over its image" without a
// manual screenshot-and-upload round trip. No scraping library: og:image and
// <title> are one regex each, so a dependency isn't worth it for two tags.
//
// This fetches a URL Joe pastes in, server-side, on request — the standard
// SSRF shape. Defense in depth for an owner-only feature: http(s) only, and
// obviously-local/private hostnames are refused outright. This is NOT full
// DNS-rebinding protection (that would need to resolve the hostname and check
// the IP before connecting) — acceptable here because the caller is always
// the authenticated owner typing a URL into their own editor, not untrusted
// input from a stranger.

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 2 * 1024 * 1024; // 2 MB — plenty for <head>, stops a huge page
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // upstream of prepareNewsletterImage's own cap

const PRIVATE_HOST_RE =
  /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|10(\.\d{1,3}){3}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|192\.168(\.\d{1,3}){2}|::1|.*\.local|.*\.internal)$/i;

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https links are supported.");
  }
  if (PRIVATE_HOST_RE.test(url.hostname)) {
    throw new Error("That host isn't reachable from here.");
  }
  return url;
}

/** Fetch with a byte cap (abort once the cap is exceeded) and a timeout. */
async function fetchCapped(url: string, maxBytes: number, accept: string): Promise<{ bytes: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; SJCOSLinkPreview/1.0)" },
    });
    if (!res.ok || !res.body) throw new Error(`Fetch failed (${res.status}).`);
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        controller.abort();
        throw new Error("That page is too large to preview.");
      }
      chunks.push(value);
    }
    return { bytes: Buffer.concat(chunks), contentType };
  } finally {
    clearTimeout(timer);
  }
}

function extractMeta(html: string, prop: string): string | null {
  // Matches either attribute order: property first or content first. Also
  // tries name= (twitter:*) since not every site uses property= for those.
  const attrs = ["property", "name"];
  for (const attr of attrs) {
    const re1 = new RegExp(`<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${prop}["']`, "i");
    const m = html.match(re1)?.[1] ?? html.match(re2)?.[1];
    if (m) return m;
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

/** Every <img src="..."> in document order, obvious chrome (logo/icon/
 *  favicon/avatar) filtered out — a cheap stand-in for "find the hero image"
 *  on sites that don't bother with og:image on every page. Handles the
 *  Next.js image-optimizer proxy shape (`/_next/image?url=<encoded-real-url>`)
 *  by decoding straight to the origin image instead of re-fetching the proxy
 *  (which needs the exact same host/port this app doesn't have). */
function candidateImages(html: string): string[] {
  const raw = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
  const out: string[] = [];
  for (const src of raw) {
    if (/logo|icon|favicon|avatar|sprite/i.test(src)) continue;
    const proxied = src.match(/\/_next\/image\?[^"']*\burl=([^&"']+)/i);
    out.push(proxied ? decodeURIComponent(proxied[1]) : src);
  }
  return out;
}

/** First non-empty <h1>, tags stripped — usually the real headline even when
 *  <title>/og:title are stuck on a generic site-wide default (seen on sites
 *  where per-page metadata isn't wired up but the visible page still is). */
function firstH1(html: string): string | null {
  for (const m of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return null;
}

export interface LinkPreview {
  title: string;
  imageBytes: Buffer;
  imageFilename: string;
}

/** Fetch a page and pull a title + preview image, trying several fallbacks
 *  because not every site's og:* tags are trustworthy (og:title/og:image can
 *  be a generic site-wide default, or missing entirely, on pages that render
 *  their real content but never wired per-page metadata):
 *    title: <h1> → og:title → <title>
 *    image: og:image/twitter:image (unless it looks like a generic site-wide
 *      placeholder — "template"/"default"/"placeholder"/"share" in the
 *      filename) → first non-chrome <img> in the page → the generic one
 *      anyway, as a last resort
 *  Each image candidate is actually downloaded and content-type-checked
 *  before being accepted, so a broken/relative URL falls through to the next
 *  one instead of failing outright. Throws with a message safe to show the
 *  owner if nothing usable was found. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const pageUrl = assertPublicHttpUrl(rawUrl.trim());

  const page = await fetchCapped(pageUrl.toString(), MAX_HTML_BYTES, "text/html");
  const html = page.bytes.toString("utf8");

  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const title = decodeEntities(
    (firstH1(html) ?? extractMeta(html, "og:title") ?? titleTag ?? "").trim(),
  ).slice(0, 200);

  const metaImages = [extractMeta(html, "og:image"), extractMeta(html, "twitter:image")].filter(
    (s): s is string => Boolean(s),
  );
  const looksGeneric = (s: string) => /template|default|placeholder|\bshare\b|generic/i.test(s);
  const candidates = [
    ...metaImages.filter((s) => !looksGeneric(s)),
    ...candidateImages(html),
    ...metaImages.filter(looksGeneric),
  ];

  for (const candidate of candidates) {
    let imageUrl: URL;
    try {
      imageUrl = assertPublicHttpUrl(new URL(decodeEntities(candidate), pageUrl).toString());
    } catch {
      continue;
    }
    let image: { bytes: Buffer; contentType: string };
    try {
      image = await fetchCapped(imageUrl.toString(), MAX_IMAGE_BYTES, "image/*");
    } catch {
      continue;
    }
    if (!image.contentType.startsWith("image/")) continue;
    const ext = image.contentType.split("/")[1]?.split(/[;+]/)[0] || "jpg";
    return { title: title || pageUrl.hostname, imageBytes: image.bytes, imageFilename: `link-preview.${ext}` };
  }

  throw new Error("Couldn't find a usable image on that page.");
}
