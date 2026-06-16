// Schedule screen data builder (Phase 3.1 — the week-strip + daily-log view).
//
// One source of truth for /schedule, consumed two ways:
//   • app/schedule/page.tsx       — calls getScheduleData() directly (server render)
//   • app/api/schedule/route.ts   — exposes the same payload over HTTP
//
// DB-backed (Phase 7-B): the week strip reads schedule_blocks and the daily-log
// lane reads daily_logs, both scoped to the week containing CURRENT_DATE (so the
// view always lands on "this week"). The AI conflict note routes through
// lib/ai.ts — never import a provider here.

import { ai } from "./ai";
import { query } from "./db";

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

interface DayRow {
  iso: string;
  dow: string;
  date: string;
  today: boolean;
}
interface BlockRow {
  iso: string;
  time_label: string;
  label: string;
  tone: string;
}
interface LogRow {
  iso: string;
  body: string;
  photos: number;
}
interface WeekRow {
  weeknum: string;
  range_start: string;
  range_end: string;
}

/** SQL for the Monday/Friday of the week `offset` weeks from the current one.
 *  `offset` is coerced to a safe integer before interpolation. */
function weekBounds(offset: number) {
  const n = Math.trunc(Number.isFinite(offset) ? offset : 0);
  const monday = `(date_trunc('week', CURRENT_DATE) + interval '${n} week')`;
  const friday = `(${monday} + interval '4 day')`;
  return { monday, friday };
}

export async function getScheduleData(weekOffset = 0): Promise<ScheduleData> {
  const { monday: MONDAY, friday: FRIDAY } = weekBounds(weekOffset);
  const [daysRes, blocksRes, logsRes, weekRes, suggestRes] = await Promise.all([
    query<DayRow>(`
      SELECT to_char(d, 'YYYY-MM-DD') AS iso,
             to_char(d, 'DY')         AS dow,
             to_char(d, 'FMDD')       AS date,
             (d::date = CURRENT_DATE) AS today
      FROM generate_series(${MONDAY}, ${FRIDAY}, interval '1 day') d
      ORDER BY d`),
    query<BlockRow>(`
      SELECT to_char(block_date, 'YYYY-MM-DD') AS iso, time_label, label, tone
      FROM schedule_blocks
      WHERE block_date >= ${MONDAY} AND block_date <= ${FRIDAY}
      ORDER BY block_date, sort_min`),
    query<LogRow>(`
      SELECT to_char(log_date, 'YYYY-MM-DD') AS iso, body, photos
      FROM daily_logs
      WHERE log_date >= ${MONDAY} AND log_date <= ${FRIDAY}`),
    query<WeekRow>(`
      SELECT to_char(${MONDAY}, 'FMIW')           AS weeknum,
             to_char(${MONDAY}, 'FMMon FMDD')     AS range_start,
             to_char(${FRIDAY}, 'FMDD')           AS range_end`),
    ai.suggest({
      kind: "schedule-conflicts",
      context:
        "Week site schedule. Brad (paint) is booked for Reyes paint and " +
        "Henderson punch on the same day; Marco runs tile Mon–Tue.",
    }),
  ]);

  const blocksByDay = new Map<string, ScheduleBlock[]>();
  for (const b of blocksRes.rows) {
    const tone: BlockTone = b.tone === "accent" || b.tone === "ai" ? b.tone : "ghost";
    const list = blocksByDay.get(b.iso) ?? [];
    list.push({ time: b.time_label, label: b.label, tone });
    blocksByDay.set(b.iso, list);
  }

  const logsByDay = new Map<string, LogRow>();
  for (const l of logsRes.rows) logsByDay.set(l.iso, l);

  const days: ScheduleDay[] = daysRes.rows.map((d) => ({
    dow: d.dow,
    date: d.date,
    today: d.today,
    blocks: blocksByDay.get(d.iso) ?? [],
  }));

  const entries: DailyLogEntry[] = daysRes.rows.map((d) => {
    const log = logsByDay.get(d.iso);
    return {
      dow: d.dow,
      logged: !!log,
      today: d.today,
      body: log?.body ?? "",
      photos: log?.photos ?? 0,
    };
  });

  const week = weekRes.rows[0];
  const conflictNote =
    suggestRes.suggestions[0] ??
    "Reyes paint collides with Henderson punch this week — Brad is double-booked.";

  return {
    weekLabel: `WEEK ${week?.weeknum ?? ""}`,
    rangeLabel: `${week?.range_start ?? ""} – ${week?.range_end ?? ""}`,
    conflictNote,
    days,
    logs: {
      loggedCount: entries.filter((e) => e.logged).length,
      total: entries.length,
      entries,
    },
  };
}
