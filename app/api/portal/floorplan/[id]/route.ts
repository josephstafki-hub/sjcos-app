import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { resolveFloorplanFile } from "@/lib/floorplans";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves a floor-plan VERSION's file (image or PDF) to the owner OR the client
// whose project it is. Distinct from the owner-only /api/files/[id] — the route
// is keyed by version id so authorization is by the parent project's slug vs.
// the client's linkSlug (mirrors /api/portal/selection-image).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const versionId = Number(id);
  if (!Number.isFinite(versionId)) return new Response("Not found", { status: 404 });

  const resolved = await resolveFloorplanFile(versionId);
  if (!resolved) return new Response("Not found", { status: 404 });

  // Clients only reach PUBLISHED versions of their own project — the id space
  // is guessable, so the publish switch is enforced here, not just in the list.
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
