import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { serveFile } from "@/lib/file-serve";

// Serves an uploaded file blob by id. Owner-only (the whole /files browser is
// owner-scoped). Showcase rows have no storage_path → 404 (nothing to stream).
// `?w=<px>` returns a cached thumbnail for images; `?download=1` forces a save
// dialog (see lib/file-serve.ts).
export async function GET(
  req: Request,
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

  return serveFile(req, id, { ...row, storage_path: row.storage_path });
}
