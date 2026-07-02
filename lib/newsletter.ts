import "server-only";

// Newsletter builder (Phase-7). Real, DB-backed: issues with an intro + content
// blocks (some pulled from completed jobs), sent to a recipient list via Gmail.
// Reads here; writes/sends in lib/actions/newsletter.ts. Server-only (imports
// lib/db); client components import only the types (`import type`).

import { query } from "./db";

export type IssueStatus = "draft" | "sent";

export interface NewsletterBlock {
  heading: string;
  body: string;
  /** Optional link back to the project this block celebrates. */
  projectSlug?: string;
}

export interface NewsletterIssue {
  id: number;
  title: string;
  intro: string;
  blocks: NewsletterBlock[];
  status: IssueStatus;
  recipientCount: number;
  sentLabel: string | null;
  createdLabel: string;
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
}

export interface NewsletterData {
  issues: NewsletterIssue[];
  selectedId: number | null;
  recentJobs: RecentJob[];
  recipients: Recipient[];
  activeRecipientCount: number;
}

interface IssueRow {
  id: number;
  title: string;
  intro: string;
  blocks: NewsletterBlock[];
  status: IssueStatus;
  recipient_count: number;
  sent_label: string | null;
  created_label: string;
}

function rowToIssue(r: IssueRow): NewsletterIssue {
  return {
    id: r.id,
    title: r.title,
    intro: r.intro,
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    status: r.status,
    recipientCount: r.recipient_count,
    sentLabel: r.sent_label,
    createdLabel: r.created_label,
  };
}

export async function getNewsletterData(selectedId?: number): Promise<NewsletterData> {
  const { rows: issueRows } = await query<IssueRow>(
    `SELECT id, title, intro, blocks, status, recipient_count,
            to_char(sent_at, 'FMMon FMDD, YYYY')    AS sent_label,
            to_char(created_at, 'FMMon FMDD, YYYY')  AS created_label
       FROM newsletters
      ORDER BY created_at DESC, id DESC`,
  );
  const issues = issueRows.map(rowToIssue);

  const recentJobs = (
    await query<{ slug: string; name: string; city: string | null }>(
      `SELECT slug, name, address AS city
         FROM projects
        WHERE status IN ('closeout','warranty')
        ORDER BY updated_at DESC
        LIMIT 8`,
    )
  ).rows.map((r) => ({ slug: r.slug, name: r.name, city: r.city ?? "" }));

  const recipients = (
    await query<{ id: number; email: string; name: string; active: boolean }>(
      `SELECT id, email, name, active FROM newsletter_recipients ORDER BY active DESC, name, email`,
    )
  ).rows;

  const activeRecipientCount = recipients.filter((r) => r.active).length;

  const selected =
    selectedId && issues.some((i) => i.id === selectedId) ? selectedId : issues[0]?.id ?? null;

  return { issues, selectedId: selected, recentJobs, recipients, activeRecipientCount };
}
