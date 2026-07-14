// Owner-only preview of a lead's rough-estimate PDF — the same house-style
// document that gets attached when the estimate is emailed to the lead. Rendered
// on the fly from lead_estimates (no draft row). Lets the owner eyeball the PDF
// before sending.

import { getCurrentUser } from "@/lib/dal";
import { renderRoughEstimatePdf } from "@/lib/doc-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "owner") return new Response("Forbidden", { status: 403 });

  const { slug } = await params;
  const pdf = await renderRoughEstimatePdf(slug);
  if (!pdf) return new Response("No rough estimate drafted yet.", { status: 404 });

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Phase 1 Rough Estimate.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
