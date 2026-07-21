import { query, queryOne } from "@/lib/db";

// GET /api/newsletter/unsubscribe/[token] — one-click opt-out from a newsletter
// footer. Unauthenticated by necessity (the reader has no account) and by intent:
// making someone log in to stop receiving mail is exactly the dark pattern
// CAN-SPAM exists to prevent.
//
// Acts on GET rather than showing a confirm form. Link prefetchers are the usual
// argument against that, but mail clients prefetch images, not links, and the
// cost of a stray unsubscribe is far lower than the cost of a reader who cannot
// get out. Idempotent, so a double-click is harmless.
//
// Deactivating also CANCELS any active drip subscriptions — otherwise the timer
// would keep mailing someone who just opted out, which is the worst possible bug
// in this feature.
export const dynamic = "force-dynamic";

function page(title: string, message: string): Response {
  const html =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title>` +
    `<div style="font-family:Georgia,serif;max-width:460px;margin:18vh auto;padding:0 24px;text-align:center;color:#1c1c1c">` +
    `<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>` +
    `<p style="font-size:15px;line-height:1.6;color:#5a5a5a;margin:0">${message}</p>` +
    `<p style="font-size:13px;color:#8a8a8a;margin:28px 0 0">SJ Carpentry LLC</p></div>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return page("Link not recognized", "This unsubscribe link isn't valid.");

  const row = await queryOne<{ id: number; email: string }>(
    `UPDATE newsletter_recipients SET active = false WHERE unsub_token = $1 RETURNING id, email`,
    [token.slice(0, 80)],
  );
  if (!row) {
    return page("Link not recognized", "This unsubscribe link isn't valid, or it has already been used.");
  }

  // Stop any in-flight drip immediately.
  await query(
    `UPDATE newsletter_subscriptions SET status = 'cancelled' WHERE recipient_id = $1 AND status = 'active'`,
    [row.id],
  );
  // Drop anything already parked but not yet sent to this address.
  await query(
    `UPDATE newsletter_outbox SET status = 'skipped' WHERE email = $1 AND status = 'queued'`,
    [row.email],
  );

  return page("You're unsubscribed", `We won't email ${row.email} again. Sorry to see you go.`);
}
