import "server-only";

// Live "needs reply" detector. Keeps leads.flag_kind/flag_label/last_contact_at
// honest against real Gmail state, instead of the dead one-time "AI take" chip
// they used to be (see lib/lead-activity.ts for the complementary instant-clear
// path when a reply goes out through the app itself).
//
// Definition: a lead needs a reply when the MOST RECENT message in its matched
// thread was sent by the client, not by us — not Gmail's own UNREAD label,
// which only tells us Joe glanced at it, not that he answered it.
//
// Two freshness paths feed this, both calling syncLeadThreads():
//   - periodic: app/api/cron/lead-thread-sync (systemd timer, deploy/)
//   - opportunistic: nothing wired in yet — the periodic timer is sufficient
//     for v1; see docs/reference note in the cron route.
//
// dryRun computes + returns what WOULD change without writing anything, so
// the feature can be sanity-checked before the timer runs unattended.

import { query } from "./db";
import { gmailConfigured, fetchThreadPage } from "./gmail";

export interface LeadThreadSyncChange {
  slug: string;
  name: string;
  action: "flag" | "clear";
  reason: string;
  messageDate: string; // ISO
}

export interface LeadThreadSyncResult {
  configured: boolean;
  scanned: number;
  matchedThreads: number;
  changes: LeadThreadSyncChange[];
  dryRun: boolean;
}

/** First email address in a raw header value ("Name <a@b>" or "a@b").
 *  Exported for lib/detectors.ts, which reuses this module's thread-matching
 *  approach for the needs-reply detector. */
export function extractEmail(raw: string): string {
  const m = raw.match(/[^\s<>"]+@[^\s<>"]+/);
  return (m ? m[0] : "").toLowerCase();
}

interface LeadRow {
  slug: string;
  name: string;
  email: string | null;
  flag_kind: string | null;
  last_contact_at: string | null;
}

export async function syncLeadThreads(opts: { dryRun?: boolean; max?: number } = {}): Promise<LeadThreadSyncResult> {
  const dryRun = opts.dryRun ?? false;
  if (!gmailConfigured()) {
    return { configured: false, scanned: 0, matchedThreads: 0, changes: [], dryRun };
  }

  const [{ threads }, leadRows, linkRows] = await Promise.all([
    fetchThreadPage(opts.max ?? 150),
    // Exclude 'lost' leads — they're off-pipeline by explicit owner action
    // (see lib/leads.ts stageIsLost). Their Gmail history is irrelevant to
    // "needs reply," and syncing would stomp a legitimate "Passed"/"Lost"
    // ghost badge, or worse, resurrect a dead lead as "Needs reply."
    query<LeadRow>(
      `SELECT slug, name, email, flag_kind, last_contact_at::text AS last_contact_at
         FROM leads WHERE email IS NOT NULL AND email <> '' AND stage <> 'lost'`,
    ),
    query<{ gmail_thread_id: string; link_slug: string }>(
      `SELECT gmail_thread_id, link_slug FROM thread_links WHERE link_type = 'lead'`,
    ),
  ]);

  const bySlug = new Map<string, LeadRow>();
  const byEmail = new Map<string, LeadRow>();
  for (const l of leadRows.rows) {
    bySlug.set(l.slug, l);
    byEmail.set((l.email as string).toLowerCase(), l);
  }
  const linkedThread = new Map<string, string>();
  for (const l of linkRows.rows) linkedThread.set(l.gmail_thread_id, l.link_slug);

  const changes: LeadThreadSyncChange[] = [];
  let matchedThreads = 0;

  // Gmail returns threads newest-first, so the first match we see per lead is
  // already its most recent message — mutate the in-memory row as we go so a
  // second, older thread for the same lead in this batch doesn't reprocess
  // against stale state.
  for (const t of threads) {
    const linkedSlug = linkedThread.get(t.id);
    const lead = linkedSlug
      ? bySlug.get(linkedSlug)
      : byEmail.get((t.outbound ? extractEmail(t.toLine) : t.fromEmail).toLowerCase());
    if (!lead) continue;
    matchedThreads++;

    const msgAt = new Date(t.date);
    const lastKnown = lead.last_contact_at ? new Date(lead.last_contact_at) : null;
    if (lastKnown && msgAt <= lastKnown) continue;

    const desiredFlagKind = t.outbound ? null : "flag";
    const changed = lead.flag_kind !== desiredFlagKind;
    if (changed) {
      changes.push({
        slug: lead.slug,
        name: lead.name,
        action: t.outbound ? "clear" : "flag",
        reason: `${t.outbound ? "We replied" : "New message from them"}: "${t.subject}"`,
        messageDate: msgAt.toISOString(),
      });
    }

    lead.flag_kind = desiredFlagKind;
    lead.last_contact_at = msgAt.toISOString();

    if (!dryRun) {
      await query(
        `UPDATE leads SET flag_kind = $2, flag_label = $3, last_contact_at = $4 WHERE slug = $1`,
        [lead.slug, desiredFlagKind, desiredFlagKind ? "Needs reply" : null, msgAt.toISOString()],
      );
    }
  }

  return { configured: true, scanned: threads.length, matchedThreads, changes, dryRun };
}
