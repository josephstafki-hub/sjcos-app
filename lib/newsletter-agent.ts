import "server-only";

// Agent-facing newsletter operations (MCP surface). Plain server helpers — NOT
// "use server". They are reached ONLY through app/api/internal/newsletter, which
// is bearer-gated by CRON_SECRET (a trusted local caller, not a browser session),
// so they intentionally do NOT call requireRole. The owner-gated Server Actions
// in lib/actions/newsletter.ts stay the browser path; these mirror the same DB
// work for an MCP client.
//
// ─── THE SAFETY LINE (do not move it) ───────────────────────────────────────
// This module can read the list, manage recipients, compose/queue issues (the
// welcome email included — it's just the one issue with is_welcome=true, edited
// through the same update_issue tool as any other), and enroll a new contact
// into whatever drip the OWNER has already armed. It CANNOT send: there is no
// Release here and no setSequenceActive here. Queueing parks rows in
// newsletter_outbox exactly like the Queue button — the owner still clicks
// Release in /newsletter for a single byte to reach a real inbox. Adding a
// recipient enrolls them in ACTIVE sequences (the welcome drip the owner turned
// on), which is the one path that then mails on its own — that is deliberate and
// pre-existing (see lib/newsletter-drip.ts guards); arming a sequence stays a
// human action in the app. Keep it that way.

import { query, queryOne } from "./db";
import { enqueueIssue, enqueueGreeting } from "./newsletter-outbox";
import { enrollRecipient } from "./newsletter-drip";
import { getTemplate } from "./newsletter-templates";
import type { NewsletterBlock, BlockKind } from "./newsletter";

export type AgentResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const BLOCK_KINDS: BlockKind[] = ["text", "image", "button", "divider", "quote"];

/** Sanitize blocks handed in by an agent — same shape/limits the browser editor
 *  enforces (mirrors cleanBlocks in lib/actions/newsletter.ts). The renderer
 *  trusts whatever survives this, so it stays strict. */
function cleanBlocks(blocks: unknown): NewsletterBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .slice(0, 60)
    .map((raw) => {
      const b = (raw ?? {}) as NewsletterBlock;
      const kind: BlockKind = BLOCK_KINDS.includes(b.kind as BlockKind) ? (b.kind as BlockKind) : "text";
      const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
      return {
        kind,
        heading: str(b.heading, 200),
        body: str(b.body, 4000),
        projectSlug: str(b.projectSlug, 80) || undefined,
        imageToken: str(b.imageToken, 80) || undefined,
        imageAlt: str(b.imageAlt, 200) || undefined,
        caption: str(b.caption, 300) || undefined,
        buttonLabel: str(b.buttonLabel, 60) || undefined,
        buttonUrl: str(b.buttonUrl, 500) || undefined,
        align: b.align === "left" ? ("left" as const) : ("center" as const),
      };
    })
    .filter(
      (b) =>
        b.kind === "divider" ||
        (b.kind === "image" && b.imageToken) ||
        (b.kind === "button" && b.buttonLabel && b.buttonUrl) ||
        b.heading ||
        b.body,
    );
}

// ─── The email list ─────────────────────────────────────────────────────────

/** Full recipient list (both active + inactive), newest-relevant first. */
export async function agentListRecipients(): Promise<
  { id: number; email: string; name: string; active: boolean }[]
> {
  return (
    await query<{ id: number; email: string; name: string; active: boolean }>(
      `SELECT id, email, name, active FROM newsletter_recipients ORDER BY active DESC, name, email`,
    )
  ).rows;
}

/** Add (or reactivate) a recipient. Idempotent on email. Parks a one-time welcome
 *  greeting for the owner to Release, and enrolls the contact into every ACTIVE
 *  drip sequence — mirrors addRecipient. This is the "start the welcome sequence
 *  for any email they add" path: it only auto-sends if the owner has armed a
 *  sequence; otherwise the greeting simply waits in the Outbox. */
export async function agentAddRecipient(
  email: string,
  name = "",
): Promise<AgentResult<{ id: number; email: string; name: string; enrolledDrips: boolean }>> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email." };
  const row = await queryOne<{ id: number; name: string }>(
    `INSERT INTO newsletter_recipients (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET name = COALESCE(NULLIF(EXCLUDED.name, ''), newsletter_recipients.name), active = true
     RETURNING id, name`,
    [e, String(name ?? "").trim().slice(0, 120)],
  );
  if (!row) return { ok: false, error: "Could not add recipient." };
  let enrolledDrips = false;
  try {
    await enqueueGreeting(row.id, e, row.name);
    await enrollRecipient(row.id);
    const armed = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM newsletter_sequences WHERE active = true`,
    );
    enrolledDrips = (armed?.n ?? 0) > 0;
  } catch {
    /* best-effort — never block adding a recipient */
  }
  return { ok: true, data: { id: row.id, email: e, name: row.name, enrolledDrips } };
}

/** Update a recipient's display name and/or active flag. Match by id or email. */
export async function agentUpdateRecipient(
  ref: { id?: number; email?: string },
  patch: { name?: string; active?: boolean },
): Promise<AgentResult<{ id: number; email: string; name: string; active: boolean }>> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof patch.name === "string") {
    params.push(patch.name.trim().slice(0, 120));
    sets.push(`name = $${params.length}`);
  }
  if (typeof patch.active === "boolean") {
    params.push(patch.active);
    sets.push(`active = $${params.length}`);
  }
  if (sets.length === 0) return { ok: false, error: "Nothing to update (pass name and/or active)." };
  let where: string;
  if (typeof ref.id === "number") {
    params.push(ref.id);
    where = `id = $${params.length}`;
  } else if (ref.email) {
    params.push(ref.email.trim().toLowerCase());
    where = `email = $${params.length}`;
  } else {
    return { ok: false, error: "Pass a recipient id or email." };
  }
  const row = await queryOne<{ id: number; email: string; name: string; active: boolean }>(
    `UPDATE newsletter_recipients SET ${sets.join(", ")} WHERE ${where}
     RETURNING id, email, name, active`,
    params,
  );
  if (!row) return { ok: false, error: "Recipient not found." };
  return { ok: true, data: row };
}

/** Remove a recipient. Match by id or email. */
export async function agentRemoveRecipient(ref: {
  id?: number;
  email?: string;
}): Promise<AgentResult<{ removed: number }>> {
  let res;
  if (typeof ref.id === "number") {
    res = await query(`DELETE FROM newsletter_recipients WHERE id = $1`, [ref.id]);
  } else if (ref.email) {
    res = await query(`DELETE FROM newsletter_recipients WHERE email = $1`, [ref.email.trim().toLowerCase()]);
  } else {
    return { ok: false, error: "Pass a recipient id or email." };
  }
  return { ok: true, data: { removed: res.rowCount ?? 0 } };
}

/** Import every active client user's email onto the list. Parks a greeting +
 *  enrolls each NEWLY added contact (no backfill blast). Mirrors importClientRecipients. */
export async function agentImportClientRecipients(): Promise<AgentResult<{ added: number }>> {
  // Mirrors importKnownRecipients in lib/actions/newsletter.ts: client-portal
  // logins, leads, and each project's client email (or its lead's, as a
  // fallback) — not just users.role='client', which is empty until someone
  // claims a portal invite.
  const inserted = await query<{ id: number; email: string; name: string }>(
    `INSERT INTO newsletter_recipients (email, name)
     SELECT email, min(name) AS name FROM (
       SELECT lower(email) AS email, COALESCE(name, '') AS name
         FROM users WHERE role = 'client' AND active = true AND email <> ''
       UNION ALL
       SELECT lower(email), COALESCE(name, '') FROM leads WHERE email <> ''
       UNION ALL
       SELECT lower(client_email), COALESCE(NULLIF(client_name, ''), '')
         FROM projects WHERE client_email <> ''
       UNION ALL
       SELECT lower(l.email), COALESCE(NULLIF(p.client_name, ''), l.name, '')
         FROM projects p JOIN leads l ON l.id = p.lead_id
        WHERE p.client_email = '' AND l.email <> ''
     ) x
     GROUP BY email
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name`,
  );
  for (const r of inserted.rows) {
    try {
      await enqueueGreeting(r.id, r.email, r.name);
      await enrollRecipient(r.id);
    } catch {
      /* best-effort */
    }
  }
  return { ok: true, data: { added: inserted.rowCount ?? 0 } };
}

// ─── Issues ──────────────────────────────────────────────────────────────────

/** Compact issue list for an agent to pick from. `is_welcome` marks the one
 *  issue the welcome-greeting pipeline sends from — edit it like any other
 *  draft via update_issue; it's excluded from queue_issue (see enqueueIssue). */
export async function agentListIssues(): Promise<
  { id: number; title: string; status: string; recipient_count: number; block_count: number; is_welcome: boolean }[]
> {
  return (
    await query<{
      id: number;
      title: string;
      status: string;
      recipient_count: number;
      block_count: number;
      is_welcome: boolean;
    }>(
      `SELECT id, title, status, recipient_count, is_welcome,
              jsonb_array_length(COALESCE(blocks, '[]'::jsonb)) AS block_count
         FROM newsletters ORDER BY created_at DESC, id DESC`,
    )
  ).rows;
}

/** Full editable content of one issue. */
export async function agentGetIssue(id: number): Promise<AgentResult<Record<string, unknown>>> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT id, title, intro, blocks, template, status, recipient_count, is_welcome FROM newsletters WHERE id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Issue not found." };
  return { ok: true, data: row };
}

/** Create a new draft issue from a template. Returns its id. */
export async function agentCreateIssue(templateKey?: string): Promise<AgentResult<{ id: number }>> {
  const tpl = getTemplate(templateKey);
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  const row = await queryOne<{ id: number }>(
    `INSERT INTO newsletters (title, template, intro, blocks, status)
     VALUES ($1, $2, $3, $4::jsonb, 'draft') RETURNING id`,
    [title, tpl.key, tpl.starterIntro, JSON.stringify(tpl.starterBlocks)],
  );
  return { ok: true, data: { id: row!.id } };
}

/** Edit a DRAFT issue's title / intro / blocks. Blocked once queued or sent —
 *  the same lock the browser editor enforces. Any field omitted is left as-is. */
export async function agentUpdateIssue(
  id: number,
  patch: { title?: string; intro?: string; blocks?: unknown },
): Promise<AgentResult> {
  const cur = await queryOne<{ title: string; intro: string; status: string }>(
    `SELECT title, intro, status FROM newsletters WHERE id = $1`,
    [id],
  );
  if (!cur) return { ok: false, error: "Issue not found." };
  if (cur.status !== "draft") return { ok: false, error: "This issue is queued or sent — it can't be edited." };
  const title = (typeof patch.title === "string" ? patch.title : cur.title).trim().slice(0, 200) || "Untitled issue";
  const intro = (typeof patch.intro === "string" ? patch.intro : cur.intro).trim().slice(0, 8000);
  // Blocks only touched when supplied, so a title-only edit never wipes content.
  if (patch.blocks !== undefined) {
    await query(
      `UPDATE newsletters SET title = $2, intro = $3, blocks = $4::jsonb, updated_at = now()
        WHERE id = $1 AND status = 'draft'`,
      [id, title, intro, JSON.stringify(cleanBlocks(patch.blocks))],
    );
  } else {
    await query(
      `UPDATE newsletters SET title = $2, intro = $3, updated_at = now()
        WHERE id = $1 AND status = 'draft'`,
      [id, title, intro],
    );
  }
  return { ok: true };
}

/** QUEUE an issue: parks one row per targeted recipient in the outbox and flips
 *  the issue to 'queued'. `groupIds`, when given, scopes the send to those
 *  audiences (deduped so a multi-group member gets one copy); omitted or empty
 *  means every active recipient. NOTHING is emailed — the owner Releases each
 *  row in /newsletter. This is the agent's "send" and it stops one step short
 *  on purpose. */
export async function agentQueueIssue(id: number, groupIds?: number[]): Promise<AgentResult<{ queued: number }>> {
  const res = await enqueueIssue(id, groupIds);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not queue." };
  return { ok: true, data: { queued: res.queued ?? 0 } };
}

/** Mark (or unmark) an issue as THE welcome email sent to new contacts. Marking
 *  a new one atomically displaces whatever was welcome before (the partial
 *  unique index allows only one). */
export async function agentSetWelcomeIssue(id: number, on: boolean): Promise<AgentResult> {
  if (on) {
    await query(`UPDATE newsletters SET is_welcome = (id = $1) WHERE is_welcome = true OR id = $1`, [id]);
  } else {
    await query(`UPDATE newsletters SET is_welcome = false WHERE id = $1`, [id]);
  }
  return { ok: true };
}

/** Audiences (email groups) recipients can belong to, with live member counts —
 *  read-only here; creating/renaming/assigning membership stays a browser
 *  action in the Recipients tab (lib/actions/newsletter.ts) for now. */
export async function agentListGroups(): Promise<AgentResult<{ id: number; name: string; members: number }[]>> {
  const rows = (
    await query<{ id: number; name: string; members: number }>(
      `SELECT g.id, g.name, count(m.recipient_id)::int AS members
         FROM newsletter_groups g
         LEFT JOIN newsletter_recipient_groups m ON m.group_id = g.id
        GROUP BY g.id, g.name
        ORDER BY g.name`,
    )
  ).rows;
  return { ok: true, data: rows };
}
