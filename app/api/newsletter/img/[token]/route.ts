import { readFile } from "node:fs/promises";
import path from "node:path";
import { queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";

// GET /api/newsletter/img/[token] — serves an image embedded in a newsletter.
//
// Deliberately UNAUTHENTICATED, because the fetcher is the recipient's mail
// client (or Gmail's image proxy), which can never carry a session. The blanket
// /api/files/[id] route stays owner-only; this one resolves ONLY through a
// newsletter_assets row, so the owner publishing a photo into an issue is what
// makes that one file reachable — the token is a 32-char uuid and is the entire
// capability. Nothing else in the files table is exposed.
//
// force-dynamic + long public cache: the bytes never change for a given token,
// and mail proxies fetch each image once per recipient.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return new Response("Not found", { status: 404 });

  const row = await queryOne<{ storage_path: string | null; mime_type: string | null }>(
    `SELECT f.storage_path, f.mime_type
       FROM newsletter_assets a
       JOIN files f ON f.id = a.file_id
      WHERE a.token = $1`,
    [token.slice(0, 80)],
  );
  if (!row?.storage_path) return new Response("Not found", { status: 404 });

  // Only ever serve images from here, whatever the files row claims.
  const mime = row.mime_type && row.mime_type.startsWith("image/") ? row.mime_type : "image/jpeg";

  // storage_path is DB-controlled, but basename-guard against traversal anyway.
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(UPLOAD_DIR, path.basename(row.storage_path)));
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
