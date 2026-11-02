// GET /api/payments/authorization/<attemptId> — the client's stored payment
// authorization as a PDF (lib/payments/authorization.ts). It's the form a
// processor's risk team asks for. Owner, or staff with the invoices area.

import { getCurrentUser } from "@/lib/dal";
import { hasAccess } from "@/lib/api-auth";
import { getPaymentAuthorization } from "@/lib/payments/server";
import { renderPaymentAuthorizationPdf } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!hasAccess(user, "invoices")) return new Response("Forbidden", { status: 403 });
  const { attemptId } = await params;
  const auth = await getPaymentAuthorization(attemptId);
  if (!auth) return new Response("No authorization is on file for this payment.", { status: 404 });
  const pdf = await renderPaymentAuthorizationPdf(auth);
  const name = `Payment-authorization-${auth.invoice_number}-${auth.signer_name}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
