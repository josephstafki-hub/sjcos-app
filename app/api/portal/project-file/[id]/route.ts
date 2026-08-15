import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { parseLinkSlug, originLeadSlug } from "@/lib/client-portal";
import { serveFile } from "@/lib/file-serve";

// Serves a portal-reachable file to the owner OR the scoped client. A client
// may open a files row when any of these hold:
//   1. they uploaded it themselves (files.client_slug = their link_slug);
//   2. the owner published it to their dashboard (files.client_visible = true,
//      scoped by project_key / lead_slug);
//   3. it's the PDF/DOCX behind a document draft the owner published
//      (document_drafts.client_visible = true, same scope) — draft blobs don't
//      carry their own scope columns, so the draft row authorizes them.
// Anything else stays owner-only on /api/files/[id].
export async function GET(
  req: Request,
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
    client_visible: boolean;
    project_key: string;
    lead_slug: string | null;
  }>(
    `SELECT storage_path, mime_type, name, client_slug, client_visible, project_key, lead_slug
       FROM files WHERE id = $1`,
    [id],
  );
  if (!file?.storage_path) return new Response("Not found", { status: 404 });

  if (user.role !== "owner") {
    if (user.role !== "client") return new Response("Forbidden", { status: 403 });
    const scope = parseLinkSlug(user.linkSlug);
    if (!scope) return new Response("Forbidden", { status: 403 });

    // A project scope also reaches what was shared during its lead stage.
    const originLead = scope.kind === "project" ? await originLeadSlug(scope.slug) : null;

    const ownUpload =
      !!file.client_slug &&
      (user.linkSlug === file.client_slug ||
        (!!originLead && file.client_slug === `lead:${originLead}`));
    const publishedFile =
      file.client_visible &&
      (scope.kind === "project"
        ? file.project_key === scope.slug || (!!originLead && file.lead_slug === originLead)
        : file.lead_slug === scope.slug);

    let publishedDraft = false;
    if (!ownUpload && !publishedFile) {
      const draft = await queryOne<{ id: string }>(
        scope.kind === "project"
          ? `SELECT d.id FROM document_drafts d
              WHERE (d.pdf_file_id = $1 OR d.docx_file_id = $1)
                AND d.client_visible = true AND d.status <> 'void'
                AND (d.project_id = (SELECT id FROM projects WHERE slug = $2)
                     OR ($3::text IS NOT NULL AND d.lead_slug = $3))
              LIMIT 1`
          : `SELECT d.id FROM document_drafts d
              WHERE (d.pdf_file_id = $1 OR d.docx_file_id = $1)
                AND d.client_visible = true AND d.status <> 'void' AND d.lead_slug = $2
              LIMIT 1`,
        scope.kind === "project" ? [id, scope.slug, originLead] : [id, scope.slug],
      );
      publishedDraft = !!draft;
    }

    if (!ownUpload && !publishedFile && !publishedDraft) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  return serveFile(req, id, { ...file, storage_path: file.storage_path });
}
