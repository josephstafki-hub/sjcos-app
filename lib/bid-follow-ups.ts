import "server-only";

// Bid follow-up emails: auto-chase unanswered invites, a softer nudge for subs
// who said they're on it, and a thank-you when a bid lands. Called by the
// CRON_SECRET-gated route at /api/cron/bid-follow-ups and (thanks only) by
// recordBid in lib/actions/bidding.ts.
//
// ─── READ THIS BEFORE CHANGING ANYTHING HERE ────────────────────────────────
// Like the newsletter drip (lib/newsletter-drip.ts), this module emails real
// people on a timer with no Release click. Joe chose that explicitly for bid
// chasing (2026-08-25) — the packet itself still only goes out when the owner
// presses Send, so every address chased here is one the owner already emailed
// on purpose. The exception is fenced the same way, and each guard is
// load-bearing:
//   1. Per-package arm: bid_packages.follow_ups. Packages that existed before
//      this feature were backfilled OFF; the owner can switch any package off
//      from the Bidding tab and the sweep goes quiet for it immediately.
//   2. Only invites of an OPEN package are ever chased, and only while they are
//      actually waiting — 'sent'/'viewed' for the checking-in nudges, 'working'
//      for the softer one. Recording, declining, awarding, or closing stops the
//      chase the moment it happens, with no cancel step to forget.
//   3. Send windows, not just delays. Each email has a [min, max) window off
//      its anchor date; an invite past the window never gets that email. Arming
//      follow-ups late on an old package cannot fire a pile of stale nudges.
//   4. The bid_invite_emails row is claimed BEFORE Gmail is called, against a
//      unique index on (invite_id, kind). A conflict means "already sent (or a
//      concurrent run owns it)" and we skip — an overlapping or re-run sweep
//      cannot double-send. Failed sends re-claim and retry next hour.
//   5. MAX_SENDS_PER_RUN caps the blast radius of any mistake.
// Every send also emits a notification, so auto mail is always visible in the
// feed, never silent.

import { query, queryOne } from "./db";
import { gmailConfigured, sendNewEmail } from "./gmail";
import { emit } from "./notify";

/** Hard ceiling per timer run. Bid lists are a handful of subs, so a healthy
 *  sweep sends far fewer; hitting this cap means something is wrong. */
const MAX_SENDS_PER_RUN = 25;

export type BidEmailKind = "reminder_1" | "reminder_2" | "working_nudge" | "thanks";

/** One invite due for one kind of email, with everything the composer needs. */
interface ChaseRow {
  invite_id: number;
  sub_name: string;
  email: string;
  title: string;
  due_label: string | null;
  sent_label: string | null;
  project_name: string;
  slug: string;
}

/** The chase schedule. Anchors are per-invite dates, windows are [min, max)
 *  days after the anchor — faster than the lead nurture (3/10/21) on purpose:
 *  bids have due dates. Guard 3: outside the window, the email never sends. */
const CHASES: {
  kind: Exclude<BidEmailKind, "thanks">;
  anchor: "sent_at" | "acked_at";
  statuses: string[];
  minDays: number;
  maxDays: number;
}[] = [
  { kind: "reminder_1", anchor: "sent_at", statuses: ["sent", "viewed"], minDays: 2, maxDays: 5 },
  { kind: "reminder_2", anchor: "sent_at", statuses: ["sent", "viewed"], minDays: 5, maxDays: 14 },
  { kind: "working_nudge", anchor: "acked_at", statuses: ["working"], minDays: 4, maxDays: 14 },
];

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** Plain text, same voice as the original bid request (composeBidEmail). */
function compose(kind: BidEmailKind, r: ChaseRow): { subject: string; body: string } {
  const hi = `Hi ${firstName(r.sub_name)},`;
  const sig = ["— Joe Stafki", "SJ Carpentry LLC"];
  const due = r.due_label;

  switch (kind) {
    case "reminder_1":
      return {
        subject: `Re: Bid request: ${r.title} — ${r.project_name}`,
        body: [
          hi,
          "",
          `Just checking in on the ${r.title} bid request for ${r.project_name} I emailed over` +
            `${r.sent_label ? ` on ${r.sent_label}` : ""}.${due ? ` Bids are due by ${due}.` : ""}`,
          "",
          "If anything in the packet needs clarifying, just reply — happy to walk through it. " +
            "Otherwise, send your number whenever it's ready.",
          "",
          ...sig,
        ].join("\n"),
      };
    case "reminder_2":
      return {
        subject: `Re: Bid request: ${r.title} — ${r.project_name}`,
        body: [
          hi,
          "",
          `Last nudge on ${r.title} for ${r.project_name} — ${due ? `bids are due by ${due} and ` : ""}` +
            "I'll be lining up numbers soon. If you're passing this round, no problem at all — " +
            "a quick reply either way helps me plan the schedule.",
          "",
          ...sig,
        ].join("\n"),
      };
    case "working_nudge":
      return {
        subject: `Re: Bid request: ${r.title} — ${r.project_name}`,
        body: [
          hi,
          "",
          `Thanks for letting me know you're working on the ${r.title} number for ${r.project_name}. ` +
            `${due ? `Just a reminder bids are due by ${due}.` : "Just keeping it on your radar."}`,
          "",
          "If any questions came up while pricing it, reply here and I'll get you answers.",
          "",
          ...sig,
        ].join("\n"),
      };
    case "thanks":
      return {
        subject: `Got your bid — ${r.title} (${r.project_name})`,
        body: [
          hi,
          "",
          `Thanks — your ${r.title} bid for ${r.project_name} is in. Appreciate you putting the ` +
            "number together.",
          "",
          "I'll review everything and get back to you either way.",
          "",
          ...sig,
        ].join("\n"),
      };
  }
}

/** Guard 4: claim the (invite, kind) slot before sending. Returns the ledger
 *  row id, or null when the slot is already sent or held by a concurrent run.
 *  A 'failed' row (and a 'queued' row older than an hour — a crashed run) is
 *  re-claimable, which is what makes transient Gmail errors retry next sweep. */
async function claim(
  inviteId: number,
  kind: BidEmailKind,
  subject: string,
  body: string,
): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO bid_invite_emails (invite_id, kind, subject, body)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (invite_id, kind) DO UPDATE
       SET status = 'queued', error = NULL, created_at = now(),
           subject = EXCLUDED.subject, body = EXCLUDED.body
       WHERE bid_invite_emails.status = 'failed'
          OR (bid_invite_emails.status = 'queued'
              AND bid_invite_emails.created_at < now() - interval '1 hour')
     RETURNING id`,
    [inviteId, kind, subject, body],
  );
  return row ? Number(row.id) : null;
}

/** Send a claimed email and settle the ledger row. Never throws — a failure
 *  marks the row 'failed' (re-claimable next sweep) and returns false. */
async function deliver(claimId: number, kind: BidEmailKind, r: ChaseRow): Promise<boolean> {
  const { subject, body } = compose(kind, r);
  try {
    await sendNewEmail({ to: r.email, subject, bodyText: body });
  } catch (e) {
    await query(`UPDATE bid_invite_emails SET status = 'failed', error = $2 WHERE id = $1`, [
      claimId,
      String((e as Error)?.message ?? e).slice(0, 300),
    ]);
    return false;
  }
  await query(`UPDATE bid_invite_emails SET status = 'sent', sent_at = now() WHERE id = $1`, [
    claimId,
  ]);
  await emit({
    kind: "job",
    tag: "Bid",
    accent: kind === "thanks" ? "money" : "accent",
    icon: "mail",
    title:
      kind === "thanks"
        ? `Thanked ${r.sub_name} for their bid — ${r.title}`
        : `Auto follow-up to ${r.sub_name} — ${r.title}`,
    subline: `${r.project_name} · ${kind === "working_nudge" ? "they're working on it" : kind === "thanks" ? "bid received" : "no answer yet"}`,
    href: `/projects/${r.slug}`,
  });
  return true;
}

const CHASE_SELECT = `
  SELECT i.id AS invite_id, s.name AS sub_name, btrim(s.email) AS email,
         b.title, p.name AS project_name, p.slug,
         to_char(b.due_date, 'FMMon FMDD') AS due_label,
         to_char(i.sent_at,  'FMMon FMDD') AS sent_label
    FROM bid_invites i
    JOIN bid_packages b ON b.id = i.package_id AND b.status = 'open' AND b.follow_ups
    JOIN projects p ON p.id = b.project_id
    JOIN subs s ON s.slug = i.sub_slug AND COALESCE(btrim(s.email), '') <> ''`;

export interface BidFollowUpResult {
  sent: number;
  failed: number;
  skipped: number;
  byKind: Record<string, number>;
}

/** The hourly sweep: send every due chase email and any thank-you that failed
 *  (or was missed) at record time. Safe to run repeatedly and concurrently —
 *  guard 4 makes both true. */
export async function runBidFollowUps(): Promise<BidFollowUpResult> {
  const result: BidFollowUpResult = { sent: 0, failed: 0, skipped: 0, byKind: {} };
  if (!gmailConfigured()) return result; // nothing can send; stay quiet

  let budget = MAX_SENDS_PER_RUN;

  for (const chase of CHASES) {
    if (budget <= 0) break;
    // chase.anchor is a compile-time constant from CHASES, never user input.
    const { rows } = await query<ChaseRow>(
      `${CHASE_SELECT}
        WHERE i.status = ANY($1)
          AND i.${chase.anchor} IS NOT NULL
          AND i.${chase.anchor} + make_interval(days => $2) <= now()
          AND i.${chase.anchor} + make_interval(days => $3) > now()
        ORDER BY i.${chase.anchor}
        LIMIT $4`,
      [chase.statuses, chase.minDays, chase.maxDays, budget],
    );
    for (const r of rows) {
      const { subject, body } = compose(chase.kind, r);
      const claimId = await claim(Number(r.invite_id), chase.kind, subject, body);
      if (!claimId) {
        result.skipped++;
        continue;
      }
      budget--;
      const ok = await deliver(claimId, chase.kind, r);
      result.sent += ok ? 1 : 0;
      result.failed += ok ? 0 : 1;
      if (ok) result.byKind[chase.kind] = (result.byKind[chase.kind] ?? 0) + 1;
    }
  }

  // Thank-you catch-up: recordBid sends this inline; the sweep only picks up
  // invites where that attempt failed (or never ran), and only recent ones.
  if (budget > 0) {
    const { rows } = await query<ChaseRow>(
      `${CHASE_SELECT}
        WHERE i.status = 'submitted'
          AND i.responded_at > now() - interval '7 days'
          AND NOT EXISTS (SELECT 1 FROM bid_invite_emails e
                           WHERE e.invite_id = i.id AND e.kind = 'thanks' AND e.status = 'sent')
        ORDER BY i.responded_at
        LIMIT $1`,
      [budget],
    );
    for (const r of rows) {
      const { subject, body } = compose("thanks", r);
      const claimId = await claim(Number(r.invite_id), "thanks", subject, body);
      if (!claimId) {
        result.skipped++;
        continue;
      }
      const ok = await deliver(claimId, "thanks", r);
      result.sent += ok ? 1 : 0;
      result.failed += ok ? 0 : 1;
      if (ok) result.byKind.thanks = (result.byKind.thanks ?? 0) + 1;
    }
  }

  return result;
}

/** Thank a sub the moment the owner records their bid. Best-effort: any miss
 *  here (Gmail hiccup, follow-ups off at the time) is either retried by the
 *  sweep or deliberately skipped — recordBid never fails because of it. */
export async function sendBidThanks(inviteId: number): Promise<{ sent: boolean; reason?: string }> {
  if (!gmailConfigured()) return { sent: false, reason: "gmail not configured" };
  const r = await queryOne<ChaseRow>(
    `${CHASE_SELECT} WHERE i.id = $1 AND i.status = 'submitted'`,
    [inviteId],
  );
  if (!r) return { sent: false, reason: "invite not eligible (follow-ups off, no email, or not submitted)" };
  const { subject, body } = compose("thanks", r);
  const claimId = await claim(Number(r.invite_id), "thanks", subject, body);
  if (!claimId) return { sent: false, reason: "already thanked" };
  const ok = await deliver(claimId, "thanks", r);
  return ok ? { sent: true } : { sent: false, reason: "send failed (sweep will retry)" };
}
