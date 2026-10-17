// Notifications engine (Review-round-3 S4). A thin emit() helper that server
// actions call to drop a row into the notifications table on real business
// events (new lead, stage change, Claude posting, etc.), plus a derive pass for
// time-based notifications (compliance windows entering the urgent <14d zone).
//
// Reads/feed building stay in lib/notifications.ts; this file is the only place
// that writes notification rows. Not a "use server" file — it's a plain module
// imported by the action files that own each event.

import { query } from "./db";
import type { NotificationKind } from "./types";

type Accent = "flag" | "accent" | "ai" | "money" | "ghost";
type Icon = "money" | "mail" | "star" | "chat" | "project" | "site" | "shield";

export interface EmitInput {
  kind: NotificationKind;
  title: string;
  subline?: string;
  /** Display label on the card chip; defaults to the kind's title-case label. */
  tag?: string;
  accent?: Accent;
  icon?: Icon;
  /** Relative-time display; defaults to "Just now". */
  whenLabel?: string;
  flagged?: boolean;
  href?: string;
  /** Who this is for. Omitted = the owner's company feed, which is what every
   *  business event here wants (new lead, money, compliance — Joe's to work).
   *  Set to a users.id to address one person: a to-do handed to them, a DM, a
   *  message in a room they're in. A staff feed shows ONLY rows addressed to
   *  them, so this is the single switch that decides whether a team member ever
   *  sees a given notification. */
  audienceUserId?: string | null;
  /** What the notification is about, e.g. "decision:<uuid>", "work_item:<uuid>",
   *  "lead:<uuid>". A decision / approval card is marked resolved by a table
   *  trigger the moment its subject is decided, on any channel (db/apply-
   *  notifications-v2.mjs), so the bell stops asking about settled things. */
  ref?: string | null;
  /** The signed-in person whose action caused this. Their own feed shows it
   *  even when it's addressed to the company feed (a team member who moves a
   *  lead sees that in their bell, not just Joe). */
  actorUserId?: string | null;
}

const TAG_DEFAULT: Record<NotificationKind, string> = {
  decision: "Decision",
  mention: "Mention",
  job: "Job",
  money: "Money",
  compliance: "Compliance",
};

/** Emit a notification. Best-effort: a notification is secondary to the action
 *  that triggered it, so a failure here is logged, never thrown. Callers should
 *  revalidate("/notifications") themselves if the feed is on screen. */
export async function emit(input: EmitInput): Promise<void> {
  const base = [
    input.kind,
    input.tag ?? TAG_DEFAULT[input.kind],
    input.accent ?? "ghost",
    input.icon ?? "star",
    input.title,
    input.subline ?? null,
    input.whenLabel ?? "Just now",
    input.flagged ?? false,
    input.href ?? null,
    input.audienceUserId ?? null,
  ];
  try {
    await query(
      `INSERT INTO notifications
         (kind, tag, accent, icon, title, subline, when_label, flagged, href, audience_user_id, ref, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [...base, input.ref ?? null, input.actorUserId ?? null],
    );
  } catch (err) {
    // Code shipped ahead of db/apply-notifications-v2.mjs: write the row
    // without the new columns rather than lose the notification.
    if ((err as { code?: string }).code === "42703") {
      try {
        await query(
          `INSERT INTO notifications
             (kind, tag, accent, icon, title, subline, when_label, flagged, href, audience_user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          base,
        );
        return;
      } catch (err2) {
        console.error("[notify] emit failed", err2);
        return;
      }
    }
    console.error("[notify] emit failed", err);
  }
}

/** Mark every open card about `ref` resolved (e.g. an approval decided in the
 *  app). The table triggers do this for decisions and work-item approvals;
 *  this is for callers whose subject has no trigger. Best-effort. */
export async function resolveNotifications(ref: string, resolution: string): Promise<void> {
  try {
    await query(
      `UPDATE notifications SET resolved_at = now(), resolution = $2
        WHERE ref = $1 AND resolved_at IS NULL`,
      [ref, resolution.slice(0, 40)],
    );
  } catch {
    /* pre-migration or transient: the card just stays open */
  }
}

/** Derive compliance notifications for items entering the urgent window
 *  (unresolved, due within 14 days). Idempotent — keyed on the generated title
 *  so re-running on each feed read doesn't duplicate. Best-effort. Called from
 *  the notifications feed builder ("computed on read"). */
export async function syncComplianceNotifications(): Promise<void> {
  try {
    const { rows } = await query<{
      title: string;
      owner: string | null;
      days: number;
      due: string;
    }>(
      `SELECT title, owner,
              (due_date - CURRENT_DATE)        AS days,
              to_char(due_date, 'Mon FMDD')    AS due
         FROM compliance_items
        WHERE resolved = false
          AND due_date - CURRENT_DATE BETWEEN 0 AND 14`,
    );
    for (const r of rows) {
      const title = `${r.title} · due ${r.due}`;
      const exists = await query(
        `SELECT 1 FROM notifications WHERE kind = 'compliance' AND title = $1 LIMIT 1`,
        [title],
      );
      if (exists.rowCount) continue;
      await emit({
        kind: "compliance",
        tag: "Compliance",
        accent: "flag",
        icon: "shield",
        title,
        subline:
          r.days <= 0
            ? `Due today${r.owner ? ` · ${r.owner}` : ""}`
            : `${r.days}d left${r.owner ? ` · ${r.owner}` : ""}`,
        flagged: true,
        href: "/compliance",
        whenLabel: "Today",
      });
    }
  } catch (err) {
    console.error("[notify] compliance sync failed", err);
  }
}
