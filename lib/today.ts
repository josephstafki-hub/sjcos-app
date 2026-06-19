// Today screen data builder.
//
// One source of truth for the /today dashboard, consumed two ways:
//   • app/today/page.tsx       — calls getTodayData() directly (server render)
//   • app/api/today/route.ts   — exposes the same payload over HTTP
//
// DB-backed (Phase 7.2): the header metrics (active jobs, outstanding A/R,
// leads needing attention) and the AI brief inputs are derived from real
// leads/projects rows via lib/db. The priorities / schedule / waiting-on-me
// lists stay curated — they have no backing table yet (tasks + a schedule
// table land in a later phase). The AI brief still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";
import type { ChipKind } from "@/components/ui/Chip";

type DotKind = "flag" | "accent" | "ai" | "money" | "ghost";

export interface TodayPriority {
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
  waiting: { items: { label: string; href?: string }[]; total: number };
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

  const [projectsRes, leadsRes, scheduleRes, weekRes, complianceRes, claimsRes] =
    await Promise.all([
      query<TodayProjectRow>(`
        SELECT slug, name, status, progress,
               (contract_value - collected_to_date) AS outstanding
        FROM projects
        WHERE status IN ('active', 'closeout')
        ORDER BY (status = 'active') DESC, progress DESC, name`),
      query<{ slug: string; name: string; scope: string | null; flag_label: string | null }>(`
        SELECT slug, name, scope, flag_label
        FROM leads WHERE flag_kind = 'flag'
        ORDER BY updated_at DESC`),
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
      query<{ project: string; deadline_label: string | null }>(`
        SELECT project, deadline_label
        FROM warranty_claims WHERE resolved = false
        ORDER BY opened_at DESC`),
    ]);

  const projects = projectsRes.rows;
  const activeCount = projects.filter((p) => p.status === "active").length;
  const outstanding = projects.reduce((s, p) => s + Number(p.outstanding), 0);
  const flaggedLeadRows = leadsRes.rows;
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

  // ── Priorities: ranked from real signals (leads → compliance → site → job) ──
  const candidates: Omit<TodayPriority, "rank">[] = [];
  for (const l of flaggedLeadRows) {
    candidates.push({
      tag: "LEAD",
      dot: "flag",
      title: `Reply to ${l.name}`,
      sub: [l.flag_label, l.scope].filter(Boolean).join(" · ") || "Needs your attention",
      href: `/leads/${l.slug}`,
    });
  }
  for (const c of complianceRes.rows.filter((c) => c.days <= 7)) {
    candidates.push({
      tag: "COMPLIANCE",
      dot: c.days <= 3 ? "flag" : "accent",
      title: c.title,
      sub: `${c.step ?? "Action needed"} · due ${c.due}`,
      href: "/compliance",
    });
  }
  const firstJobBlock = scheduleRes.rows.find((b) => b.tone === "accent" || b.tone === "ai");
  if (firstJobBlock) {
    candidates.push({
      tag: "SCHEDULE",
      dot: "accent",
      title: `On site — ${firstJobBlock.label}`,
      sub: `${firstJobBlock.time_label} today`,
      href: "/schedule",
    });
  }
  const topActive = projects.find((p) => p.status === "active");
  if (topActive) {
    candidates.push({
      tag: `JOB · ${topActive.name}`,
      dot: "accent",
      title: `Keep ${topActive.name} moving`,
      sub: `${topActive.progress}% complete`,
      href: `/projects/${topActive.slug}`,
    });
  }
  const priorities: TodayPriority[] = (
    candidates.length
      ? candidates
      : [{ tag: "ALL CLEAR", dot: "ghost" as DotKind, title: "Nothing urgent today", sub: "No flagged items right now." }]
  )
    .slice(0, 5)
    .map((c, i) => ({ ...c, rank: `#${i + 1}` }));

  // ── Waiting on me: decisions/actions in the owner's court ──
  const waitingItems: { label: string; href?: string }[] = [
    ...flaggedLeadRows.map((l) => ({
      label: `Reply to ${l.name} — ${l.flag_label ?? "lead"}`,
      href: `/leads/${l.slug}`,
    })),
    ...complianceRes.rows.map((c) => ({
      label: `${c.title} (due ${c.due})`,
      href: "/compliance",
    })),
    ...claimsRes.rows.map((c) => ({
      label: `Resolve warranty claim — ${c.project}`,
      href: "/warranty",
    })),
  ];

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
