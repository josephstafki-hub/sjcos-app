// Notifications feed builder. DB-backed (Phase 7.2): reads the notifications
// table via lib/db.
//
// `kind` stays the canonical 5-value NotificationKind (matches the schema CHECK
// + drives the filter chips). Display-only fields (tag / icon / accent / when)
// ride alongside so a card can read "INTAKE" while still filtering under its
// kind. The red border tracks `flagged`.

import type { NotificationKind } from "./types";
import { query } from "./db";
import { syncComplianceNotifications } from "./notify";
import { relativeAge, sqlAbsoluteLabel } from "./time";

/** Display accent — drives the tag chip color and left icon tint. */
export type NotifAccent = "flag" | "accent" | "ai" | "money" | "ghost";

/** Icon key, mapped to a lucide icon in the client component. */
export type NotifIcon = "money" | "mail" | "star" | "chat" | "project" | "site" | "shield";

export interface NotificationCard {
  id: string;
  kind: NotificationKind;
  /** Display label, e.g. "Decision" / "Intake". */
  tag: string;
  accent: NotifAccent;
  title: string;
  subline: string;
  /** Relative timestamp display computed from created_at, e.g. "just now" / "5h ago". */
  when: string;
  /** Absolute timestamp for the tooltip, e.g. "Aug 14, 3:12pm". */
  whenAbsolute: string;
  /** ISO created_at, for clients that want to re-derive `when` on the fly. */
  createdAt: string;
  /** Red border + flag tint. */
  flagged: boolean;
  href: string;
  icon: NotifIcon;
  /** Whether the user has cleared this notification. */
  read: boolean;
  /** What it's about ("decision:<uuid>", "work_item:<uuid>", …), if known. */
  ref: string | null;
  /** Set once the subject was decided (approved / rejected / expired / …). */
  resolution: string | null;
  /** An open ask the bell can act on in place (Approve / Decline). */
  actionable: boolean;
}

/** Filter selector value — "all" plus the canonical notification kinds. */
export type NotifFilter = "all" | "unread" | NotificationKind;

export interface NotificationsData {
  total: number;
  decisionCount: number;
  /** Count of unread notifications. */
  unread: number;
  filters: { key: NotifFilter; label: string }[];
  notifications: NotificationCard[];
}

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  tag: string | null;
  accent: string | null;
  icon: string | null;
  title: string;
  subline: string | null;
  when_label: string | null;
  age_seconds: number;
  when_absolute: string;
  created_at: string;
  flagged: boolean;
  href: string | null;
  read: boolean;
  ref?: string | null;
  resolution?: string | null;
  resolved?: boolean;
}

function rowToCard(r: NotificationRow): NotificationCard {
  const resolved = Boolean(r.resolved);
  const ref = r.ref ?? null;
  return {
    id: r.id,
    kind: r.kind,
    tag: r.tag ?? r.kind,
    accent: (r.accent ?? "ghost") as NotifAccent,
    title: r.title,
    subline: r.subline ?? "",
    when: relativeAge(r.age_seconds ?? 0),
    whenAbsolute: r.when_absolute ?? "",
    createdAt: r.created_at,
    // A settled ask is no longer red, and no longer unread.
    flagged: r.flagged && !resolved,
    href: r.href ?? "#",
    icon: (r.icon ?? "star") as NotifIcon,
    read: r.read || resolved,
    ref,
    resolution: resolved ? (r.resolution ?? "done") : null,
    actionable: !resolved && Boolean(ref && /^(decision|work_item):[0-9a-f-]{36}$/.test(ref)),
  };
}

/** WHICH ROWS a given account may see.
 *
 *  Owner: the company feed (audience_user_id IS NULL — every business event
 *  emit() writes) plus anything addressed to him.
 *
 *  Staff: addressed to them and nothing else. The company feed is Joe's work
 *  queue in notification form — new leads, A/R, compliance windows — and a team
 *  member reading it (never mind clearing it) was the sharpest edge of the one
 *  shared feed. Their bell starts empty and fills with hand-offs and messages.
 *
 *  Portal roles never reach this module; /notifications is behind the Today area. */
function audienceClause(viewer: FeedViewer, paramIndex: number, v2 = true): string {
  // v2 (db/apply-notifications-v2.mjs): a card your own action caused is in
  // your feed too — a team member who moves a lead sees it in their bell.
  const mine = v2 ? ` OR n.actor_user_id = $${paramIndex}` : "";
  return viewer.role === "owner"
    ? `(n.audience_user_id IS NULL OR n.audience_user_id = $${paramIndex})`
    : `(n.audience_user_id = $${paramIndex}${mine})`;
}

/** Whether notifications v2 columns exist. Flips to false on the first
 *  "undefined column" so a build shipped ahead of its migration keeps the
 *  bell (rendered on every page) working instead of erroring every page. */
let V2 = true;
function isMissingColumn(err: unknown): boolean {
  return (err as { code?: string })?.code === "42703";
}

/** Just enough of a login to scope the feed. */
export interface FeedViewer {
  id: string;
  role: string;
}

/** Lightweight unread tally for the topbar bell dot — avoids building the
 *  full feed on every page render. Unread is per-user now: a row is read when
 *  THIS user has a notification_reads entry for it, so Joe clearing his bell
 *  no longer clears everyone's (and vice versa). */
export async function getUnreadCount(viewer: FeedViewer): Promise<number> {
  const sql = (v2: boolean) => `SELECT count(*)::int AS n FROM notifications n
      WHERE ${audienceClause(viewer, 1, v2)}
        ${v2 ? "AND n.resolved_at IS NULL" : ""}
        AND NOT EXISTS (
          SELECT 1 FROM notification_reads r
           WHERE r.notification_id = n.id AND r.user_id = $1
        )`;
  try {
    const { rows } = await query<{ n: string }>(sql(V2), [viewer.id]);
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    if (!V2 || !isMissingColumn(err)) throw err;
    V2 = false;
    const { rows } = await query<{ n: string }>(sql(false), [viewer.id]);
    return Number(rows[0]?.n ?? 0);
  }
}

/** How many cards the feed loads. The table only grows (873 rows by
 *  2026-10-17) and the page rendered every one of them. */
const FEED_LIMIT = 300;

export async function getNotificationsData(viewer: FeedViewer): Promise<NotificationsData> {
  // Derive time-based compliance notifications before reading the feed
  // (idempotent; see lib/notify.ts). Best-effort — never blocks the feed.
  // Owner-only: these are company compliance windows, and deriving them from a
  // staff render would write rows nobody in that session can even see.
  if (viewer.role === "owner") await syncComplianceNotifications();

  const sql = (v2: boolean) => `
    SELECT n.id, n.kind, n.tag, n.accent, n.icon, n.title, n.subline, n.when_label,
           n.flagged, n.href,
           (r.notification_id IS NOT NULL) AS read,
           ${v2 ? "n.ref, n.resolution, (n.resolved_at IS NOT NULL) AS resolved," : ""}
           EXTRACT(EPOCH FROM (now() - n.created_at))::int AS age_seconds,
           ${sqlAbsoluteLabel("n.created_at")} AS when_absolute,
           to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1
    WHERE ${audienceClause(viewer, 1, v2)}
    ORDER BY (r.notification_id IS NULL${v2 ? " AND n.resolved_at IS NULL" : ""}) DESC, n.created_at DESC
    LIMIT ${FEED_LIMIT}
  `;
  let rows: NotificationRow[];
  try {
    rows = (await query<NotificationRow>(sql(V2), [viewer.id])).rows;
  } catch (err) {
    if (!V2 || !isMissingColumn(err)) throw err;
    V2 = false;
    rows = (await query<NotificationRow>(sql(false), [viewer.id])).rows;
  }
  const notifications = rows.map(rowToCard);

  return {
    total: notifications.length,
    decisionCount: notifications.filter((n) => n.actionable).length,
    unread: notifications.filter((n) => !n.read).length,
    filters: [
      { key: "all", label: "All" },
      { key: "unread", label: "Unread" },
      { key: "decision", label: "Decisions" },
      { key: "mention", label: "Mentions" },
      { key: "job", label: "Jobs" },
      { key: "money", label: "Money" },
      { key: "compliance", label: "Compliance" },
    ],
    notifications,
  };
}
