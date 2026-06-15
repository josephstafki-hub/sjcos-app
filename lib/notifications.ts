// Notifications feed builder. Mock-backed today; swaps to DB queries in Phase 7
// (the notifications table already exists — see db/schema.sql). Shape stays
// stable.
//
// `kind` stays the canonical 5-value NotificationKind (matches the schema CHECK
// + drives the filter chips). Display-only fields (tag / icon / accent) ride
// alongside so a card can read "INTAKE" while still filtering under its kind.
// The red border tracks `flagged` (the urgent flag-accent cards), which is how
// the design renders it — decisions plus any other urgent item (e.g. an
// expiring COI).

import type { NotificationKind } from "./types";

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
  /** Relative timestamp display, e.g. "Just now" / "5h 12m". */
  when: string;
  /** Red border + flag tint. */
  flagged: boolean;
  href: string;
  icon: NotifIcon;
}

const NOTIFICATIONS: NotificationCard[] = [
  {
    id: "reyes-demand",
    kind: "decision",
    tag: "Decision",
    accent: "flag",
    title: "Reyes invoice hits Day 15 today — send demand letter?",
    subline: "Draft ready · $4,800 outstanding",
    when: "Just now",
    flagged: true,
    href: "/projects/reyes-bath",
    icon: "money",
  },
  {
    id: "chen-reply",
    kind: "decision",
    tag: "Decision",
    accent: "flag",
    title: "Reply to Maria Chen (Phase 1 lead)",
    subline: "Quartz alternate draft ready",
    when: "5h 12m",
    flagged: true,
    href: "/inbox",
    icon: "mail",
  },
  {
    id: "sandberg-warranty",
    kind: "decision",
    tag: "Decision",
    accent: "flag",
    title: "Sandberg warranty claim · ack deadline Fri",
    subline: "Cabinet hinge · reply drafted",
    when: "4 hrs",
    flagged: true,
    href: "/warranty",
    icon: "star",
  },
  {
    id: "claude-henderson",
    kind: "mention",
    tag: "Mention",
    accent: "ai",
    title: "@claude posted in #henderson-kitchen",
    subline: "Pinned QC checklist + Friday flatness photo",
    when: "6 hrs",
    flagged: false,
    href: "/chat",
    icon: "chat",
  },
  {
    id: "henderson-tile",
    kind: "job",
    tag: "Job",
    accent: "accent",
    title: "Henderson tile install starts in 4h",
    subline: "Marco on the way · materials verified on site",
    when: "8 hrs",
    flagged: false,
    href: "/projects/henderson-kitchen",
    icon: "project",
  },
  {
    id: "olson-cleared",
    kind: "money",
    tag: "Money",
    accent: "money",
    title: "Olson final · $8,200 cleared",
    subline: "Stripe → SJC Operating · auto-marked paid",
    when: "Yesterday",
    flagged: false,
    href: "/projects/olson-porch",
    icon: "money",
  },
  {
    id: "cole-intake",
    kind: "job",
    tag: "Intake",
    accent: "ghost",
    title: "New site form · A. Cole · basement bar",
    subline: "5-question reply queued",
    when: "Sat 4:12p",
    flagged: false,
    href: "/leads/a-cole",
    icon: "site",
  },
  {
    id: "lund-coi",
    kind: "compliance",
    tag: "Compliance",
    accent: "flag",
    title: "Carl Lund COI expires Jun 1",
    subline: "AI auto-requested renewal",
    when: "Sat",
    flagged: true,
    href: "/compliance",
    icon: "shield",
  },
];

/** Filter selector value — "all" plus the canonical notification kinds. */
export type NotifFilter = "all" | NotificationKind;

export interface NotificationsData {
  total: number;
  decisionCount: number;
  filters: { key: NotifFilter; label: string }[];
  notifications: NotificationCard[];
}

export async function getNotificationsData(): Promise<NotificationsData> {
  const decisionCount = NOTIFICATIONS.filter((n) => n.kind === "decision").length;

  return {
    total: NOTIFICATIONS.length,
    decisionCount,
    filters: [
      { key: "all", label: "All" },
      { key: "decision", label: "Decisions" },
      { key: "mention", label: "Mentions" },
      { key: "job", label: "Jobs" },
      { key: "money", label: "Money" },
      { key: "compliance", label: "Compliance" },
    ],
    notifications: NOTIFICATIONS,
  };
}
