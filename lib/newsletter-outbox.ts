// Newsletter parked-send outbox (P2-5). Plain server helpers (NOT "use server" —
// called from the already-owner-gated Server Actions in lib/actions/newsletter.ts).
//
// The GATE: newsletter issue-sends and auto-greeting emails are ENQUEUED here as
// 'queued' and NOTHING reaches a real recipient until the owner clicks Release
// (releaseOutboxItem) — the only function in the whole feature that calls Gmail.
// No cron/hook/effect invokes it; that manual click IS the gate. Mirrors the
// P1-D4 portal_deliveries doctrine. Enqueue is best-effort — its callers wrap it
// in try/catch so a queue hiccup never blocks adding a recipient or a save.

import { captureAgentMemory } from "./agent-memory";
import { issueText, materialDiff } from "./agent-draft-diff";
import { query, queryOne } from "./db";
import { sendNewEmail } from "./gmail";
import { normalizeSettings } from "./newsletter-design";
import { renderIssueHtml, renderIssueText } from "./newsletter-render";
import type { NewsletterBlock } from "./newsletter";

export function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

/** Load an issue in the shape the renderer wants. Shared by the broadcast enqueue
 *  and the drip engine so both produce identical mail for the same issue. */
export async function loadRenderableIssue(newsletterId: number) {
  const row = await queryOne<{
    title: string;
    intro: string;
    blocks: NewsletterBlock[];
    settings: unknown;
    status: string;
    is_welcome: boolean;
    extra_recipients: unknown;
  }>(
    `SELECT title, intro, blocks, settings, status, is_welcome, extra_recipients FROM newsletters WHERE id = $1`,
    [newsletterId],
  );
  if (!row) return null;
  return {
    status: row.status,
    isWelcome: row.is_welcome,
    extraRecipients: Array.isArray(row.extra_recipients)
      ? (row.extra_recipients as { email: string; name: string }[])
      : [],
    issue: {
      title: row.title,
      intro: row.intro,
      blocks: Array.isArray(row.blocks) ? row.blocks : [],
      settings: normalizeSettings(row.settings),
    },
  };
}

/** Enqueue one issue-send row per targeted recipient and flip the issue to
 *  'queued'. Idempotent per (issue, email). Returns how many rows are queued.
 *
 *  `groupIds`, when non-empty, scopes the send to active recipients belonging
 *  to ANY of those audiences — DISTINCT on recipient id is the redundancy
 *  screen: someone in two selected groups still gets exactly one email, while
 *  their membership in both groups is untouched (this only reads
 *  newsletter_recipient_groups, never writes it). Omitted/empty means every
 *  active recipient, same as before audiences existed. */
export async function enqueueIssue(
  newsletterId: number,
  groupIds?: number[],
): Promise<{ ok: boolean; queued?: number; error?: string }> {
  const loaded = await loadRenderableIssue(newsletterId);
  if (!loaded) return { ok: false, error: "Issue not found." };
  if (loaded.isWelcome) {
    return { ok: false, error: "This is the welcome email — it sends automatically to new contacts, not through Queue." };
  }
  if (loaded.status === "sent") return { ok: false, error: "This issue was already sent." };
  if (loaded.status === "queued") return { ok: false, error: "This issue is already queued." };

  const targeted = (
    groupIds && groupIds.length > 0
      ? await query<{ id: number; email: string; name: string; unsub_token: string }>(
          `SELECT DISTINCT r.id, r.email, r.name, r.unsub_token
             FROM newsletter_recipients r
             JOIN newsletter_recipient_groups g ON g.recipient_id = r.id
            WHERE r.active = true AND g.group_id = ANY($1)`,
          [groupIds],
        )
      : await query<{ id: number; email: string; name: string; unsub_token: string }>(
          `SELECT id, email, name, unsub_token FROM newsletter_recipients WHERE active = true`,
        )
  ).rows;

  // One-time additions (this issue's extra_recipients) ride along as their own
  // rows — recipient_id NULL (the column is nullable for exactly this), no
  // unsubscribe token since they're not a tracked recipient. A duplicate of an
  // already-targeted email is harmless: the (newsletter_id, email) unique index
  // just no-ops the second INSERT below.
  const recipients: { id: number | null; email: string; name: string; unsub_token: string }[] = [
    ...targeted,
    ...loaded.extraRecipients.map((e) => ({ id: null, email: e.email, name: e.name, unsub_token: "" })),
  ];
  if (recipients.length === 0) return { ok: false, error: "No active recipients — add some first." };

  const subject = loaded.issue.title.trim() || "SJ Carpentry LLC";
  const base = baseUrl();

  // Rendered per-recipient rather than once: each body carries that person's own
  // unsubscribe token, so the frozen row is exactly what they received.
  for (const r of recipients) {
    const opts = { baseUrl: base, unsubToken: r.unsub_token };
    await query(
      `INSERT INTO newsletter_outbox (kind, newsletter_id, recipient_id, email, name, subject, body, body_html)
       VALUES ('issue', $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (newsletter_id, email) WHERE kind = 'issue' DO NOTHING`,
      [
        newsletterId,
        r.id,
        r.email,
        r.name,
        subject,
        renderIssueText(loaded.issue, opts),
        renderIssueHtml(loaded.issue, opts),
      ],
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

/** Escape text landing inside HTML — used only for the `{name}` fill below,
 *  since a recipient's name is untrusted input reaching a rendered email. */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Enqueue a parked welcome-greeting for a newly added contact, rendered from
 *  the one issue flagged newsletters.is_welcome — same renderer, photos, and
 *  buttons as any broadcast issue, just personalized. `{name}` in the title,
 *  intro, or any block is filled with the recipient's name (or "there").
 *  One per address ever (partial unique index). No-op if no welcome issue is
 *  configured, or if already queued/sent to that email. */
export async function enqueueGreeting(recipientId: number, email: string, name: string): Promise<void> {
  const welcome = await queryOne<{ id: number }>(`SELECT id FROM newsletters WHERE is_welcome = true LIMIT 1`);
  if (!welcome) return;
  const loaded = await loadRenderableIssue(welcome.id);
  if (!loaded) return;

  const recip = await queryOne<{ unsub_token: string }>(
    `SELECT unsub_token FROM newsletter_recipients WHERE id = $1`,
    [recipientId],
  );
  const opts = { baseUrl: baseUrl(), unsubToken: recip?.unsub_token ?? "" };
  const who = name.trim() || "there";
  const fill = (s: string) => s.replace(/\{name\}/g, who);
  const fillHtml = (s: string) => s.replace(/\{name\}/g, escHtml(who));

  const subject = fill(loaded.issue.title.trim() || "SJ Carpentry LLC");
  const text = fill(renderIssueText(loaded.issue, opts));
  const html = fillHtml(renderIssueHtml(loaded.issue, opts));

  await query(
    `INSERT INTO newsletter_outbox (kind, recipient_id, email, name, subject, body, body_html)
     VALUES ('greeting', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) WHERE kind = 'greeting' DO NOTHING`,
    [recipientId, email.toLowerCase(), name.trim(), subject, text, html],
  );
}

/** Append the 1×1 open pixel to an already-rendered HTML body. The pixel can't be
 *  baked in at enqueue — track_token is generated by the INSERT — so it's tacked
 *  on at release. Trailing position is fine; clients load it either way. */
export function withOpenPixel(html: string, trackToken: string): string {
  return (
    html +
    `<img src="${baseUrl()}/api/newsletter/open/${trackToken}" width="1" height="1" alt="" style="border:0;width:1px;height:1px">`
  );
}

/** Escape + wrap a plain-text body as HTML and append the 1×1 open-tracking pixel.
 *  Legacy path: used for greetings (still plain text) and for any pre-P7-N outbox
 *  row queued before body_html existed. */
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
  const row = await queryOne<{
    email: string;
    subject: string;
    body: string;
    body_html: string | null;
    track_token: string;
    newsletter_id: number | null;
  }>(
    `UPDATE newsletter_outbox
        SET status = 'released', released_at = now(), error = NULL
      WHERE id = $1 AND status IN ('queued', 'failed')
      RETURNING email, subject, body, body_html, track_token, newsletter_id`,
    [id],
  );
  if (!row) return { ok: false, error: "Already released or not found." };
  try {
    await sendNewEmail({
      to: row.email,
      subject: row.subject,
      bodyText: row.body,
      // Rich issues carry their rendered HTML; greetings and pre-P7-N rows fall
      // back to wrapping the frozen text.
      bodyHtml: row.body_html
        ? withOpenPixel(row.body_html, row.track_token)
        : htmlBody(row.body, row.track_token),
    });
  } catch (e) {
    await query(
      `UPDATE newsletter_outbox SET status = 'failed', released_at = NULL, error = $2 WHERE id = $1`,
      [id, String((e as Error)?.message ?? e).slice(0, 300)],
    );
    return { ok: false, error: "Gmail send failed — left as failed to retry." };
  }
  await captureAgentEditMemory(row.newsletter_id);
  await settleIssueIfDrained(row.newsletter_id);
  return { ok: true };
}

/** W5 learning layer: on the FIRST released row of an issue, diff what went out
 *  against what the agent queued (agent_submitted_snapshot, set in
 *  agentQueueIssue). A material difference means Joe edited the issue before
 *  releasing — park that as a pending preference memory. The snapshot is
 *  consumed atomically so the per-recipient release loop captures at most once,
 *  and an unedited release leaves no memory at all. */
async function captureAgentEditMemory(newsletterId: number | null): Promise<void> {
  if (!newsletterId) return;
  try {
    const row = await queryOne<{
      snap: { title: string; intro: string; blocks: unknown };
      title: string;
      intro: string;
      blocks: unknown;
    }>(
      `WITH old AS (
         SELECT id, agent_submitted_snapshot AS snap, title, intro, blocks FROM newsletters
          WHERE id = $1 AND agent_submitted_snapshot IS NOT NULL FOR UPDATE
       )
       UPDATE newsletters n SET agent_submitted_snapshot = NULL
         FROM old WHERE n.id = old.id
       RETURNING old.snap, old.title, old.intro, old.blocks`,
      [newsletterId],
    );
    if (!row?.snap) return;
    const diff = materialDiff(issueText(row.snap), issueText(row));
    if (!diff) return;
    await captureAgentMemory({
      summary: `Joe edited newsletter issue "${row.title}" before release`,
      content: `Changed lines (agent version → released version):\n${diff}`,
      memoryType: "preference",
      refs: [{ kind: "newsletter_issue", id: String(newsletterId), label: row.title }],
    });
  } catch (err) {
    console.error("[agent-memory] newsletter edit capture failed:", err instanceof Error ? err.message : err);
  }
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
