import "server-only";

// Newsletter drip sequences (P7-N). Plain server helpers — called by the owner-
// gated actions in lib/actions/newsletter.ts and by the CRON_SECRET-gated route
// at /api/cron/newsletter-drip.
//
// ─── READ THIS BEFORE CHANGING ANYTHING HERE ────────────────────────────────
// Everywhere else in the newsletter feature, mail reaches a real person only
// when the owner clicks Release. This module is the deliberate exception: a
// welcome sequence that waits on a human isn't a welcome sequence. Joe chose
// this explicitly, scoped to the drip only — broadcast sends keep their gate.
//
// The exception is fenced by five guards, and every one of them is load-bearing:
//   1. Sequences ship INACTIVE. Nothing sends until the owner flips one on.
//   2. Only issues referenced by a step of an ACTIVE sequence can be sent, and
//      only to the single subscriber whose step came due — there is no code path
//      here that mails the whole list.
//   3. Recipients must still be active=true; unsubscribing cancels in-flight
//      subscriptions (see the unsubscribe route), so opt-out is immediate.
//   4. The outbox row is inserted BEFORE Gmail is called, against a unique index
//      on (newsletter_id, email) WHERE kind='drip'. A conflict means "already
//      sent" and we skip. That is what makes the timer's at-least-once retry
//      safe: a re-run, an overlapping run, or a crashed run cannot double-send.
//   5. MAX_SENDS_PER_RUN caps the blast radius of any mistake to a number Joe
//      can clean up by hand.
// Removing any of these turns a nice feature into a way to mail the entire
// client list by accident.

import { query, queryOne } from "./db";
import { sendNewEmail } from "./gmail";
import { renderIssueHtml, renderIssueText } from "./newsletter-render";
import { baseUrl, loadRenderableIssue, withOpenPixel } from "./newsletter-outbox";

/** Hard ceiling per timer run. The timer runs hourly, so a real backlog still
 *  drains quickly, but a bad sequence definition can't empty itself into every
 *  inbox in one pass. */
const MAX_SENDS_PER_RUN = 50;

export interface Sequence {
  id: number;
  name: string;
  active: boolean;
  steps: SequenceStep[];
  subscriberCount: number;
}

export interface SequenceStep {
  id: number;
  newsletterId: number;
  issueTitle: string;
  issueStatus: string;
  delayDays: number;
  position: number;
}

/** Read every sequence with its steps and live subscriber count. */
export async function listSequences(): Promise<Sequence[]> {
  const { rows: seqs } = await query<{ id: number; name: string; active: boolean; subs: number }>(
    `SELECT s.id, s.name, s.active,
            (SELECT count(*)::int FROM newsletter_subscriptions x
              WHERE x.sequence_id = s.id AND x.status = 'active') AS subs
       FROM newsletter_sequences s
      ORDER BY s.created_at DESC, s.id DESC`,
  );
  if (seqs.length === 0) return [];

  const { rows: steps } = await query<{
    id: number;
    sequence_id: number;
    newsletter_id: number;
    title: string;
    status: string;
    delay_days: number;
    position: number;
  }>(
    `SELECT t.id, t.sequence_id, t.newsletter_id, n.title, n.status, t.delay_days, t.position
       FROM newsletter_sequence_steps t
       JOIN newsletters n ON n.id = t.newsletter_id
      ORDER BY t.delay_days, t.position, t.id`,
  );

  return seqs.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    subscriberCount: s.subs,
    steps: steps
      .filter((t) => t.sequence_id === s.id)
      .map((t) => ({
        id: t.id,
        newsletterId: t.newsletter_id,
        issueTitle: t.title,
        issueStatus: t.status,
        delayDays: t.delay_days,
        position: t.position,
      })),
  }));
}

/** Enroll a recipient in every ACTIVE sequence. Called when a contact is added.
 *  Idempotent per (recipient, sequence) via the unique constraint — re-adding an
 *  existing contact never restarts their series. */
export async function enrollRecipient(recipientId: number): Promise<void> {
  await query(
    `INSERT INTO newsletter_subscriptions (recipient_id, sequence_id)
     SELECT $1, id FROM newsletter_sequences WHERE active = true
     ON CONFLICT (recipient_id, sequence_id) DO NOTHING`,
    [recipientId],
  );
}

/** When a sequence is switched on, enroll everyone already on the list.
 *  Their clock starts NOW, not at the date they were originally added — otherwise
 *  turning a sequence on would instantly fire every past-due step at every
 *  existing contact at once. */
export async function enrollAllInSequence(sequenceId: number): Promise<number> {
  const res = await query(
    `INSERT INTO newsletter_subscriptions (recipient_id, sequence_id, subscribed_at)
     SELECT id, $1, now() FROM newsletter_recipients WHERE active = true
     ON CONFLICT (recipient_id, sequence_id) DO NOTHING`,
    [sequenceId],
  );
  return res.rowCount ?? 0;
}

interface DueRow {
  subscription_id: number;
  recipient_id: number;
  email: string;
  name: string;
  unsub_token: string;
  newsletter_id: number;
  step_total: number;
}

/** Find subscriptions whose next step is due. "Next step" is the (sent_steps+1)-th
 *  step by (delay_days, position); it comes due once subscribed_at + delay_days
 *  has passed. Delays are absolute offsets from subscribing, so re-timing one step
 *  never shifts the others. */
async function findDue(limit: number): Promise<DueRow[]> {
  const { rows } = await query<DueRow>(
    `WITH ordered AS (
       SELECT t.*, row_number() OVER (
                PARTITION BY t.sequence_id ORDER BY t.delay_days, t.position, t.id
              ) AS step_no,
              count(*) OVER (PARTITION BY t.sequence_id) AS step_total
         FROM newsletter_sequence_steps t
     )
     SELECT sub.id           AS subscription_id,
            r.id             AS recipient_id,
            r.email, r.name, r.unsub_token,
            o.newsletter_id,
            o.step_total::int AS step_total
       FROM newsletter_subscriptions sub
       JOIN newsletter_sequences seq ON seq.id = sub.sequence_id AND seq.active = true
       JOIN newsletter_recipients r  ON r.id  = sub.recipient_id  AND r.active = true
       JOIN ordered o ON o.sequence_id = sub.sequence_id AND o.step_no = sub.sent_steps + 1
       JOIN newsletters n ON n.id = o.newsletter_id
      WHERE sub.status = 'active'
        AND sub.subscribed_at + (o.delay_days || ' days')::interval <= now()
      ORDER BY sub.subscribed_at
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export interface DripResult {
  sent: number;
  skipped: number;
  failed: number;
  completed: number;
}

/** Advance every due subscription by one step. Safe to run repeatedly and safe to
 *  run concurrently — guard 4 (the unique index) is what makes both true. */
export async function runDrip(): Promise<DripResult> {
  const result: DripResult = { sent: 0, skipped: 0, failed: 0, completed: 0 };
  const due = await findDue(MAX_SENDS_PER_RUN);
  const base = baseUrl();

  for (const row of due) {
    const loaded = await loadRenderableIssue(row.newsletter_id);
    if (!loaded) {
      // Step points at a deleted issue — advance past it rather than wedging the
      // subscriber permanently on a step that can never send.
      await advance(row, result);
      result.skipped++;
      continue;
    }

    const opts = { baseUrl: base, unsubToken: row.unsub_token };
    const subject = loaded.issue.title.trim() || "SJ Carpentry LLC";
    const text = renderIssueText(loaded.issue, opts);
    const html = renderIssueHtml(loaded.issue, opts);

    // Claim the send FIRST. If the unique index rejects it, this issue already
    // went to this address — advance without sending.
    const claimed = await queryOne<{ id: number; track_token: string }>(
      `INSERT INTO newsletter_outbox
         (kind, newsletter_id, recipient_id, email, name, subject, body, body_html, status)
       VALUES ('drip', $1, $2, $3, $4, $5, $6, $7, 'queued')
       ON CONFLICT (newsletter_id, email) WHERE kind = 'drip' DO NOTHING
       RETURNING id, track_token`,
      [row.newsletter_id, row.recipient_id, row.email, row.name, subject, text, html],
    );
    if (!claimed) {
      await advance(row, result);
      result.skipped++;
      continue;
    }

    try {
      await sendNewEmail({
        to: row.email,
        subject,
        bodyText: text,
        bodyHtml: withOpenPixel(html, claimed.track_token),
      });
      await query(
        `UPDATE newsletter_outbox SET status = 'released', released_at = now() WHERE id = $1`,
        [claimed.id],
      );
      await advance(row, result);
      result.sent++;
    } catch (e) {
      // Leave the row 'failed' — it stays visible in the Outbox and the owner can
      // Release it by hand. The subscription does NOT advance, so a transient
      // Gmail error means "retry next hour", not "silently skip this step".
      await query(`UPDATE newsletter_outbox SET status = 'failed', error = $2 WHERE id = $1`, [
        claimed.id,
        String((e as Error)?.message ?? e).slice(0, 300),
      ]);
      result.failed++;
    }
  }

  return result;
}

/** Move a subscription one step forward, closing it out once the last step lands. */
async function advance(row: DueRow, result: DripResult): Promise<void> {
  const done = await queryOne<{ status: string }>(
    `UPDATE newsletter_subscriptions
        SET sent_steps = sent_steps + 1,
            last_sent_at = now(),
            status = CASE WHEN sent_steps + 1 >= $2 THEN 'done' ELSE status END
      WHERE id = $1
      RETURNING status`,
    [row.subscription_id, row.step_total],
  );
  if (done?.status === "done") result.completed++;
}
