import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { userPrincipal } from "@/lib/commands/db";
import { checkout } from "@/lib/payments/server";

// POST /api/payments/square/create — client-portal checkout (A20).
// Body: { invoiceId, method: 'card'|'ach', sourceId, nonce, expectedAmountCents?, expectedRevision?,
//         card?: { brand, cardType, prepaidType }, expectedSurchargeCents? }
// `card` is the SDK's reading of the card; it only decides whether the credit
// card surcharge applies, and Square's own reading is checked before any
// surcharged charge completes (lib/payments/service.ts).
// The browser tokenized with Square's Web Payments SDK; `sourceId` is opaque
// and is never logged. The server computes the amount from the verified
// invoice balance and reuses the attempt for a repeated nonce, so repeat
// taps / refreshes never double charge. Client session required; the invoice
// must belong to the client's own project.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "client" || !user.linkSlug || user.linkSlug.startsWith("lead:")) {
    return NextResponse.json({ error: "Sign in to your client portal to pay an invoice." }, { status: 401 });
  }
  let body: { invoiceId?: unknown; method?: unknown; sourceId?: unknown; nonce?: unknown; expectedAmountCents?: unknown; expectedRevision?: unknown; card?: unknown; expectedSurchargeCents?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }
  const invoiceId = Number(body.invoiceId);
  const method = body.method === "ach" ? "ach" : body.method === "card" ? "card" : null;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  if (!Number.isInteger(invoiceId) || !method || !sourceId || !nonce) {
    return NextResponse.json({ error: "invoiceId, method, sourceId and nonce are required" }, { status: 400 });
  }
  const owns = await queryOne<{ id: number; client_email: string | null }>(
    `SELECT i.id, p.client_email FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 AND p.slug = $2`,
    [invoiceId, user.linkSlug],
  );
  if (!owns) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

  const result = await checkout({
    invoiceId,
    method,
    nonce,
    sourceId,
    expectedAmountCents: body.expectedAmountCents == null ? null : Number(body.expectedAmountCents),
    expectedRevision: body.expectedRevision == null ? null : Number(body.expectedRevision),
    card: cardFacts(body.card),
    expectedSurchargeCents: body.expectedSurchargeCents == null ? null : Number(body.expectedSurchargeCents),
    // A link-only client's account email is a synthetic @client-portal.invalid
    // address; Square would mail its receipt there. Use the project's instead.
    buyerEmail: user.email && !user.email.endsWith("@client-portal.invalid") ? user.email : owns.client_email?.trim() || null,
    actor: userPrincipal(user),
  });
  if (!result.ok) return NextResponse.json({ error: result.reason, code: result.code, detail: result.detail }, { status: result.status });
  return NextResponse.json({ ok: true, state: result.state, attemptId: result.attemptId, amountCents: result.amountCents, reused: result.reused, message: result.message });
}

function cardFacts(v: unknown): { brand: string | null; cardType: string | null; prepaidType: string | null } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.length <= 40 ? x : null);
  return { brand: str(o.brand), cardType: str(o.cardType), prepaidType: str(o.prepaidType) };
}
