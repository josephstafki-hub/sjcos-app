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
import { normalizeSettings, type IssueSettings } from "@/lib/newsletter-design";
import { enrollRecipient, enrollAllInSequence, listSequences, type Sequence } from "@/lib/newsletter-drip";
import { storeBuffer } from "@/lib/upload-store";
import { prepareNewsletterImage } from "@/lib/newsletter-image";
import type { NewsletterBlock, BlockKind, OutboxItem } from "@/lib/newsletter";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const BLOCK_KINDS: BlockKind[] = ["text", "image", "button", "divider", "quote"];

/** Sanitize the blocks array coming from the client editor. Length-capped per
 *  field and kind-validated; the renderer trusts whatever survives this. */
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
    // A divider carries no content and an image is defined by its token, so the
    // old "drop anything without text" filter would have deleted both on save.
    .filter(
      (b) =>
        b.kind === "divider" ||
        (b.kind === "image" && b.imageToken) ||
        (b.kind === "button" && b.buttonLabel && b.buttonUrl) ||
        b.heading ||
        b.body,
    );
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
  settings?: IssueSettings,
): Promise<Result> {
  await requireRole("owner");
  const res = await query(
    `UPDATE newsletters
        SET title = $2, intro = $3, blocks = $4::jsonb, settings = $5::jsonb, updated_at = now()
      WHERE id = $1 AND status = 'draft'`,
    [
      id,
      title.trim().slice(0, 200) || "Untitled issue",
      intro.trim().slice(0, 8000),
      JSON.stringify(cleanBlocks(blocks)),
      JSON.stringify(normalizeSettings(settings)),
    ],
  );
  if (res.rowCount === 0) return { ok: false, error: "Issue not found or already sent." };
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Upload a photo for use inside an issue and publish it for email delivery.
 *  Returns the public token the block stores. Owner-only.
 *
 *  Publishing is the point: the stored blob is owner-only like every other
 *  upload, and this mints the one capability token that lets a recipient's mail
 *  client fetch that single image (see app/api/newsletter/img/[token]). */
export async function uploadIssueImage(form: FormData): Promise<Result<{ token: string }>> {
  await requireRole("owner");

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file selected." };
  if (!(file.type || "").startsWith("image/")) return { ok: false, error: "Only image files are allowed here." };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "That image is too large (max 25 MB)." };

  // Downscale + strip EXIF before anything is written to disk — see
  // lib/newsletter-image.ts for why this path re-encodes when /files does not.
  const prepared = await prepareNewsletterImage(Buffer.from(await file.arrayBuffer()), file.name);
  if (!prepared) return { ok: false, error: "That file isn't a readable image." };

  const stored = await storeBuffer(prepared.bytes, {
    filename: prepared.filename,
    mime: prepared.mime,
    idPrefix: "nl",
    tag: "newsletter",
    subtitle: `Newsletter photo · ${prepared.width}×${prepared.height}`,
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  const alt = String(form.get("alt") ?? "").trim().slice(0, 200);
  const row = await queryOne<{ token: string }>(
    `INSERT INTO newsletter_assets (file_id, alt) VALUES ($1, $2) RETURNING token`,
    [stored.id, alt],
  );
  if (!row) return { ok: false, error: "Could not publish the image." };
  return { ok: true, data: { token: row.token } };
}

/** Delete an issue. Owner-only.
 *
 *  Was draft-only, which made every queued or sent issue permanently
 *  undeletable — and because the SQL matched no rows while the client removed the
 *  card optimistically, deleting *looked* like it worked until the next reload.
 *  Now any issue can be removed:
 *    • queued — the parked outbox rows are dropped first, so nothing survives
 *      that could still be Released. This is an un-queue plus a delete.
 *    • sent   — allowed, but the delivery record is KEPT. The outbox FK is
 *      ON DELETE CASCADE, so released rows are detached (newsletter_id → NULL)
 *      before the delete; their frozen subject/body still says what was mailed
 *      to whom. A tidy-up click must never destroy the audit trail.
 *
 *  `confirmSent` forces the caller to acknowledge it is removing a sent issue —
 *  the client asks a different question for that case. */
export async function deleteIssue(id: number, confirmSent = false): Promise<Result> {
  await requireRole("owner");

  // ── Validate FIRST, mutate second ──
  // Every rejection below has to happen before the outbox is touched. An earlier
  // version ran the sequence-step check after detaching/deleting outbox rows, so
  // a *refused* delete still destroyed that issue's parked sends and unlinked its
  // delivery history — the caller saw "can't delete", the data was already gone.
  const issue = await queryOne<{ status: string }>(`SELECT status FROM newsletters WHERE id = $1`, [id]);
  if (!issue) return { ok: false, error: "Issue not found." };
  if (issue.status === "sent" && !confirmSent) {
    return { ok: false, error: "This issue was already sent — confirm to remove it from the list." };
  }
  // Steps referencing it would cascade away, silently shortening a running
  // sequence — surface that instead of doing it behind Joe's back.
  const inUse = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM newsletter_sequence_steps WHERE newsletter_id = $1`,
    [id],
  );
  if ((inUse?.n ?? 0) > 0) {
    return { ok: false, error: "This issue is a step in an automation — remove it there first." };
  }

  // ── Mutate ──
  // Two statements, ordered so that a failure between them is harmless. They are
  // deliberately NOT combined into one statement with data-modifying CTEs: those
  // sub-statements all see the same snapshot and can't observe each other, and
  // the FK cascade fires as an after-trigger, so the detach below would race the
  // cascade rather than reliably preceding it.
  //
  // 1. Detach the delivery record. The outbox FK is ON DELETE CASCADE and a sent
  //    issue's rows ARE the proof of what was mailed to whom, so they're unlinked
  //    before anything is deleted. If step 2 never runs, the worst case is
  //    history detached from an issue that still exists — the rows keep their
  //    frozen subject/body and nothing is lost.
  await query(
    `UPDATE newsletter_outbox SET newsletter_id = NULL
      WHERE newsletter_id = $1 AND status IN ('released', 'skipped')`,
    [id],
  );
  // 2. Delete the issue. The cascade now takes exactly the rows we want it to —
  //    the queued/failed ones still attached, which were never emailed.
  await query(`DELETE FROM newsletters WHERE id = $1`, [id]);
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
  // Then enroll them in any ACTIVE drip sequence — that one DOES send on its own.
  if (row) {
    try {
      await enqueueGreeting(row.id, e, row.name);
      await enrollRecipient(row.id);
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
      await enrollRecipient(r.id);
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

// ─── Drip sequences ─────────────────────────────────────────────────────────
// Unlike everything above, an ACTIVE sequence mails real people without a
// Release click. The safety reasoning lives at the top of lib/newsletter-drip.ts;
// the actions here just make sure a sequence can only ever be switched on
// deliberately, by the owner, with its steps already in place.

/** Create a new (inactive) sequence. Owner-only. */
export async function createSequence(name: string): Promise<Result<number>> {
  await requireRole("owner");
  const row = await queryOne<{ id: number }>(
    `INSERT INTO newsletter_sequences (name) VALUES ($1) RETURNING id`,
    [name.trim().slice(0, 120) || "Welcome series"],
  );
  revalidatePath("/newsletter");
  return { ok: true, data: row!.id };
}

export async function renameSequence(id: number, name: string): Promise<Result> {
  await requireRole("owner");
  await query(`UPDATE newsletter_sequences SET name = $2 WHERE id = $1`, [
    id,
    name.trim().slice(0, 120) || "Welcome series",
  ]);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Turn a sequence on or off. Turning it ON is the moment automated sending
 *  becomes possible, so it is guarded: a sequence with no steps can't be armed,
 *  and every step must point at an issue with real content. Switching on also
 *  enrolls the existing list with the clock starting NOW (see enrollAllInSequence
 *  — back-dating would fire every past-due step immediately). */
export async function setSequenceActive(id: number, active: boolean): Promise<Result<{ enrolled: number }>> {
  await requireRole("owner");

  if (active) {
    const steps = await queryOne<{ n: number; empty: number }>(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE n.intro = '' AND n.blocks = '[]'::jsonb)::int AS empty
         FROM newsletter_sequence_steps t
         JOIN newsletters n ON n.id = t.newsletter_id
        WHERE t.sequence_id = $1`,
      [id],
    );
    if ((steps?.n ?? 0) === 0) return { ok: false, error: "Add at least one step before turning this on." };
    if ((steps?.empty ?? 0) > 0) return { ok: false, error: "One of the steps is still an empty issue — write it first." };
  }

  await query(`UPDATE newsletter_sequences SET active = $2 WHERE id = $1`, [id, active]);
  const enrolled = active ? await enrollAllInSequence(id) : 0;
  revalidatePath("/newsletter");
  return { ok: true, data: { enrolled } };
}

/** Delete a sequence and everything enrolled in it. Owner-only. */
export async function deleteSequence(id: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM newsletter_sequences WHERE id = $1`, [id]);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Append an issue to a sequence as a step firing `delayDays` after signup. */
export async function addSequenceStep(
  sequenceId: number,
  newsletterId: number,
  delayDays: number,
): Promise<Result> {
  await requireRole("owner");
  const days = Math.max(0, Math.min(3650, Math.round(Number(delayDays) || 0)));
  const dupe = await queryOne<{ id: number }>(
    `SELECT id FROM newsletter_sequence_steps WHERE sequence_id = $1 AND newsletter_id = $2`,
    [sequenceId, newsletterId],
  );
  // The outbox's one-drip-per-(issue,email) index would silently swallow the
  // second send anyway — reject it here where it can be explained instead.
  if (dupe) return { ok: false, error: "That issue is already a step in this sequence." };
  await query(
    `INSERT INTO newsletter_sequence_steps (sequence_id, newsletter_id, delay_days, position)
     VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM newsletter_sequence_steps WHERE sequence_id = $1), 0))`,
    [sequenceId, newsletterId, days],
  );
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Re-time a step. Delays are absolute offsets from signup, so this only moves
 *  the one step. Subscribers who already passed it are unaffected. */
export async function updateSequenceStep(stepId: number, delayDays: number): Promise<Result> {
  await requireRole("owner");
  const days = Math.max(0, Math.min(3650, Math.round(Number(delayDays) || 0)));
  await query(`UPDATE newsletter_sequence_steps SET delay_days = $2 WHERE id = $1`, [stepId, days]);
  revalidatePath("/newsletter");
  return { ok: true };
}

export async function removeSequenceStep(stepId: number): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM newsletter_sequence_steps WHERE id = $1`, [stepId]);
  revalidatePath("/newsletter");
  return { ok: true };
}

/** Re-read sequences after a mutation so the client can drop optimistic state. */
export async function refreshSequences(): Promise<Sequence[]> {
  await requireRole("owner");
  return listSequences();
}
