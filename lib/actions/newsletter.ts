"use server";

// Newsletter write paths (Phase-7). Owner-gated. Issue CRUD, AI drafting of the
// intro + per-project blocks (Qwen), recipient management, and sending the issue
// to the recipient list via Gmail. Reads stay in lib/newsletter.ts.

import { revalidatePath } from "next/cache";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { ai } from "@/lib/ai";
import { sendNewEmailAction } from "@/lib/actions/inbox";
import type { NewsletterBlock } from "@/lib/newsletter";

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

/** Create a new draft issue titled for the current month. Returns its id. */
export async function createIssue(): Promise<number> {
  await requireRole("owner");
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date());
  const row = await queryOne<{ id: number }>(
    `INSERT INTO newsletters (title, status) VALUES ($1, 'draft') RETURNING id`,
    [title],
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
  await query(
    `INSERT INTO newsletter_recipients (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), newsletter_recipients.name), active = true`,
    [e, name.trim().slice(0, 120)],
  );
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
  const res = await query(
    `INSERT INTO newsletter_recipients (email, name)
     SELECT lower(email), COALESCE(name, '') FROM users
      WHERE role = 'client' AND active = true AND email <> ''
     ON CONFLICT (email) DO NOTHING`,
  );
  revalidatePath("/newsletter");
  return { ok: true, data: res.rowCount ?? 0 };
}

/** Compose the plain-text email body for an issue. */
function composeEmail(intro: string, blocks: NewsletterBlock[]): string {
  const parts: string[] = [];
  if (intro.trim()) parts.push(intro.trim());
  for (const b of blocks) {
    const seg = [b.heading ? b.heading.toUpperCase() : "", b.body].filter(Boolean).join("\n");
    if (seg) parts.push(seg);
  }
  parts.push("—\nSJ Carpentry LLC\nReply to this email any time.");
  return parts.join("\n\n");
}

/** Send the issue to every active recipient via Gmail, then mark it sent.
 *  Owner-only. Best-effort per recipient; counts the successes. */
export async function sendIssue(id: number): Promise<Result<{ sent: number; failed: number }>> {
  await requireRole("owner");
  const issue = await queryOne<{ title: string; intro: string; blocks: NewsletterBlock[]; status: string }>(
    `SELECT title, intro, blocks, status FROM newsletters WHERE id = $1`,
    [id],
  );
  if (!issue) return { ok: false, error: "Issue not found." };
  if (issue.status === "sent") return { ok: false, error: "This issue was already sent." };

  const recipients = (
    await query<{ email: string }>(`SELECT email FROM newsletter_recipients WHERE active = true`)
  ).rows;
  if (recipients.length === 0) return { ok: false, error: "No active recipients — add some first." };

  const body = composeEmail(issue.intro, Array.isArray(issue.blocks) ? issue.blocks : []);
  const subject = issue.title;

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    try {
      const res = await sendNewEmailAction({ to: r.email, subject, body });
      if (res.ok) sent++;
      else failed++;
    } catch {
      failed++;
    }
  }

  await query(
    `UPDATE newsletters SET status = 'sent', sent_at = now(), recipient_count = $2, updated_at = now() WHERE id = $1`,
    [id, sent],
  );
  await emit({
    kind: "job",
    tag: "Newsletter",
    accent: "accent",
    icon: "mail",
    title: `Newsletter sent · ${issue.title}`,
    subline: `Delivered to ${sent} recipient${sent === 1 ? "" : "s"}${failed ? ` · ${failed} failed` : ""}`,
    href: "/newsletter",
  });
  revalidatePath("/newsletter");
  return { ok: true, data: { sent, failed } };
}
