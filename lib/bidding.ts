import "server-only";

// Bidding reads + shared ops. A bid package is a request for pricing on one
// category of work: the packet (plans + takeoffs out of the files table) goes
// to several subs at once, each through an invite that can carry a note
// written just for them. Subs answer in their portal with a total, line
// items, exclusions and uploaded docs; the compare view lines those up side
// by side and awarding one invite closes the package.
//
// Owner/sub write paths live in lib/actions/bidding.ts. The ops at the bottom
// (send / award / message) are plain functions shared by those actions and the
// MCP bridge route (app/api/internal/bidding/route.ts) so both run the same
// logic. Per the owner's call, agents get the full bidding surface including
// send — "send" here publishes to sub portals and parks invite emails; nothing
// in this file can transmit an email.

import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { emit } from "./notify";
import { getPortalThread, type PortalMessage } from "./portal-messages";

export type BidPackageStatus = "draft" | "open" | "awarded" | "closed";
export type BidInviteStatus =
  | "draft"
  | "sent"
  | "viewed"
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
  /** Latest revision, if the sub has submitted. */
  submission: BidSubmission | null;
  /** The per-invite Q&A thread (owner ⇄ this sub). */
  thread: PortalMessage[];
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

/** Every bid conversation is its own thread in the app-wide chat_messages
 *  store, keyed per invite so two subs bidding the same package never see each
 *  other's questions. */
export function bidChannel(inviteId: number): string {
  return `bid:${inviteId}`;
}

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
    awarded_invite_id: string | null;
  }>(
    `SELECT id, title, trade, scope_notes, status, awarded_invite_id,
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

  const submissions = await latestSubmissions(invitesQ.rows.map((i) => Number(i.id)));
  const threads = new Map<number, PortalMessage[]>(
    await Promise.all(
      invitesQ.rows.map(async (i): Promise<[number, PortalMessage[]]> => {
        const inviteId = Number(i.id);
        // Draft invites have no thread yet — skip the query.
        return [inviteId, i.status === "draft" ? [] : await getPortalThread(bidChannel(inviteId))];
      }),
    ),
  );

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
        submission: submissions.get(Number(i.id)) ?? null,
        thread: threads.get(Number(i.id)) ?? [],
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
export async function listAllSubs(): Promise<{ slug: string; name: string; trade: string }[]> {
  const { rows } = await query<{ slug: string; name: string; trade: string }>(
    `SELECT slug, name, trade FROM subs ORDER BY trade, fav DESC, name`,
  );
  return rows;
}

// ─── Sub read (the portal's "Bid requests" card) ─────────────────────────────

export interface SubBidInvite {
  id: number;
  packageTitle: string;
  trade: string;
  projectName: string;
  dueLabel: string;
  scopeNotes: string;
  message: string;
  status: BidInviteStatus;
  files: BidFile[];
  submission: BidSubmission | null;
  thread: PortalMessage[];
}

/** Everything published to this sub, newest first. Reading marks fresh invites
 *  'viewed' — that's the read receipt the owner's board shows, and it happens
 *  here because rendering the portal IS the sub seeing the packet. */
export async function getSubBidInvites(subSlug: string): Promise<SubBidInvite[]> {
  await query(
    `UPDATE bid_invites SET status = 'viewed', viewed_at = now()
      WHERE sub_slug = $1 AND status = 'sent'`,
    [subSlug],
  );

  const { rows } = await query<{
    id: string;
    message: string;
    status: BidInviteStatus;
    package_id: string;
    title: string;
    trade: string;
    scope_notes: string;
    due_label: string | null;
    project_name: string;
  }>(
    `SELECT i.id, i.message, i.status, p.id AS package_id, p.title, p.trade,
            p.scope_notes, to_char(p.due_date, 'FMMon FMDD') AS due_label,
            pr.name AS project_name
       FROM bid_invites i
       JOIN bid_packages p ON p.id = i.package_id
       JOIN projects pr ON pr.id = p.project_id
      WHERE i.sub_slug = $1 AND i.status <> 'draft'
      ORDER BY i.sent_at DESC NULLS LAST, i.id DESC`,
    [subSlug],
  );
  if (rows.length === 0) return [];

  const pkgIds = [...new Set(rows.map((r) => Number(r.package_id)))];
  const { rows: files } = await query<{
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
  );

  const submissions = await latestSubmissions(rows.map((r) => Number(r.id)));
  const threads = await Promise.all(rows.map((r) => getPortalThread(bidChannel(Number(r.id)))));

  return rows.map((r, idx) => ({
    id: Number(r.id),
    packageTitle: r.title,
    trade: r.trade,
    projectName: r.project_name,
    dueLabel: r.due_label ?? "",
    scopeNotes: r.scope_notes,
    message: r.message,
    status: r.status,
    files: files
      .filter((f) => Number(f.package_id) === Number(r.package_id))
      .map((f) => ({
        id: Number(f.id),
        fileId: f.file_id,
        name: f.name,
        label: f.label,
        sizeLabel: f.size_label,
        type: f.type,
      })),
    submission: submissions.get(Number(r.id)) ?? null,
    thread: threads[idx],
  }));
}

// ─── Shared ops (server actions + the MCP bridge both land here) ─────────────

type OpResult = { ok: boolean; error?: string; [k: string]: unknown };

interface PackageJoin {
  id: number;
  title: string;
  trade: string;
  status: BidPackageStatus;
  project_id: string;
  slug: string;
  project_name: string;
}

async function packageById(id: number): Promise<PackageJoin | null> {
  return queryOne<PackageJoin>(
    `SELECT b.id, b.title, b.trade, b.status, b.project_id,
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

/** Public base URL for links that leave the app. Matches lib/sub-invites.ts. */
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://os.sjcarpentryllc.com").replace(/\/$/, "");
}

const INVITE_TTL_DAYS = 30;

/** Park a bid-flavored portal invite for a sub who may not have portal access
 *  yet. Same table + conflict rules as lib/sub-invites.ts (a live invite wins,
 *  a dead one is resurrected), but the email copy asks for a price instead of
 *  announcing an assignment. Parked only — Joe sends it from the Subs tab. */
async function queueBidPortalInvite(projectId: string, subSlug: string, packageTitle: string) {
  const sub = await queryOne<{ name: string; email: string | null }>(
    `SELECT name, email FROM subs WHERE slug = $1`,
    [subSlug],
  );
  const project = await queryOne<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [
    projectId,
  ]);
  if (!sub || !project) return;

  const token = randomBytes(32).toString("base64url");
  const link = `${appUrl()}/sub-portal/enter?token=${token}`;
  const firstName = sub.name.split(/\s+/)[0] || sub.name;
  const subject = `Bid request: ${packageTitle} — ${project.name}`;
  const body = [
    `Hi ${firstName},`,
    "",
    `I'd like your price on ${packageTitle} for ${project.name}.`,
    "",
    "The full packet — plans, takeoffs, and scope — is in your sub portal, and you can send your bid back right there:",
    link,
    "",
    "No account or password needed. The link signs you in and works for the next " +
      `${INVITE_TTL_DAYS} days, so keep this email.`,
    "",
    "— Joe Stafki",
    "SJ Carpentry LLC",
  ].join("\n");

  await query(
    `INSERT INTO sub_portal_invites
       (sub_slug, project_id, to_email, subject, body, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)
     ON CONFLICT (sub_slug, project_id) DO UPDATE
        SET token      = EXCLUDED.token,
            to_email   = EXCLUDED.to_email,
            subject    = EXCLUDED.subject,
            body       = EXCLUDED.body,
            expires_at = EXCLUDED.expires_at,
            status     = 'queued',
            used_at    = NULL,
            created_at = now()
      WHERE sub_portal_invites.status = 'dismissed'
         OR sub_portal_invites.expires_at <= now()`,
    [subSlug, projectId, sub.email, subject, body, token, String(INVITE_TTL_DAYS)],
  );
}

/** Publish a package: every draft invite goes 'sent' and appears in that sub's
 *  portal; subs without a live portal link get a bid invite email PARKED on the
 *  project's Subs tab (never transmitted — Joe sends those himself). Re-running
 *  on an open package publishes invites added since, so "add one more sub"
 *  doesn't need a second flow. */
export async function sendBidPackageOp(packageId: number): Promise<OpResult> {
  const pkg = await packageById(packageId);
  if (!pkg) return { ok: false, error: "Bid package not found." };
  if (pkg.status === "awarded" || pkg.status === "closed") {
    return { ok: false, error: `This package is ${pkg.status} — reopen it before re-sending.` };
  }

  const fileCount = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM bid_package_files WHERE package_id = $1`,
    [packageId],
  );
  if (!fileCount || fileCount.n === 0) {
    return { ok: false, error: "Attach the plans or takeoff before sending — an empty packet is a dead end for the sub." };
  }

  const { rows: published } = await query<{ sub_slug: string }>(
    `UPDATE bid_invites SET status = 'sent', sent_at = now()
      WHERE package_id = $1 AND status = 'draft'
      RETURNING sub_slug`,
    [packageId],
  );
  if (published.length === 0) {
    return { ok: false, error: "No new subs to send to — add recipients first." };
  }

  await query(
    `UPDATE bid_packages SET status = 'open', sent_at = COALESCE(sent_at, now()), updated_at = now()
      WHERE id = $1`,
    [packageId],
  );

  // Park a portal invite for anyone who can't get in yet. Best-effort — the
  // publish above already succeeded.
  for (const { sub_slug } of published) {
    try {
      await queueBidPortalInvite(pkg.project_id, sub_slug, pkg.title);
    } catch (err) {
      console.error("queueBidPortalInvite failed", err);
    }
  }

  await emit({
    kind: "job",
    tag: "Bid",
    accent: "accent",
    icon: "mail",
    title: `Bid request out to ${published.length} sub${published.length === 1 ? "" : "s"} — ${pkg.title}`,
    subline: `${pkg.project_name} · portal invites for new subs are parked on the Subs tab`,
    href: `/projects/${pkg.slug}`,
  });
  return { ok: true, sent: published.length };
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
      WHERE package_id = $1 AND id <> $2 AND status IN ('sent','viewed','submitted')`,
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

/** Post into a bid thread as the owner (or an agent working for the owner).
 *  The sub sees it on their portal's bid card. */
export async function postBidMessageOp(
  inviteId: number,
  author: { kind: "owner" | "ai"; name: string; initials: string },
  body: string,
): Promise<OpResult> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Write a message first." };
  const invite = await bidInviteById(inviteId);
  if (!invite) return { ok: false, error: "Bid invite not found." };
  if (invite.status === "draft") {
    return { ok: false, error: "This invite hasn't been sent yet — the sub can't see the thread." };
  }

  await query(
    `INSERT INTO chat_messages (channel_key, author_kind, author_name, author_initials, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [bidChannel(inviteId), author.kind, author.name, author.initials, trimmed.slice(0, 4000)],
  );
  return { ok: true };
}
