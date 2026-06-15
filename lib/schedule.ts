// Schedule screen data builder (Phase 3.1 — the week-strip + daily-log view).
//
// One source of truth for /schedule, consumed two ways:
//   • app/schedule/page.tsx       — calls getScheduleData() directly (server render)
//   • app/api/schedule/route.ts   — exposes the same payload over HTTP
//
// Mock-backed today. The week strip + daily logs become DB-driven in Phase 7
// (the projects table already exists; daily_logs gets added then). The AI
// conflict note routes through lib/ai.ts so the implementation swaps with zero
// screen-code changes — never import a provider here.

import { ai } from "./ai";

/** Color treatment for a timeblock pill — job (accent), AI-scheduled (ai), or
 *  routine/other (ghost). Matches the design's `d` field. */
export type BlockTone = "accent" | "ai" | "ghost";

export interface ScheduleBlock {
  /** Time label, e.g. "8:00" / "AM" / "all". */
  time: string;
  label: string;
  tone: BlockTone;
}

export interface ScheduleDay {
  dow: string;
  /** Day-of-month, e.g. "25". */
  date: string;
  today: boolean;
  blocks: ScheduleBlock[];
}

export interface DailyLogEntry {
  dow: string;
  logged: boolean;
  today: boolean;
  /** Body text when logged; empty otherwise. */
  body: string;
  /** Photo count attached to the log. */
  photos: number;
}

export interface ScheduleData {
  weekLabel: string;
  rangeLabel: string;
  /** AI scheduling-conflict note shown in the brief bubble. */
  conflictNote: string;
  days: ScheduleDay[];
  logs: {
    loggedCount: number;
    total: number;
    entries: DailyLogEntry[];
  };
}

const DAYS: ScheduleDay[] = [
  {
    dow: "MON",
    date: "25",
    today: true,
    blocks: [
      { time: "8:00", label: "Sub check-ins", tone: "ghost" },
      { time: "12:45", label: "QC walk · Henderson", tone: "accent" },
      { time: "1:00", label: "Tile · Marco · Henderson", tone: "accent" },
      { time: "3:30", label: "New lead call · Pham", tone: "ai" },
    ],
  },
  {
    dow: "TUE",
    date: "26",
    today: false,
    blocks: [
      { time: "8:00", label: "Tile day 2 · Marco", tone: "accent" },
      { time: "9:00", label: "Chen site walk", tone: "ai" },
      { time: "4:00", label: "Olson client walk", tone: "ai" },
    ],
  },
  {
    dow: "WED",
    date: "27",
    today: false,
    blocks: [
      { time: "8:00", label: "Grout · Henderson", tone: "accent" },
      { time: "10:00", label: "Reyes drywall day 3", tone: "ghost" },
    ],
  },
  {
    dow: "THU",
    date: "28",
    today: false,
    blocks: [{ time: "all", label: "Reyes paint", tone: "ghost" }],
  },
  {
    dow: "FRI",
    date: "29",
    today: false,
    blocks: [
      { time: "AM", label: "Plumbing fixtures · Tomas", tone: "ghost" },
      { time: "PM", label: "Weekly close + invoice", tone: "ai" },
    ],
  },
];

const LOGS: DailyLogEntry[] = [
  {
    dow: "MON",
    logged: false,
    today: true,
    body: "Tile underway in the main bath — Marco set the field by 3pm, niche tomorrow. QC walk flagged one soft spot at the threshold; subfloor screwed off and re-checked flat.",
    photos: 3,
  },
  { dow: "TUE", logged: false, today: false, body: "", photos: 0 },
  { dow: "WED", logged: false, today: false, body: "", photos: 0 },
  { dow: "THU", logged: false, today: false, body: "", photos: 0 },
  { dow: "FRI", logged: false, today: false, body: "", photos: 0 },
];

export async function getScheduleData(): Promise<ScheduleData> {
  // The conflict note is the only AI touch-point here — the model spots the
  // double-booking; the screen just renders it.
  const { suggestions } = await ai.suggest({
    kind: "schedule-conflicts",
    context:
      "Week 22 site schedule. Brad (paint) is booked for Reyes paint and " +
      "Henderson punch on the same day; Marco runs tile Mon–Tue.",
  });

  const conflictNote =
    suggestions[0] ??
    "Reyes paint collides with Henderson punch on May 30 — Brad is double-booked.";

  return {
    weekLabel: "WEEK 22",
    rangeLabel: "May 25 – 29",
    conflictNote,
    days: DAYS,
    logs: {
      loggedCount: LOGS.filter((l) => l.logged).length,
      total: LOGS.length,
      entries: LOGS,
    },
  };
}
