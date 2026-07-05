// Schedule screen data builder (Phase 3.1 — the week-strip + daily-log view).
//
// One source of truth for /schedule, consumed two ways:
//   • app/schedule/page.tsx       — calls getScheduleData() directly (server render)
//   • app/api/schedule/route.ts   — exposes the same payload over HTTP
//
// DB-backed (Phase 7-B): the week strip reads schedule_blocks and the daily-log
// lane reads daily_logs, both scoped to the week containing CURRENT_DATE (so the
// view always lands on "this week"). The conflict note is computed here from
// real blocks (deterministic — no AI call, nothing invented).

import { query } from "./db";

/** Color treatment for a timeblock pill — job (accent), AI-scheduled (ai), or
 *  routine/other (ghost). Matches the design's `d` field. */
export type BlockTone = "accent" | "ai" | "ghost";

export interface ScheduleBlock {
  /** Time label, e.g. "8:00" / "AM" / "all". */
  time: string;
  label: string;
  tone: BlockTone;
  /** The project this block belongs to, if any. NULL = standalone meeting. */
  projectSlug?: string;
  projectName?: string;
}

/** A project option for the "Block / New meeting" picker. */
export interface ScheduleProject {
  id: string;
  slug: string;
  name: string;
}

export interface ScheduleDay {
  dow: string;
  /** Day-of-month, e.g. "25". */
  date: string;
  /** ISO date (YYYY-MM-DD) for prefilling the add-block form. */
  iso: string;
  today: boolean;
  blocks: ScheduleBlock[];
}

export interface DailyLogEntry {
  dow: string;
  /** ISO date (YYYY-MM-DD) of the log. */
  iso: string;
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
  project_slug: string | null;
  project_name: string | null;
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
 *  The strip only shows Mon–Fri, so on Sat/Sun "this week" rolls forward to the
 *  upcoming week (the finished one isn't useful). `offset` is coerced to a safe
 *  integer before interpolation. */
function weekBounds(offset: number) {
  const n = Math.trunc(Number.isFinite(offset) ? offset : 0);
  const monday =
    `(date_trunc('week', CURRENT_DATE)` +
    ` + (CASE WHEN extract(isodow FROM CURRENT_DATE) >= 6 THEN interval '1 week' ELSE interval '0' END)` +
    ` + interval '${n} week')`;
  const friday = `(${monday} + interval '4 day')`;
  return { monday, friday };
}

export async function getScheduleData(weekOffset = 0): Promise<ScheduleData> {
  const { monday: MONDAY, friday: FRIDAY } = weekBounds(weekOffset);
  const [daysRes, blocksRes, logsRes, weekRes] = await Promise.all([
    query<DayRow>(`
      SELECT to_char(d, 'YYYY-MM-DD') AS iso,
             to_char(d, 'DY')         AS dow,
             to_char(d, 'FMDD')       AS date,
             (d::date = CURRENT_DATE) AS today
      FROM generate_series(${MONDAY}, ${FRIDAY}, interval '1 day') d
      ORDER BY d`),
    query<BlockRow>(`
      SELECT to_char(b.block_date, 'YYYY-MM-DD') AS iso, b.time_label, b.label, b.tone,
             p.slug AS project_slug, p.name AS project_name
      FROM schedule_blocks b
      LEFT JOIN projects p ON p.id = b.project_id
      WHERE b.block_date >= ${MONDAY} AND b.block_date <= ${FRIDAY}
      ORDER BY b.block_date, b.sort_min`),
    query<LogRow>(`
      SELECT to_char(log_date, 'YYYY-MM-DD') AS iso, body, photos
      FROM daily_logs
      WHERE project_id IS NULL
        AND log_date >= ${MONDAY} AND log_date <= ${FRIDAY}`),
    query<WeekRow>(`
      SELECT to_char(${MONDAY}, 'FMIW')           AS weeknum,
             to_char(${MONDAY}, 'FMMon FMDD')     AS range_start,
             to_char(${FRIDAY}, 'FMMon FMDD')     AS range_end`),
  ]);

  const blocksByDay = new Map<string, ScheduleBlock[]>();
  for (const b of blocksRes.rows) {
    const tone: BlockTone = b.tone === "accent" || b.tone === "ai" ? b.tone : "ghost";
    const list = blocksByDay.get(b.iso) ?? [];
    list.push({
      time: b.time_label,
      label: b.label,
      tone,
      projectSlug: b.project_slug ?? undefined,
      projectName: b.project_name ?? undefined,
    });
    blocksByDay.set(b.iso, list);
  }

  const logsByDay = new Map<string, LogRow>();
  for (const l of logsRes.rows) logsByDay.set(l.iso, l);

  const days: ScheduleDay[] = daysRes.rows.map((d) => ({
    dow: d.dow,
    date: d.date,
    iso: d.iso,
    today: d.today,
    blocks: blocksByDay.get(d.iso) ?? [],
  }));

  const entries: DailyLogEntry[] = daysRes.rows.map((d) => {
    const log = logsByDay.get(d.iso);
    return {
      dow: d.dow,
      iso: d.iso,
      logged: !!log,
      today: d.today,
      body: log?.body ?? "",
      photos: log?.photos ?? 0,
    };
  });

  const week = weekRes.rows[0];

  return {
    weekLabel: `WEEK ${week?.weeknum ?? ""}`,
    rangeLabel: `${week?.range_start ?? ""} – ${week?.range_end ?? ""}`,
    days,
    logs: {
      loggedCount: entries.filter((e) => e.logged).length,
      total: entries.length,
      entries,
    },
  };
}

/** Active projects for the block/meeting picker, most-recent first. */
export async function getScheduleProjects(): Promise<ScheduleProject[]> {
  const { rows } = await query<ScheduleProject>(
    `SELECT id, slug, name FROM projects ORDER BY created_at DESC, name`,
  );
  return rows;
}

/** A real schedule block scoped to one project (project Schedule tab). */
export interface ProjectScheduleBlock {
  id: string;
  iso: string;
  dateLabel: string;
  time: string;
  label: string;
  tone: "accent" | "ai" | "ghost";
}

/** All schedule blocks linked to a project, chronological. Powers the project
 *  Schedule tab (distinct from the cross-project /schedule overview). */
export async function getProjectScheduleBlocks(slug: string): Promise<ProjectScheduleBlock[]> {
  const { rows } = await query<{
    id: string;
    iso: string;
    date_label: string;
    time_label: string;
    label: string;
    tone: "accent" | "ai" | "ghost";
  }>(
    `SELECT sb.id,
            to_char(sb.block_date, 'YYYY-MM-DD')   AS iso,
            to_char(sb.block_date, 'Dy Mon FMDD')  AS date_label,
            sb.time_label, sb.label, sb.tone
       FROM schedule_blocks sb
       JOIN projects p ON p.id = sb.project_id
      WHERE p.slug = $1
      ORDER BY sb.block_date, sb.sort_min, sb.id`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    iso: r.iso,
    dateLabel: r.date_label,
    time: r.time_label,
    label: r.label,
    tone: r.tone,
  }));
}

/** Available (non-archived) schedule templates for the "Generate schedule"
 *  picker (7-sched), with a phase count for the label. */
export interface ScheduleTemplateOption {
  id: number;
  name: string;
  phases: number;
}

export async function getScheduleTemplates(): Promise<ScheduleTemplateOption[]> {
  const { rows } = await query<{ id: number; name: string; phases: number }>(
    `SELECT t.id, t.name, count(p.id)::int AS phases
       FROM schedule_templates t
       LEFT JOIN schedule_template_phases p ON p.template_id = t.id
      WHERE t.archived = false
      GROUP BY t.id, t.name
      ORDER BY t.name`,
  );
  return rows;
}

/** The scheduling-conflict note, loaded separately (see AiStream) so the week
 *  view paints first. Deterministic and grounded in the real week's blocks: a
 *  conflict is two blocks on the same day claiming the same time slot. Never
 *  invents names or jobs. */
export async function getScheduleConflict(): Promise<string> {
  const { monday: MONDAY, friday: FRIDAY } = weekBounds(0);
  const { rows } = await query<{
    iso: string;
    day_label: string;
    time_label: string;
    label: string;
  }>(`
    SELECT to_char(b.block_date, 'YYYY-MM-DD')    AS iso,
           to_char(b.block_date, 'Dy FMMon FMDD') AS day_label,
           b.time_label, b.label
      FROM schedule_blocks b
     WHERE b.block_date >= ${MONDAY} AND b.block_date <= ${FRIDAY}
     ORDER BY b.block_date, b.sort_min`);

  if (rows.length === 0) {
    return "Nothing on the site schedule this week — no conflicts to flag.";
  }

  const clashes: string[] = [];
  const bySlot = new Map<string, string>();
  for (const r of rows) {
    const slot = `${r.iso}|${r.time_label.trim().toLowerCase()}`;
    const prev = bySlot.get(slot);
    if (prev) {
      clashes.push(`${r.day_label}: “${prev}” and “${r.label}” are both booked for ${r.time_label}`);
    } else {
      bySlot.set(slot, r.label);
    }
  }
  if (clashes.length > 0) {
    const more = clashes.length > 1 ? ` (+${clashes.length - 1} more)` : "";
    return `Double-booked — ${clashes[0]}.${more}`;
  }

  const dayCount = new Set(rows.map((r) => r.iso)).size;
  return `No conflicts this week — ${rows.length} block${rows.length === 1 ? "" : "s"} across ${dayCount} day${dayCount === 1 ? "" : "s"}, no double-bookings.`;
}
