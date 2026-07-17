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
  /** True for auto-derived entries (project start/end dates, lead-task due
   *  dates, warranty deadlines) — computed live from the entities, never stored
   *  in schedule_blocks. Rendered read-only with an "AUTO" tag. */
  auto?: boolean;
  /** Link target for derived entries that aren't tied to a project slug
   *  (a lead page, the warranty board). */
  href?: string;
  hrefLabel?: string;
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
/** A read-only schedule entry derived live from a project/lead/warranty date.
 *  `source` picks the tone; `project_slug`/`href` decide the footer link. */
interface DerivedRow {
  iso: string;
  time_label: string;
  label: string;
  source: string;
  project_slug: string | null;
  project_name: string | null;
  href: string | null;
  href_label: string | null;
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
  const [daysRes, blocksRes, logsRes, weekRes, derivedRes] = await Promise.all([
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
    // Auto-derived entries (P1-E1): schedule-relevant dates pulled live from
    // Projects, Leads (open follow-up tasks), and Warranties, bounded to the
    // visible week. Nothing here is stored in schedule_blocks. `src_rank` keeps
    // the per-day order stable (project starts/ends → lead tasks → warranty).
    query<DerivedRow>(`
      SELECT iso, time_label, label, source, src_rank,
             project_slug, project_name, href, href_label
      FROM (
        SELECT to_char(p.start_date, 'YYYY-MM-DD') AS iso, 'START' AS time_label,
               'Project start' AS label, 'project' AS source, 1 AS src_rank,
               p.slug AS project_slug, p.name AS project_name,
               NULL::text AS href, NULL::text AS href_label
        FROM projects p
        WHERE p.start_date >= ${MONDAY} AND p.start_date <= ${FRIDAY}
        UNION ALL
        SELECT to_char(p.target_end_date, 'YYYY-MM-DD'), 'END',
               'Target completion', 'project', 2,
               p.slug, p.name, NULL, NULL
        FROM projects p
        WHERE p.target_end_date >= ${MONDAY} AND p.target_end_date <= ${FRIDAY}
        UNION ALL
        SELECT to_char(t.due_date, 'YYYY-MM-DD'), 'DUE',
               t.title, 'lead', 3,
               NULL, NULL, '/leads/' || l.slug, l.name
        FROM lead_tasks t
        JOIN leads l ON l.id = t.lead_id
        WHERE t.done = false AND l.stage <> 'lost'
          AND t.due_date >= ${MONDAY} AND t.due_date <= ${FRIDAY}
        UNION ALL
        SELECT to_char(w.warranty_ends_at, 'YYYY-MM-DD'), 'WTY',
               'Warranty ends', 'warranty', 4,
               NULL, NULL, '/warranty', w.project
        FROM warranty_projects w
        WHERE w.warranty_ends_at >= ${MONDAY} AND w.warranty_ends_at <= ${FRIDAY}
        UNION ALL
        SELECT to_char(c.ack_deadline_at, 'YYYY-MM-DD'), 'ACK',
               'Ack due: ' || c.issue, 'warranty', 5,
               cp.slug, cp.name, '/warranty', c.project
        FROM warranty_claims c
        LEFT JOIN projects cp ON cp.id = c.project_id
        WHERE c.acknowledged = false AND c.resolved = false
          AND c.ack_deadline_at >= ${MONDAY} AND c.ack_deadline_at <= ${FRIDAY}
        UNION ALL
        SELECT to_char(c.resolve_deadline_at, 'YYYY-MM-DD'), 'FIX',
               'Resolve due: ' || c.issue, 'warranty', 6,
               cp.slug, cp.name, '/warranty', c.project
        FROM warranty_claims c
        LEFT JOIN projects cp ON cp.id = c.project_id
        WHERE c.resolved = false
          AND c.resolve_deadline_at >= ${MONDAY} AND c.resolve_deadline_at <= ${FRIDAY}
      ) d
      ORDER BY iso, src_rank, label`),
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

  // Derived entries append after the day's manual blocks (which carry real
  // clock times); tone keys off the source: job dates = accent, lead follow-ups
  // = ai, warranty = ghost.
  const DERIVED_TONE: Record<string, BlockTone> = {
    project: "accent",
    lead: "ai",
    warranty: "ghost",
  };
  const derivedByDay = new Map<string, ScheduleBlock[]>();
  for (const r of derivedRes.rows) {
    const list = derivedByDay.get(r.iso) ?? [];
    list.push({
      time: r.time_label,
      label: r.label,
      tone: DERIVED_TONE[r.source] ?? "ghost",
      auto: true,
      projectSlug: r.project_slug ?? undefined,
      projectName: r.project_name ?? undefined,
      href: r.project_slug ? undefined : r.href ?? undefined,
      hrefLabel: r.project_slug ? undefined : r.href_label ?? undefined,
    });
    derivedByDay.set(r.iso, list);
  }

  const logsByDay = new Map<string, LogRow>();
  for (const l of logsRes.rows) logsByDay.set(l.iso, l);

  const days: ScheduleDay[] = daysRes.rows.map((d) => ({
    dow: d.dow,
    date: d.date,
    iso: d.iso,
    today: d.today,
    blocks: [...(blocksByDay.get(d.iso) ?? []), ...(derivedByDay.get(d.iso) ?? [])],
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
