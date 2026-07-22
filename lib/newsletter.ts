import "server-only";

// Newsletter builder (Phase-7). Real, DB-backed: issues with an intro + content
// blocks (some pulled from completed jobs), sent to a recipient list via Gmail.
// Reads here; writes/sends in lib/actions/newsletter.ts. Server-only (imports
// lib/db); client components import only the types (`import type`).

import { query } from "./db";
import { normalizeSettings, type IssueSettings } from "./newsletter-design";
import { listSequences, type Sequence } from "./newsletter-drip";
import { baseUrl } from "./newsletter-outbox";

export type { IssueSettings, Sequence };

export type IssueStatus = "draft" | "queued" | "sent";

/** What a block renders as. Absent = "text" (every block predating P7-N). */
export type BlockKind = "text" | "image" | "button" | "divider" | "quote";

export interface NewsletterBlock {
  kind?: BlockKind;
  heading: string;
  body: string;
  /** Optional link back to the project this block celebrates. */
  projectSlug?: string;
  /** kind='image': newsletter_assets.token, resolved to a public URL at render. */
  imageToken?: string;
  imageAlt?: string;
  caption?: string;
  /** kind='button'. */
  buttonLabel?: string;
  buttonUrl?: string;
  align?: "left" | "center";
}

export interface NewsletterIssue {
  id: number;
  title: string;
  intro: string;
  blocks: NewsletterBlock[];
  /** Layout/style key (lib/newsletter-templates.ts). */
  template: string;
  /** Per-issue design choices (lib/newsletter-design.ts). */
  settings: IssueSettings;
  status: IssueStatus;
  recipientCount: number;
  sentLabel: string | null;
  createdLabel: string;
  /** The one issue the welcome-greeting pipeline reads from (db: is_welcome,
   *  partial-unique — at most one). Pinned in the rail; never queued/deleted
   *  through the normal broadcast flow. */
  isWelcome: boolean;
}

/** A parked send (issue or greeting) awaiting the owner's Release. */
export interface OutboxItem {
  id: number;
  kind: "issue" | "greeting";
  newsletterId: number | null;
  issueTitle: string | null;
  email: string;
  name: string;
  subject: string;
  status: "queued" | "released" | "skipped" | "failed";
  error: string | null;
  openCount: number;
  openedLabel: string | null;
  queuedLabel: string;
}

/** A recently completed project offered as newsletter content. */
export interface RecentJob {
  slug: string;
  name: string;
  city: string;
}

export interface Recipient {
  id: number;
  email: string;
  name: string;
  active: boolean;
  /** Audiences this recipient belongs to (newsletter_groups.id). A recipient can
   *  be in any number — membership is independent of which groups a given send
   *  targets (see enqueueIssue's DISTINCT dedup in lib/newsletter-outbox.ts). */
  groupIds: number[];
}

/** A named audience recipients can belong to, selectable when queueing a
 *  broadcast to scope the send to a subset of the list. */
export interface NewsletterGroup {
  id: number;
  name: string;
}

export interface NewsletterData {
  issues: NewsletterIssue[];
  selectedId: number | null;
  recentJobs: RecentJob[];
  recipients: Recipient[];
  activeRecipientCount: number;
  groups: NewsletterGroup[];
  outbox: OutboxItem[];
  sequences: Sequence[];
  /** Public origin used for image/logo URLs. Passed to the client so the Preview
   *  resolves assets against the SAME base the outgoing email will use — a
   *  preview built from window.location would silently work in dev and break the
   *  moment the app is reached by another hostname. */
  baseUrl: string;
}

interface IssueRow {
  id: number;
  title: string;
  intro: string;
  blocks: NewsletterBlock[];
  template: string;
  settings: unknown;
  status: IssueStatus;
  recipient_count: number;
  sent_label: string | null;
  created_label: string;
  is_welcome: boolean;
}

function rowToIssue(r: IssueRow): NewsletterIssue {
  return {
    id: r.id,
    title: r.title,
    intro: r.intro,
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    template: r.template || "classic",
    settings: normalizeSettings(r.settings),
    status: r.status,
    recipientCount: r.recipient_count,
    sentLabel: r.sent_label,
    createdLabel: r.created_label,
    isWelcome: r.is_welcome,
  };
}

/** Read the parked outbox (queued first, then most-recent). Shared by the page
 *  load and the post-action refresh so real row ids replace optimistic ones. */
export async function readOutbox(): Promise<OutboxItem[]> {
  return (
    await query<{
      id: number;
      kind: "issue" | "greeting";
      newsletter_id: number | null;
      issue_title: string | null;
      email: string;
      name: string;
      subject: string;
      status: OutboxItem["status"];
      error: string | null;
      open_count: number;
      opened_label: string | null;
      queued_label: string;
    }>(
      `SELECT o.id, o.kind, o.newsletter_id, n.title AS issue_title, o.email, o.name,
              o.subject, o.status, o.error, o.open_count,
              to_char(o.opened_at, 'FMMon FMDD') AS opened_label,
              to_char(o.queued_at, 'FMMon FMDD, HH12:MI AM') AS queued_label
         FROM newsletter_outbox o
         LEFT JOIN newsletters n ON n.id = o.newsletter_id
        ORDER BY (o.status = 'queued') DESC, o.queued_at DESC, o.id DESC`,
    )
  ).rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    newsletterId: r.newsletter_id,
    issueTitle: r.issue_title,
    email: r.email,
    name: r.name,
    subject: r.subject,
    status: r.status,
    error: r.error,
    openCount: r.open_count,
    openedLabel: r.opened_label,
    queuedLabel: r.queued_label,
  }));
}

export async function getNewsletterData(selectedId?: number): Promise<NewsletterData> {
  const { rows: issueRows } = await query<IssueRow>(
    `SELECT id, title, intro, blocks, template, settings, status, recipient_count, is_welcome,
            to_char(sent_at, 'FMMon FMDD, YYYY')    AS sent_label,
            to_char(created_at, 'FMMon FMDD, YYYY')  AS created_label
       FROM newsletters
      ORDER BY created_at DESC, id DESC`,
  );
  const issues = issueRows.map(rowToIssue);

  const outbox = await readOutbox();

  const recentJobs = (
    await query<{ slug: string; name: string; city: string | null }>(
      `SELECT slug, name, address AS city
         FROM projects
        WHERE status IN ('closeout','warranty')
        ORDER BY updated_at DESC
        LIMIT 8`,
    )
  ).rows.map((r) => ({ slug: r.slug, name: r.name, city: r.city ?? "" }));

  const recipientRows = (
    await query<{ id: number; email: string; name: string; active: boolean }>(
      `SELECT id, email, name, active FROM newsletter_recipients ORDER BY active DESC, name, email`,
    )
  ).rows;

  const membership = (
    await query<{ recipient_id: number; group_id: number }>(
      `SELECT recipient_id, group_id FROM newsletter_recipient_groups`,
    )
  ).rows;
  const groupsByRecipient = new Map<number, number[]>();
  for (const m of membership) {
    const list = groupsByRecipient.get(m.recipient_id);
    if (list) list.push(m.group_id);
    else groupsByRecipient.set(m.recipient_id, [m.group_id]);
  }
  const recipients: Recipient[] = recipientRows.map((r) => ({
    ...r,
    groupIds: groupsByRecipient.get(r.id) ?? [],
  }));

  const activeRecipientCount = recipients.filter((r) => r.active).length;

  const groups = (
    await query<{ id: number; name: string }>(`SELECT id, name FROM newsletter_groups ORDER BY name`)
  ).rows;

  const sequences = await listSequences();

  const selected =
    selectedId && issues.some((i) => i.id === selectedId) ? selectedId : issues[0]?.id ?? null;

  return {
    issues,
    selectedId: selected,
    recentJobs,
    recipients,
    activeRecipientCount,
    groups,
    outbox,
    sequences,
    baseUrl: baseUrl(),
  };
}
