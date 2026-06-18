"use server";

// Live counts for the sidebar nav badges. Fetched client-side on mount (see
// Sidebar) so they never add latency to a page navigation. Owner-scoped: a
// non-owner gets zeros (the Shell nav is only used by the owner app anyway).

import { getCurrentUser } from "@/lib/dal";
import { query } from "@/lib/db";
import { gmailConfigured, gmailInboxUnread } from "@/lib/gmail";
import { getUnreadChatCount } from "@/lib/chat";

export interface NavCounts {
  inbox: number;
  chat: number;
  leads: number;
}

export async function getNavCounts(): Promise<NavCounts> {
  const user = await getCurrentUser();
  if (user?.role !== "owner") return { inbox: 0, chat: 0, leads: 0 };

  const [inbox, chat, leads] = await Promise.all([
    inboxUnread(),
    getUnreadChatCount().catch(() => 0),
    leadsNeedingAttention(),
  ]);
  return { inbox, chat, leads };
}

async function inboxUnread(): Promise<number> {
  if (!gmailConfigured()) return 0;
  try {
    return await gmailInboxUnread();
  } catch {
    return 0;
  }
}

async function leadsNeedingAttention(): Promise<number> {
  try {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*) AS n FROM leads WHERE flag_kind = 'flag'`,
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
