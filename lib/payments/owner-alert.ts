// Tell Joe when a client pays online (Joe, 2026-10-28). Square moves an
// attempt to completed (card, or an ACH that cleared), pending (an ACH the
// client just started) or returned (the bank reversed it); each of those
// drops one in-app card on Joe's bell and one Telegram push.
//
// Written inside the same transaction that records the payment, so a payment
// can't land without its alert and a rolled-back one can't announce itself.
// The push goes into push_outbox due now: the caller transmits it right after
// commit (sendOwnerPushesNow), and if that misses — quiet hours, Telegram
// down, the worker replaying an event — the 5-minute drain delivers it.
// Once per attempt + state via reminder_log, so the checkout response, the
// webhook and the reconcile sweep reaching the same transition alert once.
//
// Pure: `run` only.

import type { Run } from "../commands/core.ts";
import { invoiceBalance } from "../billing/core.ts";

export type AlertState = "completed" | "pending" | "returned";

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export interface PaymentAlertInput {
  attemptId: string;
  invoiceId: number;
  /** What Square charged, surcharge included. */
  amountCents: number;
  /** Credit card surcharge inside amountCents (0 = none). */
  surchargeCents?: number;
  method: "card" | "ach";
  state: AlertState;
}

/** Stage the alert; returns the push_outbox row id, or null when this
 *  transition was already announced (or isn't one Joe hears about). */
export async function stagePaymentAlert(run: Run, input: PaymentAlertInput): Promise<string | null> {
  // A pending card is just Square thinking; only a started bank transfer is news.
  if (input.state === "pending" && input.method !== "ach") return null;
  const claimed = await run(`INSERT INTO reminder_log (dedup_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING dedup_key`, [`paypush:${input.attemptId}:${input.state}`]);
  if (!claimed.length) return null;

  const [inv] = await run<{ number: string; milestone: string | null; slug: string; project_name: string; client_name: string | null }>(
    `SELECT i.number, i.milestone, p.slug, p.name AS project_name, p.client_name
       FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
    [input.invoiceId],
  );
  if (!inv) return null;
  const who = inv.client_name?.trim() || inv.project_name;
  const how = input.method === "ach" ? "Bank transfer" : "Card";
  const invoice = `Invoice ${inv.number}${inv.milestone ? ` (${inv.milestone})` : ""}`;
  const balance = (await invoiceBalance(run, input.invoiceId))?.balanceCents ?? 0;
  const owed = balance > 0 ? `${usd(balance)} still owed` : "paid in full";
  const surcharge = input.surchargeCents ?? 0;
  const incl = surcharge > 0 ? ` · incl. ${usd(surcharge)} card surcharge` : "";

  const msg =
    input.state === "completed"
      ? { title: `Paid online: ${usd(input.amountCents)} from ${who}`, body: `${how} · ${invoice}${incl} · ${owed}`, accent: "money", flagged: false }
      : input.state === "pending"
        ? { title: `Bank transfer started: ${usd(input.amountCents)} from ${who}`, body: `${invoice} · settles in 3–5 business days; not counted as paid until it clears`, accent: "money", flagged: false }
        : { title: `Payment returned: ${usd(input.amountCents)} from ${who}`, body: `The bank reversed the ${how.toLowerCase()} payment on ${invoice} · ${owed}`, accent: "flag", flagged: true };
  const href = `/projects/${inv.slug}?tab=Money`;

  await run(
    `INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href)
     VALUES ('money', 'Payment', $1, 'money', $2, $3, 'Just now', $4, $5)`,
    [msg.accent, msg.title.slice(0, 300), msg.body, msg.flagged, href],
  );
  const [row] = await run<{ id: string }>(
    `INSERT INTO push_outbox (kind, title, body, href, send_after) VALUES ('payment', $1, $2, $3, now()) RETURNING id::text AS id`,
    [msg.title.slice(0, 300), msg.body, href],
  );
  return row.id;
}
