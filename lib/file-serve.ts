import "server-only";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_DIR } from "./uploads";

// Shared blob-serving for /api/files/[id] and /api/portal/project-file/[id]:
// the auth differs per route, the bytes-and-headers part doesn't.
//
// Thumbnails (?w=<px>): photo grids used to pull every full-resolution phone
// photo through the wire. Now a `w` query on an image row returns a resized
// WebP, generated once with sharp and cached under uploads/.thumbs/. sharp
// drops EXIF (incl. GPS) unless asked to keep it and .rotate() honors the
// orientation tag first, so thumbs come out upright and metadata-free.

const THUMB_DIR = path.join(UPLOAD_DIR, ".thumbs");
/** Allowed widths — a fixed ladder so the cache can't be sprayed with sizes. */
const THUMB_WIDTHS = [160, 320, 640, 1280] as const;
const THUMB_QUALITY = 78;

export interface ServableFile {
  storage_path: string;
  mime_type: string | null;
  name: string;
}

/** Snap a requested width to the ladder (nearest not-smaller step). */
export function pickThumbWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return THUMB_WIDTHS.find((w) => w >= n) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

async function readOriginal(file: ServableFile): Promise<Buffer | null> {
  // storage_path is DB-controlled, but basename-guard against traversal anyway.
  const filePath = path.join(UPLOAD_DIR, path.basename(file.storage_path));
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

/** Resized WebP for an image row, from the on-disk cache when present. Null if
 *  the original is missing or isn't a decodable image (caller falls back to the
 *  original bytes). */
async function thumbnail(id: string, file: ServableFile, width: number): Promise<Buffer | null> {
  const cachePath = path.join(THUMB_DIR, `${path.basename(id)}__w${width}.webp`);
  try {
    await stat(cachePath);
    return await readFile(cachePath);
  } catch {
    /* miss */
  }
  const original = await readOriginal(file);
  if (!original) return null;
  try {
    const out = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
    await mkdir(THUMB_DIR, { recursive: true });
    await writeFile(cachePath, out).catch(() => {});
    return out;
  } catch {
    return null;
  }
}

/** Build the Response for a files row: the original bytes, or — for
 *  `?w=<px>` on an image — a cached thumbnail. `?download=1` forces a save
 *  dialog instead of inline display. */
export async function serveFile(req: Request, id: string, file: ServableFile): Promise<Response> {
  const url = new URL(req.url);
  const isImage = (file.mime_type ?? "").startsWith("image/");
  const width = isImage ? pickThumbWidth(url.searchParams.get("w")) : null;
  const download = url.searchParams.get("download") === "1";

  if (width) {
    const thumb = await thumbnail(id, file, width);
    if (thumb) {
      return new Response(new Uint8Array(thumb), {
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(thumb.length),
          // Thumbs are derived + immutable per (id, width); a day of private
          // caching keeps grids snappy without leaking across users.
          "Cache-Control": "private, max-age=86400",
        },
      });
    }
  }

  const bytes = await readOriginal(file);
  if (!bytes) return new Response("Not found", { status: 404 });
  const disposition = download ? "attachment" : "inline";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(file.name)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
