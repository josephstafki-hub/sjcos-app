import "server-only";

// Bidding reads + shared ops. A bid package is a request for pricing on one
// category of work: the packet (plans + takeoffs out of the files table) goes
// to several subs at once, each through an invite that can carry a note
// written just for them. Bids are EMAIL — Send transmits the packet (scope,
// per-sub note, files attached) straight to each sub's inbox via the Gmail
// connector, and nothing about a bid touches the sub portal. Replies come back
// to Joe's inbox; the numbers are recorded on the board (recordBidOp — Joe's
// Record bid button, or an agent's record_bid), and the compare view lines them
// up side by side.
//
// BECAUSE Send now emails real people, it is owner-only: only the button on
// the Bidding tab (a click by Joe) reaches sendBidPackageOp. The MCP bridge
// (app/api/internal/bidding/route.ts) refuses send — agents stage packages
// (files, invites, notes) and Joe transmits. This is the standing rule that
// client-facing sends stay owner-approved.

import { after } from "next/server";
import { sendBidThanks } from "./bid-follow-ups";
import { query, queryOne } from "./db";
import { gmailConfigured, sendNewEmail } from "./gmail";
import { MAX_ATTACHMENT_BYTES, readAttachments } from "./mail-attachments";
import { emit } from "./notify";
import { readUpload } from "./uploads";

export type BidPackageStatus = "draft" | "open" | "awarded" | "closed";
export type BidInviteStatus =
  | "draft"
  | "sent"
  | "viewed"
  /** Sub replied that they're pricing it — chased softer, later. */
  | "working"
  | "submitted"
  | "declined"
  | "awarded"
  | "not_awarded";

export interface BidFile {
  /** bid_package_files row id (owner removes by this). */
  id: number;
  fileId: string;
  name: string;
  label: string;
  sizeLabel: string;
  type: "doc" | "img";
}

export interface BidLine {
  description: string;
  /** Cents. */
  amount: number;
}

export interface BidSubmission {
  id: number;
  /** Cents. */
  total: number;
  notes: string;
  exclusions: string;
  leadTime: string;
  revision: number;
  whenLabel: string;
  lines: BidLine[];
  files: { fileId: string; name: string }[];
}

export interface BidInvite {
  id: number;
  subSlug: string;
  subName: string;
  subTrade: string;
  subEmail: string | null;
  message: string;
  status: BidInviteStatus;
  sentLabel: string;
  respondedLabel: string;
  /** Last auto email that went to this sub ("nudged Aug 20" / "thanked Aug 22"),
   *  "" if none — see lib/bid-follow-ups.ts. */
  autoLabel: string;
  /** Latest revision, if a bid has been recorded. */
  submission: BidSubmission | null;
}

export interface BidPackage {
  id: number;
  title: string;
  trade: string;
  scopeNotes: string;
  /** YYYY-MM-DD or "" — feeds the date input. */
  dueDate: string;
  dueLabel: string;
  status: BidPackageStatus;
  sentLabel: string;
  /** Auto follow-up arm switch: chase + thank-you emails (lib/bid-follow-ups.ts). */
  followUps: boolean;
  awardedInviteId: number | null;
  files: BidFile[];
  invites: BidInvite[];
  submittedCount: number;
  /** Lowest submitted total in cents, null until a bid lands. */
  lowTotal: number | null;
}

export interface BiddingView {
  packages: BidPackage[];
  /** Distinct trades across packages, for the tab's filter chips. */
  trades: string[];
}

export const EMPTY_BIDDING_VIEW: BiddingView = { packages: [], trades: [] };

/** Cents → "$12,500" (whole dollars — bids are priced, not accounted). */
export function bidUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

// ─── Assembling submissions (shared by both read sides) ──────────────────────

interface SubmissionRow {
  id: string;
  invite_id: string;
  total: number;
  notes: string;
  exclusions: string;
  lead_time: string;
  revision: number;
  when_label: string;
}

/** Latest submission per invite, with lines + files attached. Keyed by invite id. */
async function latestSubmissions(inviteIds: number[]): Promise<Map<number, BidSubmission>> {
  const map = new Map<number, BidSubmission>();
  if (inviteIds.length === 0) return map;

  const { rows: subs } = await query<SubmissionRow>(
    `SELECT DISTINCT ON (invite_id)
            id, invite_id, total, notes, exclusions, lead_time, revision,
            to_char(submitted_at, 'FMMon FMDD') AS when_label
       FROM bid_submissions
      WHERE invite_id = ANY($1::bigint[])
      ORDER BY invite_id, revision DESC`,
    [inviteIds],
  );
  if (subs.length === 0) return map;
  const subIds = subs.map((s) => Number(s.id));

  const [lines, files] = await Promise.all([
    query<{ submission_id: string; description: string; amount: number }>(
      `SELECT submission_id, description, amount
         FROM bid_submission_lines
        WHERE submission_id = ANY($1::bigint[])
        ORDER BY submission_id, sort_order, id`,
      [subIds],
    ),
    query<{ submission_id: string; file_id: string; name: string }>(
      `SELECT sf.submission_id, sf.file_id, f.name
         FROM bid_submission_files sf JOIN files f ON f.id = sf.file_id
        WHERE sf.submission_id = ANY($1::bigint[])
        ORDER BY sf.created_at`,
      [subIds],
    ),
  ]);

  for (const s of subs) {
    const sid = Number(s.id);
    map.set(Number(s.invite_id), {
      id: sid,
      total: s.total,
      notes: s.notes,
      exclusions: s.exclusions,
      leadTime: s.lead_time,
      revision: s.revision,
      whenLabel: s.when_label,
      lines: lines.rows
        .filter((l) => Number(l.submission_id) === sid)
        .map((l) => ({ description: l.description, amount: l.amount })),
      files: files.rows
        .filter((f) => Number(f.submission_id) === sid)
        .map((f) => ({ fileId: f.file_id, name: f.name })),
    });
  }
  return map;
}

// ─── Owner read (the project Bidding tab) ────────────────────────────────────

export async function getProjectBidding(slug: string): Promise<BiddingView> {
  const project = await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  if (!project) return EMPTY_BIDDING_VIEW;

  const { rows: pkgs } = await query<{
    id: string;
    title: string;
    trade: string;
    scope_notes: string;
    due_date: string | null;
    due_label: string | null;
    status: BidPackageStatus;
    sent_label: string | null;
    follow_ups: boolean;
    awarded_invite_id: string | null;
  }>(
    `SELECT id, title, trade, scope_notes, status, follow_ups, awarded_invite_id,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            to_char(due_date, 'FMMon FMDD') AS due_label,
            to_char(sent_at, 'FMMon FMDD')  AS sent_label
       FROM bid_packages
      WHERE project_id = $1
      ORDER BY status = 'closed', trade, created_at DESC`,
    [project.id],
  );
  if (pkgs.length === 0) return EMPTY_BIDDING_VIEW;
  const pkgIds = pkgs.map((p) => Number(p.id));

  const [filesQ, invitesQ] = await Promise.all([
    query<{
      id: string;
      package_id: string;
      file_id: string;
      label: string;
      name: string;
      size_label: string;
      type: "doc" | "img";
    }>(
      `SELECT bf.id, bf.package_id, bf.file_id, bf.label, f.name, f.size_label, f.type
         FROM bid_package_files bf JOIN files f ON f.id = bf.file_id
        WHERE bf.package_id = ANY($1::bigint[])
        ORDER BY bf.package_id, bf.sort_order, bf.id`,
      [pkgIds],
    ),
    query<{
      id: string;
      package_id: string;
      sub_slug: string;
      sub_name: string;
      sub_trade: string;
      sub_email: string | null;
      message: string;
      status: BidInviteStatus;
      sent_label: string | null;
      responded_label: string | null;
    }>(
      `SELECT i.id, i.package_id, i.sub_slug, i.message, i.status,
              s.name AS sub_name, s.trade AS sub_trade, s.email AS sub_email,
              to_char(i.sent_at, 'FMMon FMDD')      AS sent_label,
              to_char(i.responded_at, 'FMMon FMDD') AS responded_label
         FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
        WHERE i.package_id = ANY($1::bigint[])
        ORDER BY i.package_id, s.trade, s.name`,
      [pkgIds],
    ),
  ]);

  const inviteIds = invitesQ.rows.map((i) => Number(i.id));
  const submissions = await latestSubmissions(inviteIds);

  // Last auto email per invite (chase nudge or thank-you), for the board label.
  const autoLabels = new Map<number, string>();
  if (inviteIds.length > 0) {
    const { rows: autos } = await query<{ invite_id: string; kind: string; when_label: string }>(
      `SELECT DISTINCT ON (invite_id) invite_id, kind, to_char(sent_at, 'FMMon FMDD') AS when_label
         FROM bid_invite_emails
        WHERE invite_id = ANY($1::bigint[]) AND status = 'sent'
        ORDER BY invite_id, sent_at DESC`,
      [inviteIds],
    );
    for (const a of autos) {
      autoLabels.set(
        Number(a.invite_id),
        `${a.kind === "thanks" ? "thanked" : "nudged"} ${a.when_label}`,
      );
    }
  }

  const packages: BidPackage[] = pkgs.map((p) => {
    const pid = Number(p.id);
    const invites: BidInvite[] = invitesQ.rows
      .filter((i) => Number(i.package_id) === pid)
      .map((i) => ({
        id: Number(i.id),
        subSlug: i.sub_slug,
        subName: i.sub_name,
        subTrade: i.sub_trade,
        subEmail: i.sub_email,
        message: i.message,
        status: i.status,
        sentLabel: i.sent_label ?? "",
        respondedLabel: i.responded_label ?? "",
        autoLabel: autoLabels.get(Number(i.id)) ?? "",
        submission: submissions.get(Number(i.id)) ?? null,
      }));
    const totals = invites
      .filter((i) => i.submission && i.status !== "declined")
      .map((i) => i.submission!.total);
    return {
      id: pid,
      title: p.title,
      trade: p.trade,
      scopeNotes: p.scope_notes,
      dueDate: p.due_date ?? "",
      dueLabel: p.due_label ?? "",
      status: p.status,
      sentLabel: p.sent_label ?? "",
      followUps: p.follow_ups,
      awardedInviteId: p.awarded_invite_id ? Number(p.awarded_invite_id) : null,
      files: filesQ.rows
        .filter((f) => Number(f.package_id) === pid)
        .map((f) => ({
          id: Number(f.id),
          fileId: f.file_id,
          name: f.name,
          label: f.label,
          sizeLabel: f.size_label,
          type: f.type,
        })),
      invites,
      submittedCount: totals.length,
      lowTotal: totals.length ? Math.min(...totals) : null,
    };
  });

  return {
    packages,
    trades: [...new Set(packages.map((p) => p.trade).filter(Boolean))].sort(),
  };
}

/** The whole sub roster for the recipient picker — assigned to the project or
 *  not, favorites first within a trade. (getProjectSubsData's roster excludes
 *  already-assigned subs, which is wrong here: the framer already on the job
 *  is exactly who should price the next phase.) */
export async function listAllSubs(): Promise<
  { slug: string; name: string; trade: string; email: string | null }[]
> {
  const { rows } = await query<{ slug: string; name: string; trade: string; email: string | null }>(
    `SELECT slug, name, trade, email FROM subs ORDER BY trade, fav DESC, name`,
  );
  return rows;
}

// ─── Shared ops (server actions + the MCP bridge both land here) ─────────────

type OpResult = { ok: boolean; error?: string; [k: string]: unknown };

interface PackageJoin {
  id: number;
  title: string;
  trade: string;
  status: BidPackageStatus;
  scope_notes: string;
  due_label: string | null;
  project_id: string;
  slug: string;
  project_name: string;
}

async function packageById(id: number): Promise<PackageJoin | null> {
  return queryOne<PackageJoin>(
    `SELECT b.id, b.title, b.trade, b.status, b.project_id, b.scope_notes,
            to_char(b.due_date, 'FMMon FMDD') AS due_label,
            p.slug, p.name AS project_name
       FROM bid_packages b JOIN projects p ON p.id = b.project_id
      WHERE b.id = $1`,
    [id],
  );
}

export interface InviteJoin {
  id: number;
  sub_slug: string;
  sub_name: string;
  status: BidInviteStatus;
  package_id: number;
  title: string;
  package_status: BidPackageStatus;
  slug: string;
  project_name: string;
}

export async function bidInviteById(id: number): Promise<InviteJoin | null> {
  return queryOne<InviteJoin>(
    `SELECT i.id, i.sub_slug, i.status, s.name AS sub_name,
            b.id AS package_id, b.title, b.status AS package_status,
            p.slug, p.name AS project_name
       FROM bid_invites i
       JOIN subs s ON s.slug = i.sub_slug
       JOIN bid_packages b ON b.id = i.package_id
       JOIN projects p ON p.id = b.project_id
      WHERE i.id = $1`,
    [id],
  );
}

/** The bid request email itself — plain text, packet attached. */
function bidGreetingName(subName: string, notes?: string | null): string {
  const contact = notes?.match(/(?:^|\n)Greeting contact:\s*([^\.\n]+)/i)?.[1]?.trim();
  if (contact) {
    if (/\band\b/i.test(contact)) return contact.replace(/\s+[A-Z][a-z]+$/, "");
    return contact.split(/\s+/)[0] || contact;
  }
  return subName.split(/\s+/)[0] || subName;
}

function composeBidEmail(
  subName: string,
  subNotes: string | null,
  pkg: PackageJoin,
  personalNote: string,
  fileLabels: string[],
): { subject: string; body: string } {
  const firstName = bidGreetingName(subName, subNotes);
  const subject = `Bid request: ${pkg.title} — ${pkg.project_name}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `I'd like your price on ${pkg.title} for ${pkg.project_name}.`,
    ...(pkg.scope_notes ? ["", "Scope:", pkg.scope_notes] : []),
    ...(personalNote ? ["", `A note for you: ${personalNote}`] : []),
    ...(pkg.due_label ? ["", `Bids are due by ${pkg.due_label}.`] : []),
    "",
    `The packet is attached (${fileLabels.join(", ")}). Reply to this email with your number — ` +
      "line items, exclusions, and lead time all welcome. Questions, just reply.",
    "",
    "— Joe Stafki",
    "SJ Carpentry LLC",
  ].join("\n");
  return { subject, body };
}

/** Send a package: every draft invite whose sub has an email address gets the
 *  bid request emailed to them directly (scope + per-sub note in the body,
 *  packet files attached) and flips 'sent'. Subs with no email stay draft and
 *  are called out so the owner can fix the roster and re-send. Re-running on an
 *  open package emails invites added since, so "add one more sub" doesn't need
 *  a second flow.
 *
 *  OWNER-ONLY: this transmits email. Only the Bidding-tab button calls it —
 *  the MCP bridge refuses the send action. */
export async function sendBidPackageOp(packageId: number): Promise<OpResult> {
  const pkg = await packageById(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };
  if (pkg.status === "awarded" || pkg.status === "closed") {
    return { ok: false, error: `This package is ${pkg.status} — reopen it before re-sending.` };
  }
  if (!gmailConfigured()) {
    return { ok: false, error: "Gmail isn't connected, so bid emails can't go out. Connect it from the Inbox first." };
  }

  const { rows: files } = await query<{
    name: string;
    label: string;
    storage_path: string | null;
    mime_type: string | null;
  }>(
    `SELECT f.name, bf.label, f.storage_path, f.mime_type
       FROM bid_package_files bf JOIN files f ON f.id = bf.file_id
      WHERE bf.package_id = $1
      ORDER BY bf.sort_order, bf.id`,
    [packageId],
  );
  if (files.length === 0) {
    return { ok: false, error: "Attach the plans or takeoff before sending — an empty packet is a dead end for the sub." };
  }

  // Read the packet off disk once; every recipient gets the same attachments.
  // A missing blob aborts the send — a sub pricing half a packet is worse than
  // no send at all.
  const packet = await readAttachments(files, readUpload);
  if (!packet.ok) {
    return { ok: false, error: `Packet file "${packet.missing}" is missing from storage — re-upload it or pull it from the packet.` };
  }
  const { attachments } = packet;
  if (packet.totalBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "The packet is over Gmail's ~25 MB attachment limit — slim it down (or split the package) and send again." };
  }

  const { rows: drafts } = await query<{
    id: string;
    message: string;
    sub_name: string;
    sub_notes: string | null;
    email: string | null;
  }>(
    `SELECT i.id, i.message, s.name AS sub_name, s.notes AS sub_notes, s.email
       FROM bid_invites i JOIN subs s ON s.slug = i.sub_slug
      WHERE i.package_id = $1 AND i.status = 'draft'
      ORDER BY s.name`,
    [packageId],
  );
  if (drafts.length === 0) {
    return { ok: false, error: "No new subs to send to — add recipients first." };
  }

  const noEmail = drafts.filter((d) => !(d.email ?? "").trim());
  const sendable = drafts.filter((d) => (d.email ?? "").trim());
  if (sendable.length === 0) {
    return {
      ok: false,
      error: `No email on file for ${noEmail.map((d) => d.sub_name).join(", ")} — add addresses on the Subs page, then send again.`,
    };
  }

  const fileLabels = files.map((f) => f.label || f.name);
  const sent: string[] = [];
  const failed: string[] = [];
  let firstFailure = "";
  for (const d of sendable) {
    const { subject, body } = composeBidEmail(d.sub_name, d.sub_notes, pkg, d.message.trim(), fileLabels);
    try {
      await sendNewEmail({ to: (d.email ?? "").trim(), subject, bodyText: body, attachments });
    } catch (err) {
      failed.push(d.sub_name);
      firstFailure ||= String((err as Error)?.message ?? err);
      continue;
    }
    // Marked per-invite AFTER its email left, so a mid-loop failure leaves the
    // unsent subs draft and the button offers exactly them next time.
    await query(`UPDATE bid_invites SET status = 'sent', sent_at = now() WHERE id = $1`, [Number(d.id)]);
    sent.push(d.sub_name);
  }

  if (sent.length > 0) {
    await query(
      `UPDATE bid_packages SET status = 'open', sent_at = COALESCE(sent_at, now()), updated_at = now()
        WHERE id = $1`,
      [packageId],
    );
    await emit({
      kind: "job",
      tag: "Bid",
      accent: "accent",
      icon: "mail",
      title: `Bid request emailed to ${sent.length} sub${sent.length === 1 ? "" : "s"} — ${pkg.title}`,
      subline: `${pkg.project_name} · packet attached · ${sent.join(", ")}`,
      href: `/projects/${pkg.slug}`,
    });
  }

  const problems: string[] = [];
  if (failed.length > 0) problems.push(`sending failed for ${failed.join(", ")} (${firstFailure.slice(0, 160)})`);
  if (noEmail.length > 0) problems.push(`no email on file for ${noEmail.map((d) => d.sub_name).join(", ")}`);

  if (sent.length === 0) return { ok: false, error: `No emails went out — ${problems.join("; ")}.` };
  if (problems.length > 0) {
    return { ok: false, error: `Emailed ${sent.join(", ")}, but ${problems.join("; ")}. The rest stay unsent — fix and send again.`, sent: sent.length };
  }
  return { ok: true, sent: sent.length };
}

/** A sub replied that they're pricing it (said so by email or phone). The
 *  invite flips 'working', which moves it off the checking-in nudges and onto
 *  the softer "how's it coming" chase (lib/bid-follow-ups.ts). Shared by the
 *  Bidding-tab button and the MCP bridge — an internal record update, so
 *  agents triaging the inbox may set it when the reply lands. */
export async function markBidWorkingOp(inviteId: number): Promise<OpResult> {
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  if (invite.status === "working") return { ok: true }; // idempotent
  if (invite.status === "draft") {
    return { ok: false, error: "This invite hasn't been emailed yet." };
  }
  if (!["sent", "viewed"].includes(invite.status)) {
    return { ok: false, error: "This bid has already been answered." };
  }

  await query(
    `UPDATE bid_invites SET status = 'working', acked_at = COALESCE(acked_at, now()) WHERE id = $1`,
    [inviteId],
  );
  await emit({
    kind: "job",
    tag: "Bid",
    accent: "accent",
    icon: "mail",
    title: `${invite.sub_name} is working on ${invite.title}`,
    subline: invite.project_name,
    href: `/projects/${invite.slug}`,
  });
  return { ok: true };
}

/** A bid as the sub sent it back. Money is integer cents. */
export interface RecordBidInput {
  /** The sub's total. Omit it to use the sum of the lines. */
  totalCents?: number;
  lines?: { description: string; amountCents: number }[];
  exclusions?: string;
  leadTime?: string;
  notes?: string;
  /** Files already stored on this project (the sub's emailed quote): the
   *  owner's fresh uploads, or ids from list_project_files. */
  fileIds?: string[];
}

type RecordBidCheck =
  | {
      ok: true;
      invite: InviteJoin;
      total: number;
      lines: { description: string; amount: number }[];
      fileIds: string[];
    }
  | { ok: false; error: string };

/** bid_submissions.total and bid_submission_lines.amount are int4 cents. */
const MAX_CENTS = 2_147_483_647;

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Every refusal recordBidOp makes, checked before anything is written: the
 *  invite went out, the package is still open, the total is positive, and each
 *  file id is a stored file on this project. The owner's form runs it before
 *  storing the uploaded quote too, so a refused bid leaves no stray files. */
export async function checkRecordBid(inviteId: number, input: RecordBidInput): Promise<RecordBidCheck> {
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  if (invite.status === "draft") {
    return { ok: false, error: "This invite hasn't been emailed yet." };
  }
  if (["awarded", "not_awarded"].includes(invite.status) || invite.package_status !== "open") {
    return { ok: false, error: "Bidding on this package has closed." };
  }

  // Blank rows drop out, like the form's empty line-item rows.
  const lines: { description: string; amount: number }[] = [];
  for (const l of input.lines ?? []) {
    const description = clip(l.description, 300);
    const amount = Number(l.amountCents ?? 0);
    if (!Number.isInteger(amount) || amount < 0 || amount > MAX_CENTS) {
      return { ok: false, error: `Line "${description}" needs an amount in whole cents, 0 or more.` };
    }
    if (description || amount > 0) lines.push({ description, amount });
  }

  const total = Number(input.totalCents ?? lines.reduce((s, l) => s + l.amount, 0));
  if (!Number.isInteger(total)) return { ok: false, error: "The bid total must be whole cents." };
  if (total > MAX_CENTS) return { ok: false, error: "That bid total is too large — amounts are in cents." };
  if (total <= 0) return { ok: false, error: "Enter your bid total (or line items that add up to one)." };

  const fileIds = [...new Set((input.fileIds ?? []).map((id) => String(id ?? "").trim()))];
  if (fileIds.length > 0) {
    const { rows } = await query<{ id: string }>(
      `SELECT id FROM files
        WHERE id = ANY($1::text[]) AND storage_path IS NOT NULL AND project_key = $2`,
      [fileIds, invite.slug],
    );
    const found = new Set(rows.map((r) => r.id));
    const unknown = fileIds.filter((id) => !found.has(id));
    if (unknown.length > 0) {
      return {
        ok: false,
        error:
          `No stored file on ${invite.project_name} with id ${unknown.map((id) => `"${id}"`).join(", ")} — ` +
          "nothing was recorded. Use list_project_files for this project's file ids.",
      };
    }
  }

  return { ok: true, invite, total, lines, fileIds };
}

/** Record a bid that came back by email or phone: a total (or line items that
 *  sum to one), optional exclusions / lead time / notes, and the sub's quote as
 *  already-stored files. Re-recording files a new revision — compare reads the
 *  latest. Shared by the Bidding-tab Record bid form and the MCP bridge
 *  (record_bid): an internal record, but it can set off the package's auto
 *  thank-you, same as the button. */
export async function recordBidOp(inviteId: number, input: RecordBidInput): Promise<OpResult> {
  const check = await checkRecordBid(inviteId, input);
  if (!check.ok) return check;
  const { invite, total, lines, fileIds } = check;

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
      clip(input.notes, 4000),
      clip(input.exclusions, 4000),
      clip(input.leadTime, 200),
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

  // One row per file, in order: the board lists a bid's files by created_at.
  for (const fileId of fileIds) {
    await query(
      `INSERT INTO bid_submission_files (submission_id, file_id) VALUES ($1, $2)`,
      [submissionId, fileId],
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
  return {
    ok: true,
    invite_id: inviteId,
    submission_id: submissionId,
    revision: revision?.next ?? 1,
    total_cents: total,
  };
}

/** Pick a winner. The awarded invite flips 'awarded'; every other sub still in
 *  the running goes 'not_awarded' (declined stays declined); the package
 *  closes as 'awarded'. */
export async function awardBidOp(inviteId: number): Promise<OpResult> {
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  if (invite.status !== "submitted") {
    return { ok: false, error: "Only a submitted bid can be awarded." };
  }

  await query(`UPDATE bid_invites SET status = 'awarded' WHERE id = $1`, [inviteId]);
  await query(
    `UPDATE bid_invites SET status = 'not_awarded'
      WHERE package_id = $1 AND id <> $2 AND status IN ('sent','viewed','working','submitted')`,
    [invite.package_id, inviteId],
  );
  await query(
    `UPDATE bid_packages SET status = 'awarded', awarded_invite_id = $2, updated_at = now()
      WHERE id = $1`,
    [invite.package_id, inviteId],
  );

  await emit({
    kind: "money",
    tag: "Bid",
    accent: "money",
    icon: "money",
    title: `Awarded to ${invite.sub_name} — ${invite.title}`,
    subline: invite.project_name,
    href: `/projects/${invite.slug}`,
  });
  return { ok: true };
}

