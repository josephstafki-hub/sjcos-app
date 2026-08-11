import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { clipTokenMatches } from "@/lib/clip";
import { storeBuffer } from "@/lib/upload-store";
import { MATERIAL_CATEGORIES } from "@/lib/catalog-categories";

// POST /api/catalog/clip — the browser-extension catalog clipper (Phase 2 A).
// The extension is cross-origin and has no session, so this route authenticates
// with a per-owner clip token (Authorization: Bearer <token>) instead of the
// session cookie. The proxy matcher excludes /api, so no redirect fires here.
// force-dynamic (writes + no caching); permissive CORS so the extension popup /
// service worker can call it from any product-page origin.
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

/** CORS preflight. */
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Fetch a product image by URL and store it as a files row. Best-effort: any
 *  failure (bad URL, non-image, oversize, timeout) returns null so the clip
 *  still lands without an image. Only http(s) is allowed (no SSRF via file://). */
async function fetchImage(imageUrl: string, name: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 12 * 1024 * 1024) return null;

    const ext = mime.split("/")[1]?.replace(/[^\w]/g, "").slice(0, 5) || "jpg";
    const stored = await storeBuffer(buf, {
      filename: `${name.slice(0, 60) || "material"}.${ext}`,
      mime,
      idPrefix: "cat",
      tag: "CATALOG",
      subtitle: `Catalog · ${name}`,
    });
    return stored.ok ? stored.id : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!(await clipTokenMatches(token))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const str = (v: unknown, max = 300) =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const name = str(body.name, 200);
  if (!name) return json({ error: "name is required" }, 400);

  const supplier = str(body.supplier, 120);
  const sku = str(body.sku, 120);
  const price = str(body.price, 120);
  const use = str(body.use, 120);
  const description = str(body.description, 2000);
  const msrp = str(body.msrp, 120);
  const series = str(body.series, 120);
  const sourceUrl = str(body.url ?? body.sourceUrl, 1000);
  const categoryInput = str(body.category, 60);
  const category = (MATERIAL_CATEGORIES as readonly string[]).includes(categoryInput)
    ? categoryInput
    : "Cabinets";

  const imageUrl = str(body.imageUrl ?? body.image, 1000);
  const imageFileId = imageUrl ? await fetchImage(imageUrl, name) : null;

  const { rows } = await query<{ id: number }>(
    `INSERT INTO catalog_items
       (name, supplier, sku, category, use_label, price, description, msrp, series,
        image_file_id, source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [name, supplier, sku, category, use, price, description, msrp, series, imageFileId, sourceUrl],
  );

  revalidatePath("/catalog");
  return json({ ok: true, id: rows[0]?.id, name, category, image: Boolean(imageFileId) }, 201);
}
