// Newsletter parked-send outbox (P2-5). Plain server helpers (NOT "use server" —
// called from the already-owner-gated Server Actions in lib/actions/newsletter.ts).
//
// The GATE: newsletter issue-sends and auto-greeting emails are ENQUEUED here as
// 'queued' and NOTHING reaches a real recipient until the owner clicks Release
// (releaseOutboxItem) — the only function in the whole feature that calls Gmail.
// No cron/hook/effect invokes it; that manual click IS the gate. Mirrors the
// P1-D4 portal_deliveries doctrine. Enqueue is best-effort — its callers wrap it
// in try/catch so a queue hiccup never blocks adding a recipient or a save.

import { query, queryOne } from "./db";
import { sendNewEmail } from "./gmail";
import { composeIssueEmail, greetingEmail } from "./newsletter-templates";
import type { NewsletterBlock } from "./newsletter";

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

/** Enqueue one issue-send row per active recipient and flip the issue to 'queued'.
 *  Idempotent per (issue, email). Returns how many rows are queued. */
export async function enqueueIssue(newsletterId: number): Promise<{ ok: boolean; queued?: number; error?: string }> {
  const issue = await queryOne<{ title: string; intro: string; blocks: NewsletterBlock[]; template: string; status: string }>(
    `SELECT title, intro, blocks, template, status FROM newsletters WHERE id = $1`,
    [newsletterId],
  );
  if (!issue) return { ok: false, error: "Issue not found." };
  if (issue.status === "sent") return { ok: false, error: "This issue was already sent." };
  if (issue.status === "queued") return { ok: false, error: "This issue is already queued." };

  const recipients = (
    await query<{ id: number; email: string; name: string }>(
      `SELECT id, email, name FROM newsletter_recipients WHERE active = true`,
    )
  ).rows;
  if (recipients.length === 0) return { ok: false, error: "No active recipients — add some first." };

  const { subject, body } = composeIssueEmail(
    issue.template,
    issue.title,
    issue.intro,
    Array.isArray(issue.blocks) ? issue.blocks : [],
  );

  for (const r of recipients) {
    await query(
      `INSERT INTO newsletter_outbox (kind, newsletter_id, recipient_id, email, name, subject, body)
       VALUES ('issue', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (newsletter_id, email) WHERE kind = 'issue' DO NOTHING`,
      [newsletterId, r.id, r.email, r.name, subject, body],
    );
  }
  const queued = (
    await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM newsletter_outbox WHERE newsletter_id = $1 AND status = 'queued'`,
      [newsletterId],
    )
  )?.n ?? 0;
  await query(
    `UPDATE newsletters SET status = 'queued', recipient_count = $2, updated_at = now() WHERE id = $1`,
    [newsletterId, queued],
  );
  return { ok: true, queued };
}

/** Enqueue a parked welcome-greeting for a newly added contact. One per address
 *  ever (partial unique index). No-op if already queued/sent to that email. */
export async function enqueueGreeting(recipientId: number, email: string, name: string): Promise<void> {
  const { subject, body } = greetingEmail(name);
  await query(
    `INSERT INTO newsletter_outbox (kind, recipient_id, email, name, subject, body)
     VALUES ('greeting', $1, $2, $3, $4, $5)
     ON CONFLICT (email) WHERE kind = 'greeting' DO NOTHING`,
    [recipientId, email.toLowerCase(), name.trim(), subject, body],
  );
}

/** Escape + wrap a plain-text body as HTML and append the 1×1 open-tracking pixel. */
function htmlBody(text: string, trackToken: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  // Visible 1×1 (no display:none — many clients skip hidden images) tucked at the end.
  const pixel = `<img src="${baseUrl()}/api/newsletter/open/${trackToken}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`;
  return `<div style="font-family:Georgia,serif;font-size:14px;line-height:1.6;color:#1c1c1c">${paras}${pixel}</div>`;
}

/** RELEASE — the ONLY Gmail-sending path in the newsletter feature. Owner-clicked
 *  only; never auto-invoked. Guarded so a double-click / retry is a safe no-op. */
export async function releaseOutboxItem(id: number): Promise<{ ok: boolean; error?: string }> {
  const row = await queryOne<{ email: string; subject: string; body: string; track_token: string; newsletter_id: number | null }>(
    `UPDATE newsletter_outbox
        SET status = 'released', released_at = now(), error = NULL
      WHERE id = $1 AND status IN ('queued', 'failed')
      RETURNING email, subject, body, track_token, newsletter_id`,
    [id],
  );
  if (!row) return { ok: false, error: "Already released or not found." };
  try {
    await sendNewEmail({
      to: row.email,
      subject: row.subject,
      bodyText: row.body,
      bodyHtml: htmlBody(row.body, row.track_token),
    });
  } catch (e) {
    await query(
      `UPDATE newsletter_outbox SET status = 'failed', released_at = NULL, error = $2 WHERE id = $1`,
      [id, String((e as Error)?.message ?? e).slice(0, 300)],
    );
    return { ok: false, error: "Gmail send failed — left as failed to retry." };
  }
  await settleIssueIfDrained(row.newsletter_id);
  return { ok: true };
}

/** SKIP — drop a queued/failed row without sending (stale recipient, etc.). */
export async function skipOutboxItem(id: number): Promise<{ ok: boolean }> {
  const row = await queryOne<{ newsletter_id: number | null }>(
    `UPDATE newsletter_outbox SET status = 'skipped' WHERE id = $1 AND status IN ('queued', 'failed')
     RETURNING newsletter_id`,
    [id],
  );
  if (row) await settleIssueIfDrained(row.newsletter_id);
  return { ok: true };
}

/** Once no rows for an issue are still 'queued'/'failed', settle it: 'sent' if at
 *  least one was released, otherwise revert to 'draft' (a queue that was entirely
 *  skipped is not a send — leave it re-queueable rather than bricked as sent·0). */
async function settleIssueIfDrained(newsletterId: number | null): Promise<void> {
  if (!newsletterId) return;
  const pending = (
    await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM newsletter_outbox
        WHERE newsletter_id = $1 AND status IN ('queued', 'failed')`,
      [newsletterId],
    )
  )?.n ?? 0;
  if (pending > 0) return;
  const released = (
    await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM newsletter_outbox WHERE newsletter_id = $1 AND status = 'released'`,
      [newsletterId],
    )
  )?.n ?? 0;
  if (released > 0) {
    await query(
      `UPDATE newsletters SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now()
        WHERE id = $1 AND status <> 'sent'`,
      [newsletterId, released],
    );
  } else {
    await query(
      `UPDATE newsletters SET status = 'draft', recipient_count = 0, updated_at = now()
        WHERE id = $1 AND status = 'queued'`,
      [newsletterId],
    );
  }
}
