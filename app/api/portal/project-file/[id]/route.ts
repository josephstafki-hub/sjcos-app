import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves a client-uploaded file (Phase-3 5-depth) to the owner OR the client
// who uploaded it. Authorization is by files.client_slug vs. the client's
// linkSlug — owner project files (no client_slug) stay owner-only on
// /api/files/[id] and are never reachable here.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const file = await queryOne<{
    storage_path: string | null;
    mime_type: string | null;
    name: string;
    client_slug: string | null;
  }>(
    `SELECT storage_path, mime_type, name, client_slug FROM files WHERE id = $1`,
    [id],
  );
  if (!file?.storage_path || !file.client_slug) return new Response("Not found", { status: 404 });

  if (user.role !== "owner" && !(user.role === "client" && user.linkSlug === file.client_slug)) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = path.join(UPLOAD_DIR, path.basename(file.storage_path));
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
