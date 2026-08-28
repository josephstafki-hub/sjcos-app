// Owner-only live preview of a project invoice's house-style Invoice PDF — the
// same document the send path attaches to the client email, rendered on the fly
// from the invoice's current line items (no draft row). Mirrors the estimate
// preview (app/api/projects/[slug]/estimates/[id]/preview/route.ts); lets the
// Money tab show the PDF a client would receive before anything is sent.

import { getCurrentUser } from "@/lib/dal";
import { renderProjectInvoicePdf } from "@/lib/doc-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner") return new Response("Forbidden", { status: 403 });

  const { slug, id } = await params;
  const pdf = await renderProjectInvoicePdf(slug, Number(id));
  if (!pdf) return new Response("Add at least one line before previewing.", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Invoice.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
