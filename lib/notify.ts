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
  try {
    await query(
      `INSERT INTO notifications
         (kind, tag, accent, icon, title, subline, when_label, flagged, href)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.kind,
        input.tag ?? TAG_DEFAULT[input.kind],
        input.accent ?? "ghost",
        input.icon ?? "star",
        input.title,
        input.subline ?? null,
        input.whenLabel ?? "Just now",
        input.flagged ?? false,
        input.href ?? null,
      ],
    );
  } catch (err) {
    console.error("[notify] emit failed", err);
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
