// Owner-only live preview of a document draft's CURRENT field values, rendered
// on the fly (no file storage) — same idea as the lead rough-estimate preview
// (app/api/leads/[slug]/rough-estimate/route.ts). Lets the editor show a PDF
// that updates as soon as fields are saved, without needing a persisted
// "Render PDF + DOCX" pass first.

import { getCurrentUser } from "@/lib/dal";
import { getDocDraft, signatureStampFor } from "@/lib/doc-drafts";
import { getTemplate } from "@/lib/doc-templates/registry";
import { renderTemplatePdf } from "@/lib/doc-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner") return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const draft = await getDocDraft(Number(id));
  if (!draft) return new Response("Draft not found.", { status: 404 });
  const template = getTemplate(draft.template_key);
  if (!template) return new Response("Unknown template.", { status: 404 });

  // Once signed, preview the EXECUTED copy — signature stamped in + the full
  // certificate (consent, IP, device, audit trail) — so the owner's panel
  // matches exactly what the client received.
  const signature =
    draft.status === "signed" && draft.signature_request_id
      ? await signatureStampFor(draft.signature_request_id)
      : undefined;
  const pdf = await renderTemplatePdf(template, draft.field_values, signature);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${draft.title}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
