// Today screen data builder.
//
// One source of truth for the /today dashboard, consumed two ways:
//   • app/today/page.tsx       — calls getTodayData() directly (server render)
//   • app/api/today/route.ts   — exposes the same payload over HTTP
//
// Today it stitches together the mock AI brief (lib/ai.ts) with curated sample
// content. In Phase 7 the body of getTodayData() swaps to real DB queries +
// real AI — the shape below, and every screen that reads it, stay unchanged.

import { ai } from "./ai";
import type { ChipKind } from "@/components/ui/Chip";

type DotKind = "flag" | "accent" | "ai" | "money" | "ghost";

export interface TodayPriority {
  tag: string;
  dot: DotKind;
  rank: string;
  title: string;
  sub: string;
}

export interface TodayScheduleBlock {
  time: string;
  label: string;
  dot: DotKind;
}

export interface TodayCalDay {
  dow: string;
  day: string;
  today: boolean;
}

export interface TodayData {
  dateLabel: string;
  greeting: string;
  weekLabel: string;
  headerChips: { kind: ChipKind; label: string }[];
  briefHeadline: string;
  briefBody: string;
  priorities: TodayPriority[];
  week: TodayCalDay[];
  schedule: TodayScheduleBlock[];
  waiting: { items: string[]; total: number };
}

/** Mon–Sun strip for the week containing `ref`, flagging the current day. */
function weekStrip(ref: Date): TodayCalDay[] {
  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  const monday = new Date(ref);
  const offset = (ref.getDay() + 6) % 7; // days since Monday
  monday.setDate(ref.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return {
      dow: dows[d.getDay()],
      day: String(d.getDate()),
      today: d.toDateString() === ref.toDateString(),
    };
  });
}

export async function getTodayData(): Promise<TodayData> {
  const now = new Date();
  const dateLabel = now
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();

  // The brief text comes from the AI service — the only AI touch-point here.
  const brief = await ai.brief({
    date: now.toISOString().slice(0, 10),
    ownerName: "Joe",
    projects: [
      { name: "Henderson kitchen", status: "active", progress: 62 },
      { name: "Reyes addition", status: "closeout", progress: 91 },
    ],
    threadsNeedingReply: 3,
  });

  return {
    dateLabel,
    greeting: "Good morning, Joe.",
    weekLabel: "4 ACTIVE JOBS",
    headerChips: [
      { kind: "money", label: "$32,400 due this week" },
      { kind: "flag", label: "2 leads cooling" },
    ],
    briefHeadline: "Today's brief",
    briefBody: brief.summary,
    priorities: [
      {
        tag: "LEAD · 18h",
        dot: "flag",
        rank: "#1",
        title: "Reply to Maria Chen — Phase 1 estimate question",
        sub: "Asked about a countertop swap. Claude drafted a response.",
      },
      {
        tag: "JOB · HENDERSON",
        dot: "accent",
        rank: "#2",
        title: "QC walk before tile install",
        sub: "Sub arrives 1:00pm · ~12 min on-site needed.",
      },
      {
        tag: "MONEY · REYES",
        dot: "flag",
        rank: "#3",
        title: "Day 15 — review & send demand letter",
        sub: "Draft ready · $4,800 outstanding.",
      },
      {
        tag: "MARKETING",
        dot: "ai",
        rank: "#4",
        title: "Approve 3 social posts (Olson closeout)",
        sub: "Captions + photo crops ready.",
      },
    ],
    week: weekStrip(now),
    schedule: [
      { time: "8:00", label: "Daily sub check-in calls", dot: "ghost" },
      { time: "10:30", label: "Site stop — Henderson", dot: "accent" },
      { time: "1:00", label: "QC walk before tile (Henderson)", dot: "accent" },
      { time: "3:30", label: "New lead call — Pham residence", dot: "ai" },
    ],
    waiting: {
      total: 7,
      items: [
        "Approve change-order narrative — Henderson",
        "Sign sub agreement — Tomas (electric)",
        "Confirm marble selection — Chen lead",
        "Review weekly P&L",
      ],
    },
  };
}
