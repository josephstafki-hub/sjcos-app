// Post-outcome effects per intent kind: the business-record status flips
// that used to happen inline in the send adapters. They run ONLY on
// accepted / confirmed outcomes (a failed or unknown attempt never marks an
// invoice "sent"), inside the outcome transaction, and are idempotent so a
// reconciliation that later confirms an 'unknown' can run them safely.
//
// Pure: `run` only. Notification rows are inserted directly (lib/notify.ts
// emit is pool-bound).

import type { Run } from "../commands/core.ts";
import type { ActionIntent, IntentState } from "../commands/intents.ts";
import type { ProviderResult } from "../providers/types.ts";

export type Effect = (run: Run, intent: ActionIntent, result: ProviderResult, state: IntentState | null) => Promise<void>;

const OK = new Set<IntentState | null>(["accepted", "confirmed"]);
const FAILED = new Set<IntentState | null>(["permanent_failure", "cancelled"]);

async function notify(run: Run, n: { kind: string; tag: string; accent: string; icon: string; title: string; subline?: string | null; href?: string | null }): Promise<void> {
  await run(
    `INSERT INTO notifications (kind, tag, accent, icon, title, subline, when_label, flagged, href) VALUES ($1, $2, $3, $4, $5, $6, 'Just now', false, $7)`,
    [n.kind, n.tag, n.accent, n.icon, n.title.slice(0, 300), n.subline ?? null, n.href ?? null],
  );
}

const p = (intent: ActionIntent) => intent.payload as Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export const EFFECTS: Record<string, Effect> = {
  async send_invoice(run, intent, _r, state) {
    if (!OK.has(state)) return;
    const id = Number(intent.target_id);
    const rows = await run<{ id: number }>(`UPDATE invoices SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [id]);
    if (!rows.length) return;
    const pl = p(intent);
    await notify(run, { kind: "money", tag: "Money", accent: "money", icon: "money", title: `Invoice ${s(pl.number)} sent · ${s(pl.project_name)}`, subline: `${s(pl.amount_label)} · ${s(pl.milestone)}`, href: pl.slug ? `/projects/${s(pl.slug)}` : null });
  },

  async send_purchase_order(run, intent, _r, state) {
    if (!OK.has(state)) return;
    const id = Number(intent.target_id);
    const rows = await run<{ id: number }>(`UPDATE purchase_orders SET status = 'sent', sent_at = now() WHERE id = $1 AND status IN ('draft','queued') RETURNING id`, [id]);
    if (!rows.length) return;
    const pl = p(intent);
    await notify(run, { kind: "money", tag: "Money", accent: "money", icon: "money", title: `PO ${s(pl.po_number)} sent · ${s(pl.project_name)}`, subline: `${s(pl.amount_label)} · ${s(pl.vendor_name)}`, href: pl.slug ? `/projects/${s(pl.slug)}` : null });
  },

  async send_bid_package(run, intent, _r, state) {
    if (!OK.has(state)) return;
    const pl = p(intent);
    const inviteId = Number(pl.invite_id);
    const packageId = Number(intent.target_id);
    const rows = await run<{ id: number }>(`UPDATE bid_invites SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'draft' RETURNING id`, [inviteId]);
    if (!rows.length) return;
    await run(`UPDATE bid_packages SET status = 'open', sent_at = COALESCE(sent_at, now()), updated_at = now() WHERE id = $1 AND status NOT IN ('awarded','closed')`, [packageId]);
    await notify(run, { kind: "job", tag: "Bid", accent: "accent", icon: "mail", title: `Bid request emailed to ${s(pl.sub_name)} — ${s(pl.package_title)}`, subline: `${s(pl.project_name)} · packet attached`, href: pl.slug ? `/projects/${s(pl.slug)}` : null });
  },

  async release_newsletter(run, intent, r, state) {
    const id = Number(intent.target_id);
    if (OK.has(state)) {
      const rows = await run<{ newsletter_id: number | null }>(
        `UPDATE newsletter_outbox SET status = 'released', released_at = now(), error = NULL WHERE id = $1 AND status IN ('queued','failed') RETURNING newsletter_id`,
        [id],
      );
      if (rows[0]?.newsletter_id) await settleIssue(run, rows[0].newsletter_id);
      return;
    }
    if (FAILED.has(state)) {
      await run(`UPDATE newsletter_outbox SET status = 'failed', released_at = NULL, error = $2 WHERE id = $1 AND status IN ('queued','failed')`, [id, (r.error ?? "send failed").slice(0, 300)]);
    }
  },

  async send_sms(run, intent, r, state) {
    const pl = p(intent);
    const messageId = Number(pl.message_id);
    const threadId = Number(pl.thread_id);
    if (!messageId) return;
    if (OK.has(state)) {
      await run(`UPDATE sms_messages SET provider_sid = COALESCE($2, provider_sid), status = $3, updated_at = now() WHERE id = $1 AND status IN ('queued','failed')`, [messageId, r.providerRef ?? null, r.providerState ?? "queued"]);
      if (threadId) await run(`UPDATE sms_threads SET last_message_at = now(), last_outbound_at = now(), unread = false WHERE id = $1`, [threadId]);
      return;
    }
    if (FAILED.has(state)) {
      await run(`UPDATE sms_messages SET status = 'failed', error_detail = $2, updated_at = now() WHERE id = $1 AND status = 'queued'`, [messageId, (r.error ?? "send failed").slice(0, 500)]);
    } else if (state === "unknown") {
      await run(`UPDATE sms_messages SET error_detail = $2, updated_at = now() WHERE id = $1 AND status = 'queued'`, [messageId, `outcome unknown — held for reconciliation: ${(r.error ?? "").slice(0, 300)}`]);
    }
  },

  async place_call(run, intent, r, state) {
    const pl = p(intent);
    const callId = s(pl.callId);
    if (!callId) return;
    if (OK.has(state)) {
      const session = (r.providerState ?? "").startsWith("session:") ? (r.providerState ?? "").slice(8) : null;
      await run(`UPDATE calls SET owner_leg_id = COALESCE($2, owner_leg_id), call_session_id = COALESCE($3, call_session_id), updated_at = now() WHERE id = $1`, [callId, r.providerRef ?? null, session]);
      return;
    }
    if (FAILED.has(state)) {
      await run(`UPDATE calls SET status = 'failed', outcome = 'failed', ended = true, ended_at = now(), error = $2, updated_at = now() WHERE id = $1 AND status = 'ringing'`, [callId, (r.error ?? "dial failed").slice(0, 500)]);
    }
  },
};

/** Mirror of lib/newsletter-outbox.ts settleIssueIfDrained over `run`. */
async function settleIssue(run: Run, newsletterId: number): Promise<void> {
  const [pending] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM newsletter_outbox WHERE newsletter_id = $1 AND status IN ('queued','failed')`, [newsletterId]);
  if ((pending?.n ?? 0) > 0) return;
  const [released] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM newsletter_outbox WHERE newsletter_id = $1 AND status = 'released'`, [newsletterId]);
  if ((released?.n ?? 0) > 0) {
    await run(`UPDATE newsletters SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now() WHERE id = $1 AND status <> 'sent'`, [newsletterId, released!.n]);
  } else {
    await run(`UPDATE newsletters SET status = 'draft', recipient_count = 0, updated_at = now() WHERE id = $1 AND status = 'queued'`, [newsletterId]);
  }
}
