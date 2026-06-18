import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves an uploaded file blob by id. Owner-only (the whole /files browser is
// owner-scoped). Showcase rows have no storage_path → 404 (nothing to stream).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner") return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const row = await queryOne<{ storage_path: string | null; mime_type: string | null; name: string }>(
    `SELECT storage_path, mime_type, name FROM files WHERE id = $1`,
    [id],
  );
  if (!row?.storage_path) return new Response("Not found", { status: 404 });

  // storage_path is DB-controlled, but basename-guard against traversal anyway.
  const filePath = path.join(UPLOAD_DIR, path.basename(row.storage_path));
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.name)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
