import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves bidding files to the people in the deal: the owner sees everything;
// a sub sees a packet file only while they hold a live (non-draft) invite on a
// package that carries it, and a submission file only off their own bids.
// Everyone else — including other subs bidding the same package — gets 403.
// Mirrors app/api/portal/project-file/[id]/route.ts.
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
  }>(`SELECT storage_path, mime_type, name FROM files WHERE id = $1`, [id]);
  if (!file?.storage_path) return new Response("Not found", { status: 404 });

  // The file must be part of the bidding system at all — this route never
  // serves arbitrary project files.
  const inBidding = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok
      WHERE EXISTS (SELECT 1 FROM bid_package_files WHERE file_id = $1)
         OR EXISTS (SELECT 1 FROM bid_submission_files WHERE file_id = $1)`,
    [id],
  );
  if (!inBidding) return new Response("Not found", { status: 404 });

  if (user.role !== "owner") {
    if (user.role !== "sub" || !user.linkSlug) return new Response("Forbidden", { status: 403 });
    const allowed = await queryOne<{ ok: boolean }>(
      `SELECT true AS ok
        WHERE EXISTS (
                SELECT 1 FROM bid_package_files bf
                  JOIN bid_invites i ON i.package_id = bf.package_id
                 WHERE bf.file_id = $1 AND i.sub_slug = $2 AND i.status <> 'draft')
           OR EXISTS (
                SELECT 1 FROM bid_submission_files sf
                  JOIN bid_submissions s ON s.id = sf.submission_id
                  JOIN bid_invites i ON i.id = s.invite_id
                 WHERE sf.file_id = $1 AND i.sub_slug = $2)`,
      [id, user.linkSlug],
    );
    if (!allowed) return new Response("Forbidden", { status: 403 });
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
