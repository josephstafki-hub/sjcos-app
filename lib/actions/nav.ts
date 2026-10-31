"use server";

// Live counts for the sidebar nav badges. Fetched client-side (see Sidebar) so
// they never add latency to a page navigation — on mount, when LiveUpdates
// sees a table behind a badge change, and on a slow timer for Gmail. Owner
// and staff only; anyone else gets zeros.

import { can, getCurrentUser, type CurrentUser } from "@/lib/dal";
import { query } from "@/lib/db";
import { loadedNeedsCount } from "@/lib/inbox-rules";
import { getUnansweredChatCount } from "@/lib/chat";
import { getUnreadSmsCount } from "@/lib/sms";
import { withMailboxFor, activeMailbox } from "@/lib/mailbox";
import { runDirect } from "@/lib/commands/db";
import { countPending } from "@/lib/unsorted-docs-core";

export interface NavCounts {
  inbox: number;
  chat: number;
  leads: number;
  messages: number;
  /** Emailed invoices/receipts waiting for Joe to say which job (/unsorted). */
  unsorted: number;
}

export async function getNavCounts(): Promise<NavCounts> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "staff")) return { inbox: 0, chat: 0, leads: 0, messages: 0, unsorted: 0 };

  // Staff only get badges for areas they hold — a count is a peek.
  const zero = async () => 0;
  const [inbox, chat, leads, messages, unsorted] = await Promise.all([
    can(user, "inbox") ? inboxUnread(user) : zero(),
    can(user, "chat") ? getUnansweredChatCount(user.id).catch(() => 0) : zero(),
    can(user, "leads") ? leadsNeedingAttention() : zero(),
    can(user, "comms") ? getUnreadSmsCount().catch(() => 0) : zero(),
    can(user, "money") ? countPending(runDirect).catch(() => 0) : zero(),
  ]);
  return { inbox, chat, leads, messages, unsorted };
}

/** Loaded Needs me count for THIS person's mailbox. Without the scope the badge would
 *  report the owner's unread total to every staff login. */
async function inboxUnread(user: CurrentUser): Promise<number> {
  return withMailboxFor(user, async () => {
    // Keyed by the mailbox's user (the inbox load records it); never a Gmail call per navigation.
    return loadedNeedsCount(activeMailbox()?.userId ?? '');
  });
}

async function leadsNeedingAttention(): Promise<number> {
  try {
    const { rows } = await query<{ n: string }>(
      // Same set as Today's "flagged leads": a lost lead needs nothing more,
      // even if its old "Needs reply" / "Scam" chip is still on the row.
      `SELECT count(*) AS n FROM leads
        WHERE flag_kind = 'flag' AND stage <> 'lost'
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)`,
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
