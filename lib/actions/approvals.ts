"use server";

// The corner popup + inline notification cards (components/shell/
// NotificationCenter, components/notifications). One poll that returns what's
// waiting on the signed-in person and what's new in their feed, and one
// Approve / Decline pair that routes to the same resolution every other
// surface uses — so an approval here sends exactly what the Telegram button
// or /engine would.

import { revalidatePath } from "next/cache";
import { describeApproval } from "@/lib/approved-draft-rules";
import { listPendingApprovals, type PendingApproval } from "@/lib/approvals";
import { getCurrentUser } from "@/lib/dal";
import { query } from "@/lib/db";
import { approveDecisionAction, rejectDecisionAction } from "@/lib/decisions/actions";
import { approveWorkItem, rejectWorkItem } from "@/lib/actions/engine";
import { getUnreadCount } from "@/lib/notifications";

export interface FreshNotification {
  id: string;
  tag: string;
  title: string;
  subline: string;
  href: string;
  flagged: boolean;
  createdAt: string;
}

export interface NotificationPoll {
  /** Server clock — the next poll's `since`. */
  now: string;
  unread: number;
  approvals: PendingApproval[];
  /** Feed cards created after `since` (none on the first poll). */
  fresh: FreshNotification[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function pollNotificationCenter(since: string | null): Promise<NotificationPoll | null> {
  const user = await getCurrentUser();
  if (!user || (user.role !== "owner" && user.role !== "staff")) return null;
  const now = new Date().toISOString();
  const [unread, approvals, fresh] = await Promise.all([
    getUnreadCount(user).catch(() => 0),
    // Decisions and send approvals are the owner's to answer.
    user.role === "owner" ? listPendingApprovals({ limit: 12 }).catch(() => []) : Promise.resolve([]),
    since && !Number.isNaN(Date.parse(since))
      ? query<FreshNotification>(
          `SELECT n.id::text, COALESCE(n.tag, n.kind) AS tag, n.title, COALESCE(n.subline, '') AS subline,
                  COALESCE(n.href, '/notifications') AS href, n.flagged,
                  to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
             FROM notifications n
            WHERE n.created_at > $2::timestamptz
              AND ${user.role === "owner" ? "(n.audience_user_id IS NULL OR n.audience_user_id = $1)" : "(n.audience_user_id = $1 OR n.actor_user_id = $1)"}
              AND n.resolved_at IS NULL
              -- asks show as approval cards, not as a second toast
              AND (n.ref IS NULL OR n.ref !~ '^(decision|work_item):')
            ORDER BY n.created_at DESC LIMIT 5`,
          [user.id, since],
        )
          .then((r) => r.rows)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  return { now, unread, approvals, fresh };
}

export type ApprovalAnswer = { ok: true; message: string; kind: "success" | "info" | "error" } | { ok: false; error: string };

function parseKey(key: string): { kind: "decision" | "work_item"; id: string } | null {
  const m = /^(decision|work_item):(.+)$/.exec(key);
  if (!m || !UUID.test(m[2])) return null;
  return { kind: m[1] as "decision" | "work_item", id: m[2] };
}

function refresh() {
  revalidatePath("/notifications");
  revalidatePath("/today");
  revalidatePath("/engine");
}

/** Approve one waiting item. `contentHash` is the decision hash the card
 *  showed — a changed package is refused as stale rather than approved. */
export async function approveWaiting(key: string, contentHash: string | null): Promise<ApprovalAnswer> {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return { ok: false, error: "Only the owner can approve this." };
  const k = parseKey(key);
  if (!k) return { ok: false, error: "Unknown approval." };
  if (k.kind === "decision") {
    const r = await approveDecisionAction(k.id, contentHash);
    refresh();
    if (!r.ok) return r;
    return { ok: true, message: r.reply, kind: /NOT sent|failed|not confirmed/i.test(r.reply) ? "error" : "success" };
  }
  const r = await approveWorkItem(k.id);
  refresh();
  const d = describeApproval(r);
  return r.ok ? { ok: true, message: d.message, kind: d.kind } : { ok: false, error: r.error };
}

/** Decline one waiting item. Nothing is sent. */
export async function declineWaiting(key: string, contentHash: string | null, note?: string | null): Promise<ApprovalAnswer> {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") return { ok: false, error: "Only the owner can decline this." };
  const k = parseKey(key);
  if (!k) return { ok: false, error: "Unknown approval." };
  if (k.kind === "decision") {
    const r = await rejectDecisionAction(k.id, note?.trim() || "Declined from the popup", contentHash);
    refresh();
    return r.ok ? { ok: true, message: "Declined — nothing was sent.", kind: "info" } : r;
  }
  const r = await rejectWorkItem(k.id);
  refresh();
  return r.ok ? { ok: true, message: "Declined — nothing was sent.", kind: "info" } : r;
}
