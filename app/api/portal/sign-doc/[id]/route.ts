import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/uploads";

// Serves a signature request's attached document (the generated contract/SOW
// PDF) to the owner OR the client whose project it is. Keyed by signature_request
// id so authorization is by the request's project slug vs. the client's linkSlug
// — distinct from the owner-only /api/files/[id]. Lets the client review the
// actual PDF before e-signing it (B5c).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const reqId = Number(id);
  if (!Number.isFinite(reqId)) return new Response("Not found", { status: 404 });

  // A request scopes to a project OR a lead (pre-project estimates/precon).
  // The acceptable users.link_slug values: the project slug, 'lead:<slug>' for
  // a lead-stage session, or — for a lead request whose lead has since
  // converted — the converted project's slug (the client's link upgraded on
  // conversion, the paperwork didn't move).
  const sr = await queryOne<{
    file_id: string | null;
    slug: string | null;
    lead_slug: string | null;
    converted_slug: string | null;
  }>(
    `SELECT sr.file_id, p.slug, sr.lead_slug, cp.slug AS converted_slug
       FROM signature_requests sr
       LEFT JOIN projects p ON p.id = sr.project_id
       LEFT JOIN leads l ON l.slug = sr.lead_slug
       LEFT JOIN projects cp ON cp.lead_id = l.id
      WHERE sr.id = $1`,
    [reqId],
  );
  if (!sr?.file_id) return new Response("Not found", { status: 404 });

  const allowed = [
    sr.slug,
    sr.lead_slug ? `lead:${sr.lead_slug}` : null,
    sr.converted_slug,
  ].filter(Boolean);
  if (user.role !== "owner" && !(user.role === "client" && allowed.includes(user.linkSlug ?? ""))) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = await queryOne<{ storage_path: string | null; mime_type: string | null; name: string }>(
    `SELECT storage_path, mime_type, name FROM files WHERE id = $1`,
    [sr.file_id],
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
      "Content-Type": file.mime_type || "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.name)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
