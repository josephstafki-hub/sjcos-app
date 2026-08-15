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
}

/** Filter selector value — "all" plus the canonical notification kinds. */
export type NotifFilter = "all" | NotificationKind;

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
}

function rowToCard(r: NotificationRow): NotificationCard {
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
    flagged: r.flagged,
    href: r.href ?? "#",
    icon: (r.icon ?? "star") as NotifIcon,
    read: r.read,
  };
}

/** Lightweight unread tally for the topbar bell dot — avoids building the
 *  full feed on every page render. */
export async function getUnreadCount(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `SELECT count(*)::int AS n FROM notifications WHERE read = false`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function getNotificationsData(): Promise<NotificationsData> {
  // Derive time-based compliance notifications before reading the feed
  // (idempotent; see lib/notify.ts). Best-effort — never blocks the feed.
  await syncComplianceNotifications();

  const { rows } = await query<NotificationRow>(`
    SELECT id, kind, tag, accent, icon, title, subline, when_label, flagged, href, read,
           EXTRACT(EPOCH FROM (now() - created_at))::int AS age_seconds,
           ${sqlAbsoluteLabel("created_at")} AS when_absolute,
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
    FROM notifications
    ORDER BY read ASC, created_at DESC
  `);
  const notifications = rows.map(rowToCard);

  return {
    total: notifications.length,
    decisionCount: notifications.filter((n) => n.kind === "decision" && !n.read).length,
    unread: notifications.filter((n) => !n.read).length,
    filters: [
      { key: "all", label: "All" },
      { key: "decision", label: "Decisions" },
      { key: "mention", label: "Mentions" },
      { key: "job", label: "Jobs" },
      { key: "money", label: "Money" },
      { key: "compliance", label: "Compliance" },
    ],
    notifications,
  };
}
