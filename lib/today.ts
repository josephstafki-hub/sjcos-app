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
  waiting: { items: { id: string; label: string; href?: string }[]; total: number };
}

export interface BriefInput {
  date: string;
  ownerName: string;
  projects: { name: string; status: string; progress: number }[];
  threadsNeedingReply: number;
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
  due: string | null;
  promoted_at: string | null;
  project_slug: string | null;
  project_name: string | null;
  project_status: string | null;
  lead_slug: string | null;
  lead_name: string | null;
}

/** Joe's open backlog: work_items assigned to him with a lead/project to
 *  anchor them. Shared between getTodayData() (the full list) and
 *  checkPriorityCompletion() (the single next-up item), so "what's eligible"
 *  never drifts between the two. */
export const OPEN_WORK_ITEMS_SQL = `
    SELECT w.id, w.title, left(NULLIF(w.body, ''), 140) AS body,
           w.status, w.priority, to_char(w.due_at, 'FMMon FMDD') AS due,
           w.promoted_at,
           p.slug AS project_slug, p.name AS project_name, p.status AS project_status,
           l.slug AS lead_slug, l.name AS lead_name
      FROM work_items w
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN leads l ON l.id = w.lead_id
     WHERE w.status NOT IN ('done','cancelled')
       AND w.assignee_kind = 'human'
       AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')
       AND (w.lead_id IS NOT NULL OR w.project_id IS NOT NULL)`;

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
    title: w.title,
    sub: [w.body, w.due ? `due ${w.due}` : null].filter(Boolean).join(" · ") || w.status.replaceAll("_", " "),
    href: w.lead_slug ? `/leads/${w.lead_slug}` : isWarranty ? "/warranty" : w.project_slug ? `/projects/${w.project_slug}` : "/engine",
  };
}

interface TodayWarrantyClaimRow {
  id: string;
  project: string;
  client: string;
  issue: string;
  step: string | null;
  deadline: string | null;
  dot: DotKind;
}

/** "$32,400" style dollars with thousands separators. */
function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
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

  const [projectsRes, leadsRes, workItemsRes, scheduleRes, weekRes, complianceRes, warrantyClaimsRes] =
    await Promise.all([
      query<TodayProjectRow>(`
        SELECT slug, name, status, progress,
               (contract_value - collected_to_date) AS outstanding
        FROM projects
        WHERE status IN ('construction', 'closeout')
        ORDER BY (status = 'construction') DESC, progress DESC, name`),
      query<{ slug: string; name: string; scope: string | null; flag_label: string | null }>(`
        SELECT slug, name, scope, flag_label
        FROM leads WHERE flag_kind = 'flag'
        ORDER BY updated_at DESC`),
      query<TodayWorkItemRow>(`${OPEN_WORK_ITEMS_SQL}${OPEN_WORK_ITEMS_ORDER_SQL}`),
      query<{ time_label: string; label: string; tone: string }>(`
        SELECT time_label, label, tone
        FROM schedule_blocks WHERE block_date = CURRENT_DATE
        ORDER BY sort_min`),
      query<{ iso: string; time_label: string; label: string; tone: string }>(`
        SELECT block_date::text AS iso, time_label, label, tone
        FROM schedule_blocks WHERE block_date BETWEEN $1 AND $2
        ORDER BY block_date, sort_min`,
        [isoDate(monday), isoDate(sunday)]),
      query<{ title: string; step: string | null; due: string; days: number }>(`
        SELECT title, step, to_char(due_date, 'FMMon FMDD') AS due,
               (due_date - CURRENT_DATE) AS days
        FROM compliance_items
        WHERE resolved = false AND due_date <= CURRENT_DATE + 14
        ORDER BY due_date`),
      query<TodayWarrantyClaimRow>(`
        SELECT id, project, client, issue, step,
               COALESCE(
                 CASE WHEN acknowledged = false AND ack_deadline_at IS NOT NULL
                      THEN 'ack by ' || to_char(ack_deadline_at, 'FMMon FMDD') END,
                 CASE WHEN resolve_deadline_at IS NOT NULL
                      THEN 'resolve by ' || to_char(resolve_deadline_at, 'FMMon FMDD') END,
                 deadline_label
               ) AS deadline,
               CASE
                 WHEN (acknowledged = false AND ack_deadline_at <= CURRENT_DATE + 1)
                   OR (acknowledged = true AND resolve_deadline_at <= CURRENT_DATE + 5)
                 THEN 'flag'
                 WHEN dot IN ('accent','flag','ghost') THEN dot
                 ELSE 'accent'
               END AS dot
          FROM warranty_claims
         WHERE resolved = false
         ORDER BY opened_at DESC`),
    ]);

  const projects = projectsRes.rows;
  const activeCount = projects.filter((p) => p.status === "construction").length;
  const outstanding = projects.reduce((s, p) => s + Number(p.outstanding), 0);
  const flaggedLeadRows = leadsRes.rows;
  const openWorkItems = workItemsRes.rows;
  const warrantyClaims = warrantyClaimsRes.rows;
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
  const schedule: TodayScheduleBlock[] = scheduleRes.rows.length
    ? scheduleRes.rows.map((b) => ({
        time: b.time_label,
        label: b.label,
        dot: toneToDot(b.tone),
        href: "/schedule",
      }))
    : [{ time: "—", label: "Nothing scheduled — add a block on Schedule", dot: "ghost", href: "/schedule" }];

  // ── Priorities: a 5-slot rail, ranked from real signals. Leads are always
  // first because new revenue beats internal/project follow-ups, then the
  // rest keep their existing source order (work queue → warranty →
  // compliance → schedule/job).
  //
  // Work-item candidates (Hermes's backlog) only occupy a slot once
  // `promoted_at` is set — see db/schema.sql. Non-work-item signals
  // (leads/warranty/compliance/schedule/job) aren't part of that backlog, so
  // they're always eligible. If fewer than 5 slots are filled, we
  // auto-promote the next-ranked unpromoted work items to top up — this is
  // what backfills the rail after Hermes (or the owner) clears items without
  // anyone visiting /today to trigger the click-time swap in
  // checkPriorityCompletion().
  interface Candidate extends Omit<TodayPriority, "rank"> {
    promotedAt: string | null;
    waitingLabel: string;
  }
  const candidates: Candidate[] = [];
  const workItemLeadSlugs = new Set(openWorkItems.map((w) => w.lead_slug).filter(Boolean));
  for (const w of openWorkItems) {
    const isWarranty = w.project_status === "warranty";
    const kind = w.lead_slug ? "Lead" : isWarranty ? "Warranty" : "Project";
    const source = w.lead_name ?? w.project_name;
    candidates.push({
      ...workItemCandidate(w),
      promotedAt: w.promoted_at,
      waitingLabel: [kind, source, w.title].filter(Boolean).join(" — "),
    });
  }
  for (const claim of warrantyClaims) {
    candidates.push({
      id: `warranty:${claim.id}`,
      checkable: false,
      promotedAt: null,
      tag: `WARRANTY · ${claim.project}`,
      dot: claim.dot,
      title: claim.issue,
      sub: [claim.client, claim.deadline, claim.step].filter(Boolean).join(" · ") || "Warranty claim needs attention",
      href: "/warranty",
      waitingLabel: `Warranty — ${claim.project}: ${claim.issue}${claim.deadline ? ` (${claim.deadline})` : ""}`,
    });
  }
  for (const l of flaggedLeadRows.filter((l) => !workItemLeadSlugs.has(l.slug))) {
    candidates.push({
      id: `lead:${l.slug}`,
      checkable: false,
      promotedAt: null,
      tag: "LEAD",
      dot: "flag",
      title: `Reply to ${l.name}`,
      sub: [l.flag_label, l.scope].filter(Boolean).join(" · ") || "Needs your attention",
      href: `/leads/${l.slug}`,
      waitingLabel: `Reply to ${l.name} — ${l.flag_label ?? "lead"}`,
    });
  }
  for (const c of complianceRes.rows.filter((c) => c.days <= 7)) {
    candidates.push({
      id: `compliance:${c.title}:${c.due}`,
      checkable: false,
      promotedAt: null,
      tag: "COMPLIANCE",
      dot: c.days <= 3 ? "flag" : "accent",
      title: c.title,
      sub: `${c.step ?? "Action needed"} · due ${c.due}`,
      href: "/compliance",
      waitingLabel: `${c.title} (due ${c.due})`,
    });
  }
  const firstJobBlock = scheduleRes.rows.find((b) => b.tone === "accent" || b.tone === "ai");
  if (firstJobBlock) {
    candidates.push({
      id: `schedule:${firstJobBlock.label}`,
      checkable: false,
      promotedAt: null,
      tag: "SCHEDULE",
      dot: "accent",
      title: `On site — ${firstJobBlock.label}`,
      sub: `${firstJobBlock.time_label} today`,
      href: "/schedule",
      waitingLabel: `On site — ${firstJobBlock.label} (${firstJobBlock.time_label})`,
    });
  }
  const topActive = projects.find((p) => p.status === "construction");
  if (topActive) {
    candidates.push({
      id: `job:${topActive.slug}`,
      checkable: false,
      promotedAt: null,
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
  const pool = ranked.filter((c) => c.checkable && !c.promotedAt);
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
  const waitingItems = ranked
    .filter((c) => !displayedIds.has(c.id))
    .map((c) => ({ id: c.id, label: c.waitingLabel, href: c.href }));

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
    waiting: {
      total: waitingItems.length,
      items: waitingItems,
    },
  };
}

/** The AI brief text. Resolved separately from getTodayData() so it can run
 *  inside a Suspense boundary (CPU Qwen ~15s) without blocking first paint. */
export async function getTodayBrief(inputs: BriefInput): Promise<string> {
  const brief = await ai.brief(inputs);
  return brief.summary;
}
