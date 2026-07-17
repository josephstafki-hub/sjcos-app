"use server";

// Newsletter write paths (P2-5). Owner-gated. Issue CRUD, template seeding, AI
// drafting of the intro + per-project blocks, recipient management + auto-greeting,
// and a two-phase send: Queue parks the issue in newsletter_outbox, then the owner
// Releases each row (the only path that touches Gmail — lib/newsletter-outbox.ts).
// Nothing here ever sends to a real recipient on its own. Reads: lib/newsletter.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { ai } from "@/lib/ai";
import { getTemplate } from "@/lib/newsletter-templates";
import { enqueueIssue, enqueueGreeting, releaseOutboxItem, skipOutboxItem } from "@/lib/newsletter-outbox";
import { readOutbox } from "@/lib/newsletter";
import type { NewsletterBlock, OutboxItem } from "@/lib/newsletter";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/** Sanitize the blocks array coming from the client editor. */
function cleanBlocks(blocks: unknown): NewsletterBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((b) => {
      const heading = String((b as NewsletterBlock)?.heading ?? "").trim().slice(0, 200);
      const body = String((b as NewsletterBlock)?.body ?? "").trim().slice(0, 4000);
      const projectSlug = String((b as NewsletterBlock)?.projectSlug ?? "").trim().slice(0, 80) || undefined;
      return { heading, body, projectSlug };
    })
    .filter((b) => b.heading || b.body);
}

/** Create a new draft issue from a template, seeding its starter intro/blocks.
 *  Titled for the current month. Returns its id. */
export async function createIssue(templateKey?: string): Promise<number> {
  await requireRole("owner");
  const tpl = getTemplate(templateKey);
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  const row = await queryOne<{ id: number }>(
    `INSERT INTO newsletters (title, template, intro, blocks, status)
     VALUES ($1, $2, $3, $4::jsonb, 'draft') RETURNING id`,
    [title, tpl.key, tpl.starterIntro, JSON.stringify(tpl.starterBlocks)],
  );
  revalidatePath("/newsletter");
  return row!.id;
}

/** Persist an issue's editable content. Blocked once sent. Owner-only. */
export async function saveIssue(
  id: number,
  title: string,
  intro: string,
  blocks: NewsletterBlock[],
): Promise<Result> {
  await requireRole("owner");
  const res = await query(
    `UPDATE newsletters
        SET title = $2, intro = $3, blocks = $4::jsonb, updated_at = now()
      WHERE id = $1 AND status = 'draft'`,
    [id, title.trim().slice(0, 200) || "Untitled issue", intro.trim().slice(0, 8000), JSON.stringify(cleanBlocks(blocks))],
  );
  if (res.rowCount === 0) return { ok: false, error: "Issue not found or already sent." };
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Delete a draft issue. Owner-only. */
export async function deleteIssue(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM newsletters WHERE id = $1 AND status = 'draft'`, [id]);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Qwen drafts an intro from the issue's current blocks. Returns the text (the
 *  client folds it into the editor + saves). Owner-only. */
export async function draftIntro(id: number): Promise<Result<string>> {
  await requireRole("owner");
  const issue = await queryOne<{ title: string; blocks: NewsletterBlock[] }>(
    `SELECT title, blocks FROM newsletters WHERE id = $1`,
    [id],
  );
  if (!issue) return { ok: false, error: "Issue not found." };
  const topics = (Array.isArray(issue.blocks) ? issue.blocks : [])
    .map((b) => `- ${b.heading}${b.body ? `: ${b.body.slice(0, 160)}` : ""}`)
    .join("\n");
  try {
    const res = await ai.ask({
      prompt:
        `Write a warm, brief newsletter intro (2–3 sentences) for SJ Carpentry LLC's "${issue.title}" ` +
        `issue — a residential carpentry/remodeling firm writing to past and current clients. Friendly and ` +
        `craftsman, not salesy. Sign-off is added separately.\n\n` +
        `This issue covers:\n${topics || "(general update)"}\n\nOnly reference what's listed.`,
    });
    const answer = (res.answer ?? "").trim();
    return answer ? { ok: true, data: answer } : { ok: false, error: "No draft returned." };
  } catch {
    return { ok: false, error: "Drafting failed — try again." };
  }
}

/** Qwen drafts a content block celebrating a completed project. Returns a block
 *  the client inserts. Owner-only. */
export async function draftBlockForProject(projectSlug: string): Promise<Result<NewsletterBlock>> {
  await requireRole("owner");
  const proj = await queryOne<{ name: string; scope: string | null; city: string | null }>(
    `SELECT name, sub_label AS scope, address AS city FROM projects WHERE slug = $1`,
    [projectSlug],
  );
  if (!proj) return { ok: false, error: "Project not found." };
  const where = proj.city ? ` in ${proj.city}` : "";
  try {
    const res = await ai.ask({
      prompt:
        `Write a short newsletter blurb (2–3 sentences) for SJ Carpentry LLC celebrating a completed ` +
        `project: "${proj.name}"${proj.scope ? ` (${proj.scope})` : ""}${where}. Warm, concrete, craftsman ` +
        `voice. Do NOT invent client names, prices, or specifics not implied.`,
    });
    const body = (res.answer ?? "").trim();
    return { ok: true, data: { heading: proj.name, body, projectSlug } };
  } catch {
    return { ok: false, error: "Drafting failed — try again." };
  }
}

/** Add a recipient (idempotent on email). Owner-only. */
export async function addRecipient(email: string, name: string): Promise<Result> {
  await requireRole("owner");
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email." };
  const row = await queryOne<{ id: number; name: string }>(
    `INSERT INTO newsletter_recipients (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), newsletter_recipients.name), active = true
     RETURNING id, name`,
    [e, name.trim().slice(0, 120)],
  );
  // Auto-greeting: park a welcome email (one per address ever; owner releases it).
  if (row) {
    try {
      await enqueueGreeting(row.id, e, row.name);
    } catch {
      /* best-effort — never block adding a recipient */
    }
  }
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Remove a recipient. Owner-only. */
export async function removeRecipient(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM newsletter_recipients WHERE id = $1`, [id]);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Import every client user's email as a recipient. Returns how many were added.
 *  Owner-only. */
export async function importClientRecipients(): Promise<Result<number>> {
  await requireRole("owner");
  const inserted = await query<{ id: number; email: string; name: string }>(
    `INSERT INTO newsletter_recipients (email, name)
     SELECT lower(email), COALESCE(name, '') FROM users
      WHERE role = 'client' AND active = true AND email <> ''
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name`,
  );
  // Park a greeting for each NEWLY added contact only (no backfill blast).
  for (const r of inserted.rows) {
    try {
      await enqueueGreeting(r.id, r.email, r.name);
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/newsletter");
  return { ok: true, data: inserted.rowCount ?? 0 };
}

/** QUEUE the issue for sending — parks one row per active recipient in the
 *  newsletter_outbox and flips the issue to 'queued'. Nothing is emailed here;
 *  the owner then Releases each row. Owner-only. */
export async function queueIssue(id: number): Promise<Result<{ queued: number }>> {
  await requireRole("owner");
  const res = await enqueueIssue(id);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not queue." };
  revalidatePath("/newsletter");
  return { ok: true, data: { queued: res.queued ?? 0 } };
}

/** RELEASE one parked outbox row — this is the only path that emails a real
 *  person (via Gmail). Owner-clicked only; never auto-invoked. */
export async function releaseNewsletterItem(id: number): Promise<Result> {
  await requireRole("owner");
  const res = await releaseOutboxItem(id);
  if (!res.ok) return { ok: false, error: res.error ?? "Release failed." };
  revalidatePath("/newsletter");
  return { ok: true };
}

/** SKIP a parked outbox row without sending (stale recipient, etc.). Owner-only. */
export async function skipNewsletterItem(id: number): Promise<Result> {
  await requireRole("owner");
  await skipOutboxItem(id);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Re-read the parked outbox (owner-only) so the client can swap optimistic rows
 *  for the real persisted ones after a queue/release/skip/greeting. */
export async function refreshOutbox(): Promise<OutboxItem[]> {
  await requireRole("owner");
  return readOutbox();
}
