"use server";

// Bidding write paths. The owner assembles a package on the project's Bidding
// tab (title + trade, packet files, recipients grouped by trade, a per-sub
// note) and sends it — Send EMAILS the packet straight to each sub (see
// sendBidPackageOp). Bids come back to Joe's inbox; he records each number
// here (recordBid / declineBidInvite) so the compare view can line them up.
// Nothing bid-related touches the sub portal. Reads live in lib/bidding.ts,
// which also owns the send/award ops shared with the MCP bridge (which refuses
// send — transmitting email is owner-only).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { query, queryOne } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { emit } from "@/lib/notify";
import { storeUpload } from "@/lib/upload-store";
import { awardBidOp, bidInviteById, bidUsd, markBidWorkingOp, sendBidPackageOp } from "@/lib/bidding";
import { sendBidThanks } from "@/lib/bid-follow-ups";

type Result = { ok: boolean; error?: string };

function text(value: FormDataEntryValue | null, max = 300): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Dollars typed into a form → cents. Strips $ and commas; empty / bad → 0. */
function parseCents(value: FormDataEntryValue | null): number {
  const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

async function packageOwner(packageId: number) {
  return queryOne<{ id: number; slug: string; status: string; project_id: string }>(
    `SELECT b.id, b.status, b.project_id, p.slug
       FROM bid_packages b JOIN projects p ON p.id = b.project_id
      WHERE b.id = $1`,
    [packageId],
  );
}

// ─── Packages (owner) ────────────────────────────────────────────────────────

export async function createBidPackage(slug: string, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const project = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!project) return { ok: false, error: "Project not found." };

  const title = text(formData.get("title"), 200);
  if (!title) return { ok: false, error: "Name the work being bid (e.g. \"Framing — main house\")." };

  await query(
    `INSERT INTO bid_packages (project_id, title, trade, scope_notes, due_date)
     VALUES ($1, $2, $3, $4, NULLIF($5, '')::date)`,
    [
      project.id,
      title,
      text(formData.get("trade"), 80),
      text(formData.get("scopeNotes"), 4000),
      text(formData.get("dueDate"), 10),
    ],
  );
  revalidatePath(`/projects/${slug}`);
  return { ok: true };
}

export async function updateBidPackage(packageId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };

  const title = text(formData.get("title"), 200);
  if (!title) return { ok: false, error: "Name the work being bid." };

  await query(
    `UPDATE bid_packages
        SET title = $2, trade = $3, scope_notes = $4,
            due_date = NULLIF($5, '')::date, updated_at = now()
      WHERE id = $1`,
    [
      packageId,
      title,
      text(formData.get("trade"), 80),
      text(formData.get("scopeNotes"), 4000),
      text(formData.get("dueDate"), 10),
    ],
  );
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** Arm / disarm auto follow-ups for one package (chase nudges + thank-you —
 *  lib/bid-follow-ups.ts). Off means the hourly sweep skips every invite on
 *  the package and recordBid stops auto-thanking. */
export async function setBidFollowUps(packageId: number, enabled: boolean): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };
  await query(
    `UPDATE bid_packages SET follow_ups = $2, updated_at = now() WHERE id = $1`,
    [packageId, enabled],
  );
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** Delete a package. Refused once a bid has come back — submitted numbers are
 *  business records; close the package instead. */
export async function removeBidPackage(packageId: number): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };

  const bids = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM bid_submissions s JOIN bid_invites i ON i.id = s.invite_id
      WHERE i.package_id = $1`,
    [packageId],
  );
  if (bids && bids.n > 0) {
    return { ok: false, error: "Subs have already bid on this — close the package instead of deleting it." };
  }
  await query(`DELETE FROM bid_packages WHERE id = $1`, [packageId]);
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** Close bidding without awarding (work descoped, went another way, etc.). */
export async function closeBidPackage(packageId: number): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };
  await query(
    `UPDATE bid_packages SET status = 'closed', updated_at = now() WHERE id = $1`,
    [packageId],
  );
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

// ─── Packet files (owner) ────────────────────────────────────────────────────

/** Attach already-uploaded project files (plans, takeoff PDFs) to the packet.
 *  Only files scoped to this package's project can be attached — a stray id
 *  can't leak another project's documents to a sub. */
export async function attachBidFiles(packageId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };

  const fileIds = formData.getAll("fileId").map((v) => String(v)).filter(Boolean);
  if (fileIds.length === 0) return { ok: false, error: "Pick at least one file." };

  const { rows: valid } = await query<{ id: string }>(
    `SELECT f.id FROM files f
      WHERE f.id = ANY($1) AND f.storage_path IS NOT NULL
        AND f.project_key = (SELECT slug FROM projects WHERE id = $2)`,
    [fileIds, pkg.project_id],
  );
  if (valid.length === 0) return { ok: false, error: "Those files don't belong to this project." };

  for (const [i, row] of valid.entries()) {
    await query(
      `INSERT INTO bid_package_files (package_id, file_id, sort_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM bid_package_files WHERE package_id = $1), 0) + $3)
       ON CONFLICT (package_id, file_id) DO NOTHING`,
      [packageId, row.id, i],
    );
  }
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** Upload a new file straight into the packet (it also lands in the project's
 *  Files tab, like every other upload). */
export async function uploadBidFile(packageId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }
  const label = text(formData.get("label"), 120);

  const stored = await storeUpload(file, {
    idPrefix: "bid",
    projectKey: pkg.slug,
    tag: "BID PACKET",
    subtitle: label || "Bid packet file",
  });
  if (!stored.ok) return { ok: false, error: stored.error };

  await query(
    `INSERT INTO bid_package_files (package_id, file_id, label, sort_order)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 1 FROM bid_package_files WHERE package_id = $1), 0))`,
    [packageId, stored.id, label],
  );
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** Relabel a packet file ("takeoff-v3-final.pdf" → "Material takeoff"). */
export async function labelBidFile(id: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM bid_package_files bf
       JOIN bid_packages b ON b.id = bf.package_id
       JOIN projects p ON p.id = b.project_id
      WHERE bf.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Packet file not found." };
  await query(`UPDATE bid_package_files SET label = $2 WHERE id = $1`, [
    id,
    text(formData.get("label"), 120),
  ]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

/** Pull a file out of the packet. The files row itself survives. */
export async function removeBidFile(id: number): Promise<Result> {
  await requireRole("owner");
  const row = await queryOne<{ slug: string }>(
    `SELECT p.slug FROM bid_package_files bf
       JOIN bid_packages b ON b.id = bf.package_id
       JOIN projects p ON p.id = b.project_id
      WHERE bf.id = $1`,
    [id],
  );
  if (!row) return { ok: false, error: "Packet file not found." };
  await query(`DELETE FROM bid_package_files WHERE id = $1`, [id]);
  revalidatePath(`/projects/${row.slug}`);
  return { ok: true };
}

// ─── Recipients (owner) ──────────────────────────────────────────────────────

/** Add subs to a package as draft invites (nothing is visible to them until
 *  Send). Duplicates are ignored, so re-adding a trade group is safe. */
export async function addBidInvites(packageId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const pkg = await packageOwner(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };

  const slugs = formData.getAll("subSlug").map((v) => String(v)).filter(Boolean);
  if (slugs.length === 0) return { ok: false, error: "Pick at least one sub." };

  // One round trip for the whole pick, not one per sub.
  await query(
    `INSERT INTO bid_invites (package_id, sub_slug)
     SELECT $1, slug FROM subs WHERE slug = ANY($2)
     ON CONFLICT (package_id, sub_slug) DO NOTHING`,
    [packageId, slugs],
  );
  revalidatePath(`/projects/${pkg.slug}`);
  return { ok: true };
}

/** The per-sub note on top of the package scope — "your packet also covers the
 *  detached garage", etc. Editable before and after send. */
export async function updateBidInviteMessage(inviteId: number, formData: FormData): Promise<Result> {
  await requireRole("owner");
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  await query(`UPDATE bid_invites SET message = $2 WHERE id = $1`, [
    inviteId,
    text(formData.get("message"), 2000),
  ]);
  revalidatePath(`/projects/${invite.slug}`);
  return { ok: true };
}

/** Remove a recipient. Draft invites only — once sent, the sub has seen the
 *  request and the record stays. */
export async function removeBidInvite(inviteId: number): Promise<Result> {
  await requireRole("owner");
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  if (invite.status !== "draft") {
    return { ok: false, error: "This invite already went out — it can't be unpicked." };
  }
  await query(`DELETE FROM bid_invites WHERE id = $1`, [inviteId]);
  revalidatePath(`/projects/${invite.slug}`);
  return { ok: true };
}

// ─── Send / award (owner) ────────────────────────────────────────────────────

/** Emails the packet to every unsent sub (see sendBidPackageOp). Revalidates
 *  even on a not-ok result: a partial send (some emailed, one bounced, one with
 *  no address) reports the problem AND repaints the rows that did go out. */
export async function sendBidPackage(packageId: number): Promise<Result> {
  await requireRole("owner");
  const result = await sendBidPackageOp(packageId);
  const pkg = await packageOwner(packageId);
  if (pkg) revalidatePath(`/projects/${pkg.slug}`);
  revalidatePath("/notifications");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

/** The sub replied "we're on it" (email or phone) — record that so the auto
 *  chase switches to the softer, later check-in instead of the did-you-get-it
 *  nudges. */
export async function markBidWorking(inviteId: number): Promise<Result> {
  await requireRole("owner");
  const result = await markBidWorkingOp(inviteId);
  if (!result.ok) return { ok: false, error: result.error };
  const invite = await bidInviteById(inviteId);
  if (invite) revalidatePath(`/projects/${invite.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

export async function awardBid(inviteId: number): Promise<Result> {
  await requireRole("owner");
  const result = await awardBidOp(inviteId);
  if (!result.ok) return { ok: false, error: result.error };
  const invite = await bidInviteById(inviteId);
  if (invite) revalidatePath(`/projects/${invite.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

// ─── Recording what comes back (owner) ───────────────────────────────────────
//
// Bids arrive as email replies, so the owner transcribes each one here. Same
// tables the portal flow used to write, so compare/award are unchanged.

/** The invite must exist and have actually gone out. */
async function requireSentInvite(inviteId: number) {
  await requireRole("owner");
  const invite = await bidInviteById(inviteId);
  if (!invite) return { invite: null, error: "Bid invite not found." };
  if (invite.status === "draft") {
    return { invite: null, error: "This invite hasn't been emailed yet." };
  }
  return { invite, error: "" };
}

/** Record a bid that came back by email: a total (or line items that sum to
 *  one), optional exclusions / lead time / notes, and the sub's emailed quote
 *  as an upload. Re-recording files a new revision — compare reads the latest. */
export async function recordBid(inviteId: number, formData: FormData): Promise<Result> {
  const { invite, error } = await requireSentInvite(inviteId);
  if (!invite) return { ok: false, error };
  if (["awarded", "not_awarded"].includes(invite.status) || invite.package_status !== "open") {
    return { ok: false, error: "Bidding on this package has closed." };
  }

  // Line items: parallel arrays from the dynamic rows. Blank rows drop out.
  const descs = formData.getAll("lineDesc").map((v) => String(v).trim().slice(0, 300));
  const amounts = formData.getAll("lineAmount").map(parseCents);
  const lines = descs
    .map((description, i) => ({ description, amount: amounts[i] ?? 0 }))
    .filter((l) => l.description || l.amount > 0);

  const linesTotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = parseCents(formData.get("total")) || linesTotal;
  if (total <= 0) return { ok: false, error: "Enter your bid total (or line items that add up to one)." };

  const revision = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(revision) + 1, 1) AS next FROM bid_submissions WHERE invite_id = $1`,
    [inviteId],
  );
  const { rows: subRows } = await query<{ id: string }>(
    `INSERT INTO bid_submissions (invite_id, total, notes, exclusions, lead_time, revision)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      inviteId,
      total,
      text(formData.get("notes"), 4000),
      text(formData.get("exclusions"), 4000),
      text(formData.get("leadTime"), 200),
      revision?.next ?? 1,
    ],
  );
  const submissionId = Number(subRows[0].id);

  if (lines.length) {
    await query(
      `INSERT INTO bid_submission_lines (submission_id, description, amount, sort_order)
       SELECT $1, d, a, i - 1
       FROM unnest($2::text[], $3::bigint[]) WITH ORDINALITY AS t(d, a, i)`,
      [submissionId, lines.map((l) => l.description), lines.map((l) => l.amount)],
    );
  }

  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const stored = await storeUpload(entry, {
      idPrefix: "bid",
      projectKey: invite.slug,
      tag: "SUB BID",
      subtitle: `Bid · ${invite.sub_name} · ${invite.title}`,
    });
    if (!stored.ok) return { ok: false, error: stored.error };
    await query(
      `INSERT INTO bid_submission_files (submission_id, file_id) VALUES ($1, $2)`,
      [submissionId, stored.id],
    );
  }

  await query(
    `UPDATE bid_invites SET status = 'submitted', responded_at = now() WHERE id = $1`,
    [inviteId],
  );

  // Auto thank-you (only if the package's follow-ups switch is on). Best-effort
  // and deferred past the response: a Gmail round trip was what made "record a
  // bid" hang for seconds, and a hiccup here is retried by the hourly sweep,
  // never surfaced as a failure of recording the bid itself.
  after(async () => {
    try {
      await sendBidThanks(inviteId);
    } catch (err) {
      console.error("[bidding] thank-you send failed", err);
    }
  });

  await emit({
    kind: "money",
    tag: "Bid",
    accent: "money",
    icon: "money",
    title: `Bid in from ${invite.sub_name} — ${bidUsd(total)}`,
    subline: `${invite.project_name} · ${invite.title}`,
    href: `/projects/${invite.slug}`,
  });
  revalidatePath(`/projects/${invite.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}

/** The sub passed (said so by email or phone). The optional reason rides the
 *  notification so the owner's log says whether to re-scope or just move on. */
export async function declineBidInvite(inviteId: number, formData: FormData): Promise<Result> {
  const { invite, error } = await requireSentInvite(inviteId);
  if (!invite) return { ok: false, error };
  if (["submitted", "awarded", "not_awarded", "declined"].includes(invite.status)) {
    return { ok: false, error: "This bid has already been answered." };
  }

  await query(
    `UPDATE bid_invites SET status = 'declined', responded_at = now() WHERE id = $1`,
    [inviteId],
  );
  const reason = text(formData.get("reason"), 1000);

  await emit({
    kind: "job",
    tag: "Bid",
    accent: "flag",
    icon: "mail",
    flagged: true,
    title: `${invite.sub_name} passed on ${invite.title}`,
    subline: `${invite.project_name}${reason ? ` · "${reason.slice(0, 80)}"` : ""}`,
    href: `/projects/${invite.slug}`,
  });
  revalidatePath(`/projects/${invite.slug}`);
  revalidatePath("/notifications");
  return { ok: true };
}
