// Today screen data builder.
//
// One source of truth for the /today dashboard, consumed two ways:
//   • app/today/page.tsx       — calls getTodayData() directly (server render)
//   • app/api/today/route.ts   — exposes the same payload over HTTP
//
// DB-backed (Phase 7.2): the header metrics (active jobs, outstanding A/R,
// leads needing attention) and the AI brief inputs are derived from real
// leads/projects rows via lib/db. Priorities / waiting-on-me now pull from
// SJC OS work_items first, with lead/compliance/job signals filling in after.
// The AI brief still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";
import { laneFor, type Lane } from "./today-triage";
import type { ChipKind } from "@/components/ui/Chip";

type DotKind = "flag" | "accent" | "ai" | "money" | "ghost";

export interface TodayPriority {
  /** work_items.id for backlog-sourced items (checkable on click); a stable
   *  synthetic id (e.g. "lead:slug") for the always-on signal types. */
  id: string;
  /** True for work_items-backed cards — the only ones that participate in
   *  the promote/check-on-click cycle with Waiting on me. */
  checkable: boolean;
  tag: string;
  dot: DotKind;
  rank: string;
  title: string;
  sub: string;
  /** Triage lane (Today v2): chat = an agent can complete it via MCP; quick =
   *  one human click; deep = real page work. See lib/today-triage.ts. */
  lane: Lane;
  /** Where clicking the priority navigates (the source record). */
  href?: string;
}

export interface TodayScheduleBlock {
  time: string;
  label: string;
  dot: DotKind;
  href?: string;
}

export interface TodayCalDay {
  dow: string;
  day: string;
  /** YYYY-MM-DD for this cell. */
  iso: string;
  today: boolean;
  /** That day's schedule blocks (for the inline day summary). */
  blocks: { time: string; label: string; dot: DotKind }[];
}

export interface TodayData {
  dateLabel: string;
  greeting: string;
  weekLabel: string;
  headerChips: { kind: ChipKind; label: string }[];
  briefHeadline: string;
  /** Inputs for the AI brief, resolved lazily so the page paints instantly and
   *  the brief streams in (CPU Qwen is ~15s — see getTodayBrief + Suspense). */
  briefInputs: BriefInput;
  priorities: TodayPriority[];
  week: TodayCalDay[];
  schedule: TodayScheduleBlock[];
  waiting: { items: WaitingItem[]; total: number };
}

export interface WaitingItem {
  id: string;
  label: string;
  href?: string;
  lane: Lane;
  /** True for work_items-backed rows — the only ones the queue actions can
   *  mark done / snooze. Signal cards (warranty/lead/compliance/…) are false. */
  checkable: boolean;
}

export interface BriefInput {
  date: string;
  ownerName: string;
  projects: { name: string; status: string; progress: number }[];
  threadsNeedingReply: number;
  /** The displayed Priorities rail, so the brief can narrate lanes. */
  queue: { rank: string; title: string; lane: Lane; tag: string }[];
}

/** YYYY-MM-DD in local time. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Monday of the week containing `ref`. */
function weekMonday(ref: Date): Date {
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - ((ref.getDay() + 6) % 7));
  return monday;
}

/** Mon–Sun strip for the week containing `ref`, flagging the current day. Each
 *  day's `blocks` are filled from `byDay` (iso → blocks). */
function weekStrip(
  ref: Date,
  byDay: Map<string, { time: string; label: string; dot: DotKind }[]>,
): TodayCalDay[] {
  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  const monday = weekMonday(ref);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = isoDate(d);
    return {
      dow: dows[d.getDay()],
      day: String(d.getDate()),
      iso,
      today: d.toDateString() === ref.toDateString(),
      blocks: byDay.get(iso) ?? [],
    };
  });
}

/** Time-of-day greeting for the server's local hour. */
function greetingFor(hour: number, name: string): string {
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, ${name}.`;
}

interface TodayProjectRow {
  slug: string;
  name: string;
  status: string;
  progress: number;
  outstanding: number;
}

export interface TodayWorkItemRow {
  id: string;
  title: string;
  body: string | null;
  status: string;
  priority: "low" | "normal" | "high" | "urgent";
  effort_class: string | null;
  due: string | null;
  snoozed_until: string | null;
  promoted_at: string | null;
  project_slug: string | null;
  project_name: string | null;
  project_status: string | null;
  lead_slug: string | null;
  lead_name: string | null;
}

/** Joe's open backlog: work_items assigned to him with a lead/project to
 *  anchor them — plus detector-filed items (lib/detectors.ts), which may have
 *  no anchor (compliance, COI, W-9) but are Today's single source for those
 *  domains now that the raw compliance/warranty candidate queries are gone.
 *  Shared between getTodayData() (the full list) and
 *  checkPriorityCompletion() (the single next-up item), so "what's eligible"
 *  never drifts between the two. */
export const OPEN_WORK_ITEMS_SQL = `
    SELECT w.id, w.title, left(NULLIF(w.body, ''), 140) AS body,
           w.status, w.priority, w.effort_class,
           to_char(w.due_at, 'FMMon FMDD') AS due,
           w.snoozed_until,
           w.promoted_at,
           p.slug AS project_slug, p.name AS project_name, p.status AS project_status,
           l.slug AS lead_slug, l.name AS lead_name
      FROM work_items w
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN leads l ON l.id = w.lead_id
     WHERE w.status NOT IN ('done','cancelled')
       AND w.assignee_kind = 'human'
       AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')
       AND (w.lead_id IS NOT NULL OR w.project_id IS NOT NULL
            OR w.created_by LIKE 'detector:%')
       AND (l.id IS NULL OR l.stage <> 'lost')`;

export const OPEN_WORK_ITEMS_ORDER_SQL = `
     ORDER BY array_position(ARRAY['urgent','high','normal','low'], w.priority),
              w.due_at NULLS LAST,
              w.updated_at DESC,
              w.id`;

/** work_items row → a Priorities/Waiting candidate. `checkable: true` marks
 *  it as backlog-sourced, so the client can call checkPriorityCompletion()
 *  when its card is clicked. */
export function workItemCandidate(w: TodayWorkItemRow): Omit<TodayPriority, "rank"> {
  const isLead = Boolean(w.lead_slug);
  const isWarranty = w.project_status === "warranty";
  const isProject = Boolean(w.project_slug);
  return {
    id: w.id,
    checkable: true,
    tag: isLead
      ? "LEAD TODO"
      : isWarranty
        ? `WARRANTY · ${w.project_name ?? "Project"}`
        : isProject
          ? `JOB · ${w.project_name ?? "Project"}`
          : "TODO",
    dot: w.priority === "urgent" || w.priority === "high" ? "flag" : "accent",
    lane: laneFor({ title: w.title, body: w.body, effortClass: w.effort_class }),
    title: w.title,
    sub: [w.body, w.due ? `due ${w.due}` : null].filter(Boolean).join(" · ") || w.status.replaceAll("_", " "),
    href: w.lead_slug ? `/leads/${w.lead_slug}` : isWarranty ? "/warranty" : w.project_slug ? `/projects/${w.project_slug}` : "/engine",
  };
}

/** "$32,400" style dollars with thousands separators. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

interface FlaggedLeadRow {
  slug: string;
  name: string;
  scope: string | null;
  flag_label: string | null;
}
interface ScheduleRow {
  time_label: string;
  label: string;
  tone: string;
}

/** The raw rows the Priorities/Waiting queue is built from. Fetched once and
 *  fed to buildQueue() so getTodayData() and getQueueSnapshot() share the exact
 *  same candidate pipeline (the ranking/promotion logic must never fork).
 *  Compliance-due and warranty-claim rows are no longer candidate sources —
 *  the W1 detectors (lib/detectors.ts) file those as work items, which
 *  openWorkItems already carries; raw rows here would double-list them. */
interface QueueSources {
  openWorkItems: TodayWorkItemRow[];
  flaggedLeadRows: FlaggedLeadRow[];
  scheduleRows: ScheduleRow[];
  projects: TodayProjectRow[];
}

export interface QueueSnapshot {
  priorities: TodayPriority[];
  waiting: { items: WaitingItem[]; total: number };
}

/** Run the four queries that feed the queue. Shared by getTodayData() (which
 *  also reuses projects/leads/schedule for header/brief) and getQueueSnapshot(). */
async function fetchQueueSources(): Promise<QueueSources> {
  const [projectsRes, leadsRes, workItemsRes, scheduleRes] =
    await Promise.all([
      query<TodayProjectRow>(`
        SELECT slug, name, status, progress,
               (contract_value - collected_to_date) AS outstanding
        FROM projects
        WHERE status IN ('construction', 'closeout')
        ORDER BY (status = 'construction') DESC, progress DESC, name`),
      query<FlaggedLeadRow>(`
        SELECT slug, name, scope, flag_label
        FROM leads WHERE flag_kind = 'flag' AND stage <> 'lost'
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.lead_id = leads.id)
        ORDER BY updated_at DESC`),
      query<TodayWorkItemRow>(`${OPEN_WORK_ITEMS_SQL}${OPEN_WORK_ITEMS_ORDER_SQL}`),
      query<ScheduleRow>(`
        SELECT time_label, label, tone
        FROM schedule_blocks WHERE block_date = CURRENT_DATE
        ORDER BY sort_min`),
    ]);
  return {
    projects: projectsRes.rows,
    flaggedLeadRows: leadsRes.rows,
    openWorkItems: workItemsRes.rows,
    scheduleRows: scheduleRes.rows,
  };
}

/** Build the 5-slot Priorities rail + Waiting-on-me backlog from raw sources.
 *  Auto-promotes unpromoted work items to top up empty slots (a DB write) so
 *  the rail backfills even when nobody visited /today to trigger the click-time
 *  swap. The ONE place this ranking/promotion logic lives. */
async function buildQueue(s: QueueSources): Promise<QueueSnapshot> {
  // ── Priorities: a 5-slot rail, ranked from real signals. Leads are always
  // first because new revenue beats internal/project follow-ups, then the
  // rest keep their existing source order (work queue → schedule/job).
  //
  // Work-item candidates (Hermes's backlog) only occupy a slot once
  // `promoted_at` is set — see db/schema.sql. Non-work-item signals
  // (leads/warranty/compliance/schedule/job) aren't part of that backlog, so
  // they're always eligible. If fewer than 5 slots are filled, we
  // auto-promote the next-ranked unpromoted work items to top up.
  interface Candidate extends Omit<TodayPriority, "rank"> {
    promotedAt: string | null;
    /** Set by "Snooze 3d" so a just-demoted item is excluded from
     *  auto-promotion until the snooze window passes, instead of immediately
     *  refilling its own freed slot. Null for non-work-item signal candidates
     *  (always eligible) and for work items that were never snoozed. */
    snoozedUntil: string | null;
    waitingLabel: string;
  }
  const candidates: Candidate[] = [];
  const workItemLeadSlugs = new Set(s.openWorkItems.map((w) => w.lead_slug).filter(Boolean));
  for (const w of s.openWorkItems) {
    const isWarranty = w.project_status === "warranty";
    const kind = w.lead_slug ? "Lead" : isWarranty ? "Warranty" : "Project";
    const source = w.lead_name ?? w.project_name;
    candidates.push({
      ...workItemCandidate(w),
      promotedAt: w.promoted_at,
      snoozedUntil: w.snoozed_until,
      waitingLabel: [kind, source, w.title].filter(Boolean).join(" — "),
    });
  }
  // Warranty-claim and compliance-due candidates used to be built from raw
  // rows here; the W1 warranty-unacked + compliance-due detectors now file
  // those as work items (already in openWorkItems above), so raw-row
  // candidates would list the same condition twice.
  for (const l of s.flaggedLeadRows.filter((l) => !workItemLeadSlugs.has(l.slug))) {
    candidates.push({
      id: `lead:${l.slug}`,
      checkable: false,
      lane: "deep",
      promotedAt: null,
      snoozedUntil: null,
      tag: "LEAD",
      dot: "flag",
      title: `Reply to ${l.name}`,
      sub: [l.flag_label, l.scope].filter(Boolean).join(" · ") || "Needs your attention",
      href: `/leads/${l.slug}`,
      waitingLabel: `Reply to ${l.name} — ${l.flag_label ?? "lead"}`,
    });
  }
  const firstJobBlock = s.scheduleRows.find((b) => b.tone === "accent" || b.tone === "ai");
  if (firstJobBlock) {
    candidates.push({
      id: `schedule:${firstJobBlock.label}`,
      checkable: false,
      lane: "deep",
      promotedAt: null,
      snoozedUntil: null,
      tag: "SCHEDULE",
      dot: "accent",
      title: `On site — ${firstJobBlock.label}`,
      sub: `${firstJobBlock.time_label} today`,
      href: "/schedule",
      waitingLabel: `On site — ${firstJobBlock.label} (${firstJobBlock.time_label})`,
    });
  }
  const topActive = s.projects.find((p) => p.status === "construction");
  if (topActive) {
    candidates.push({
      id: `job:${topActive.slug}`,
      checkable: false,
      lane: "deep",
      promotedAt: null,
      snoozedUntil: null,
      tag: `JOB · ${topActive.name}`,
      dot: "accent",
      title: `Keep ${topActive.name} moving`,
      sub: `${topActive.progress}% complete`,
      href: `/projects/${topActive.slug}`,
      waitingLabel: `Keep ${topActive.name} moving (${topActive.progress}% complete)`,
    });
  }
  const isLeadPriority = (c: Candidate): boolean =>
    c.tag.startsWith("LEAD") || c.href?.startsWith("/leads/") === true;
  const byLeadFirst = (a: Candidate, b: Candidate) =>
    Number(isLeadPriority(b)) - Number(isLeadPriority(a));

  const ranked = candidates.toSorted(byLeadFirst);
  const eligible = ranked.filter((c) => !c.checkable || c.promotedAt);
  // Exclude just-snoozed items from the auto-promotion pool until their
  // snooze window passes — otherwise a demoted item with no other backlog
  // competing for its lead-first slot gets immediately re-promoted into the
  // very slot it just vacated, which reads as two cards swapping places
  // instead of the snoozed one leaving Priorities. Only snoozedUntil gates
  // promotion here — but a future due_at always carries one: the
  // trg_work_items_snooze_until_due trigger (db/schema.sql) snoozes any item
  // scheduled for a later day until 00:00 Central of that day, so scheduled
  // to-dos never surface early (Joe's rule, 2026-09-02).
  const now = Date.now();
  const pool = ranked.filter(
    (c) => c.checkable && !c.promotedAt && (!c.snoozedUntil || new Date(c.snoozedUntil).getTime() <= now),
  );
  const toPromote = pool.slice(0, Math.max(0, 5 - eligible.length));
  if (toPromote.length) {
    await query(`UPDATE work_items SET promoted_at = now() WHERE id = ANY($1::uuid[])`, [
      toPromote.map((c) => c.id),
    ]);
  }

  const displayed = [...eligible, ...toPromote].toSorted(byLeadFirst).slice(0, 5);
  const displayedIds = new Set(displayed.map((c) => c.id));

  const priorities: TodayPriority[] = (
    displayed.length
      ? displayed
      : [
          {
            id: "all-clear",
            checkable: false,
            lane: "deep" as Lane,
            tag: "ALL CLEAR",
            dot: "ghost" as DotKind,
            title: "Nothing urgent today",
            sub: "No flagged items right now.",
          },
        ]
  ).map((c, i) => ({ ...c, rank: `#${i + 1}` }));

  // ── Waiting on me: the full backlog minus whatever's currently shown in
  // Priorities. This is the queue Hermes actually updates (work_items) plus
  // the other live signals — see docs/hermes-mcp.md.
  const waitingItems: WaitingItem[] = ranked
    .filter((c) => !displayedIds.has(c.id))
    .map((c) => ({ id: c.id, label: c.waitingLabel, href: c.href, lane: c.lane, checkable: c.checkable }));

  return { priorities, waiting: { total: waitingItems.length, items: waitingItems } };
}

/** Re-read the live Priorities + Waiting queue only (no schedule/brief/header).
 *  Same candidate pipeline as getTodayData() via buildQueue(). Used by the
 *  Today feed's chip actions to refresh both lists after a change. */
export async function getQueueSnapshot(): Promise<QueueSnapshot> {
  return buildQueue(await fetchQueueSources());
}

export async function getTodayData(): Promise<TodayData> {
  const now = new Date();
  const dateLabel = now
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    .toUpperCase();

  // In-flight jobs (active + closeout) drive the header metrics and the brief.
  // `flagged leads` = leads carrying the urgent "AI take" chip (flag_kind).
  const monday = weekMonday(now);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  // The queue sources (shared with getQueueSnapshot via buildQueue) plus this
  // page's own week strip. projects/leads/schedule from the sources also feed
  // the header metrics, the schedule card, and the brief.
  const [sources, weekRes] = await Promise.all([
    fetchQueueSources(),
    query<{ iso: string; time_label: string; label: string; tone: string }>(`
        SELECT block_date::text AS iso, time_label, label, tone
        FROM schedule_blocks WHERE block_date BETWEEN $1 AND $2
        ORDER BY block_date, sort_min`,
      [isoDate(monday), isoDate(sunday)]),
  ]);

  const { projects, flaggedLeadRows, scheduleRows } = sources;
  const activeCount = projects.filter((p) => p.status === "construction").length;
  const outstanding = projects.reduce((s, p) => s + Number(p.outstanding), 0);
  const flaggedLeads = flaggedLeadRows.length;

  const toneToDot = (t: string): DotKind =>
    t === "accent" || t === "ai" ? (t as DotKind) : "ghost";

  // This week's blocks grouped by ISO date, for the week-strip day summaries.
  const blocksByDay = new Map<string, { time: string; label: string; dot: DotKind }[]>();
  for (const b of weekRes.rows) {
    const list = blocksByDay.get(b.iso) ?? [];
    list.push({ time: b.time_label, label: b.label, dot: toneToDot(b.tone) });
    blocksByDay.set(b.iso, list);
  }

  // ── Today's schedule (real blocks; calm placeholder when empty) ──
  const schedule: TodayScheduleBlock[] = scheduleRows.length
    ? scheduleRows.map((b) => ({
        time: b.time_label,
        label: b.label,
        dot: toneToDot(b.tone),
        href: "/schedule",
      }))
    : [{ time: "—", label: "Nothing scheduled — add a block on Schedule", dot: "ghost", href: "/schedule" }];

  // Priorities + Waiting-on-me: built by the shared buildQueue() pipeline (the
  // one place ranking/promotion lives, so getQueueSnapshot never forks from it).
  const { priorities, waiting } = await buildQueue(sources);

  // The AI brief is NOT awaited here — that would block the whole page on
  // ~15s of CPU inference. We return its inputs and let getTodayBrief() run
  // inside a Suspense boundary so the shell paints immediately.
  const briefInputs: BriefInput = {
    date: now.toISOString().slice(0, 10),
    ownerName: "Joe",
    projects: projects.map((p) => ({
      name: p.name,
      status: p.status,
      progress: p.progress,
    })),
    threadsNeedingReply: flaggedLeads,
    queue: priorities.map((p) => ({ rank: p.rank, title: p.title, lane: p.lane, tag: p.tag })),
  };

  return {
    dateLabel,
    greeting: greetingFor(now.getHours(), "Joe"),
    weekLabel: `${activeCount} ACTIVE JOB${activeCount === 1 ? "" : "S"}`,
    headerChips: [
      { kind: "money", label: `${dollars(outstanding)} outstanding A/R` },
      { kind: "flag", label: `${flaggedLeads} lead${flaggedLeads === 1 ? "" : "s"} need attention` },
    ],
    briefHeadline: "Today's brief",
    briefInputs,
    priorities,
    week: weekStrip(now, blocksByDay),
    schedule,
    waiting,
  };
}

/** The AI brief text. Resolved separately from getTodayData() so it can run
 *  inside a Suspense boundary (CPU Qwen ~15s) without blocking first paint. */
export async function getTodayBrief(inputs: BriefInput): Promise<string> {
  const brief = await ai.brief(inputs);
  return brief.summary;
}
