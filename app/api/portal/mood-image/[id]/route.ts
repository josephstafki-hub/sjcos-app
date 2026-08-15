import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { resolveMoodImage } from "@/lib/mood";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves a mood-board ITEM's image to the owner OR the client whose project it
// is. Keyed by mood item id (not file id) so authorization is by the parent
// project's slug vs. the client's linkSlug (mirrors /api/portal/selection-image).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) return new Response("Not found", { status: 404 });

  const resolved = await resolveMoodImage(itemId);
  if (!resolved) return new Response("Not found", { status: 404 });

  // Clients only reach items on PUBLISHED boards of their own project — item
  // ids are guessable, so the publish switch is enforced here too.
  if (
    user.role !== "owner" &&
    !(user.role === "client" && user.linkSlug === resolved.slug && resolved.published)
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = await queryOne<{ storage_path: string | null; mime_type: string | null; name: string }>(
    `SELECT storage_path, mime_type, name FROM files WHERE id = $1`,
    [resolved.fileId],
  );
  if (!file?.storage_path) return new Response("Not found", { status: 404 });

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
