// Projects data builder. DB-backed (Phase 7.2): list + detail read the
// projects table via lib/db. Detail merges curated rich content (milestones,
// daily log, subs) per slug; the AI weekly-status note still routes through
// lib/ai.ts.

import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";

type GroupKey = "active" | "closeout" | "pre_construction";

export interface ProjectListItem {
  slug: string;
  name: string;
  /** Location + day/phase subtitle, e.g. "Edina · day 74 of ~92". */
  sub: string;
  /** Stage chip label, e.g. "Tile phase". */
  stage: string;
  /** Display contract value, e.g. "$58,400" or "$28,000 (est)". */
  value: string;
  /** 0–100 percent billed (drives the progress bar). */
  billed: number;
  group: GroupKey;
}

export interface ProjectGroup {
  key: GroupKey;
  title: string;
  dot: "accent" | "ai" | "ghost";
  /** Chip kind for the stage badge on each card in this group. */
  chip: ChipKind;
  /** Progress-bar fill color token. */
  bar: string;
  items: ProjectListItem[];
}

export interface ProjectsData {
  summary: string;
  groups: ProjectGroup[];
}

const GROUP_META: Record<GroupKey, { title: string; dot: "accent" | "ai" | "ghost"; chip: ChipKind; bar: string }> = {
  active: { title: "Active · on site", dot: "accent", chip: "accent", bar: "bg-accent" },
  closeout: { title: "Closeout", dot: "ai", chip: "ai", bar: "bg-ai" },
  pre_construction: { title: "Pre-construction", dot: "ghost", chip: "ghost", bar: "bg-ink-4" },
};

/** Map a project's status to its display group. */
export function statusGroup(status: ProjectStatus): GroupKey {
  if (status === "active") return "active";
  if (status === "closeout" || status === "complete") return "closeout";
  return "pre_construction";
}

/** Project statuses in lifecycle order, with display labels. */
export const PROJECT_STATUSES: { key: ProjectStatus; label: string }[] = [
  { key: "pre_construction", label: "Pre-construction" },
  { key: "active", label: "Active" },
  { key: "closeout", label: "Closeout" },
  { key: "complete", label: "Complete" },
];

// ─── DB row → display mapping ────────────────────────────────────────────────

interface ProjectRow {
  slug: string;
  name: string;
  status: ProjectStatus;
  value: string;
  billed: number;
  sub: string;
  stage: string;
  contract_value: number;
  collected_to_date: number;
}

const PROJECT_SELECT = `
  SELECT slug, name, status,
         COALESCE(value_display, '') AS value,
         progress AS billed,
         COALESCE(sub_label, '') AS sub,
         COALESCE(stage_label, '') AS stage,
         contract_value, collected_to_date
  FROM projects`;

function rowToItem(r: ProjectRow): ProjectListItem {
  return {
    slug: r.slug,
    name: r.name,
    sub: r.sub,
    stage: r.stage,
    value: r.value,
    billed: r.billed,
    group: statusGroup(r.status),
  };
}

/** "$140.9k" style compact dollars. */
function compactK(dollars: number): string {
  return `$${(dollars / 1000).toFixed(1)}k`;
}

// ─── Project detail ───────────────────────────────────────────────────────

export interface MilestoneRow {
  name: string;
  value: string;
  status: "paid" | "next" | "queued";
  date: string;
}
export interface WeekRow {
  day: string;
  label: string;
  time: string;
  dot: "accent" | "ai" | "ghost";
}
export interface SubRow {
  initials: string;
  name: string;
  trade: string;
  coi: string;
}

export interface ProjectDetail {
  slug: string;
  name: string;
  status: ProjectStatus;
  contractValue: string;
  statusChips: { kind: ChipKind; label: string; dot?: boolean }[];
  subtitle: string;
  pulse: string;
  milestones: MilestoneRow[];
  thisWeek: WeekRow[];
  latestLog: { date: string; body: string; photos: number } | null;
  /** AI-drafted weekly status note. */
  weeklyStatus: string | null;
  money: {
    contract: string;
    paid: string;
    nextDraw: string;
    openCOs: string;
    billedPct: number;
    note: string;
  };
  subs: SubRow[];
  files: string[];
  filesCount: number;
  selections: { area: string; choice: string; status: string; chip: ChipKind }[];
  comms: { from: string; role: "client" | "you" | "ai"; time: string; body: string }[];
  punch: { item: string; owner: string; done: boolean }[];
}

const PROJECT_DETAILS: Record<string, Partial<ProjectDetail>> = {
  henderson: {
    contractValue: "$58,400 contract",
    statusChips: [
      { kind: "accent", label: "Active · tile phase", dot: true },
      { kind: "ghost", label: "Edina · started Mar 12" },
      { kind: "ghost", label: "3 of 5 milestones" },
    ],
    subtitle:
      "Tom + Kate Henderson · 2317 Sheridan Ave S · PM: Joe · Subs: Marco (tile), Tomas (electric), Brad (paint)",
    pulse:
      "On schedule. Tile starts today 1pm. Watch: Friday's flatness photo flagged the pantry threshold — bring a level. Next milestone draw ($12,400) fires when the tile substrate signs off.",
    milestones: [
      { name: "Retainer", value: "$11,680", status: "paid", date: "Mar 8" },
      { name: "Demo + framing", value: "$11,680", status: "paid", date: "Mar 22" },
      { name: "Cabinets installed", value: "$11,680", status: "paid", date: "Apr 30" },
      { name: "Tile substrate sign-off", value: "$12,400", status: "next", date: "Today–Wed" },
      { name: "Final + punch", value: "$10,960", status: "queued", date: "TBD" },
    ],
    thisWeek: [
      { day: "Mon", label: "Tile install w/ Marco", time: "1pm – EOD", dot: "accent" },
      { day: "Tue", label: "Tile day 2", time: "all day", dot: "accent" },
      { day: "Wed", label: "Grout", time: "AM", dot: "accent" },
      { day: "Thu", label: "—", time: "—", dot: "ghost" },
      { day: "Fri", label: "Plumbing fixtures (Tomas)", time: "AM", dot: "ghost" },
    ],
    latestLog: {
      date: "Fri May 22",
      body: "Cabinet doors hung, hardware install 90%. Issue: hairline cabinet door damage on pantry — Marco photographed, supplier replacement requested.",
      photos: 10,
    },
    money: {
      contract: "$58,400",
      paid: "$35,040",
      nextDraw: "$12,400",
      openCOs: "$0",
      billedPct: 60,
      note: "60% billed · on track",
    },
    subs: [
      { initials: "MR", name: "Marco", trade: "tile", coi: "COI ok thru Aug 14" },
      { initials: "TS", name: "Tomas", trade: "electric", coi: "COI ok thru Oct 3" },
      { initials: "BP", name: "Brad", trade: "paint", coi: "COI ok thru Aug 14" },
    ],
    files: ["Signed contract.pdf", "SOW v3.docx", "Selections — final.xlsx", "Floor plan.pdf", "Photos · 76"],
    filesCount: 38,
    selections: [
      { area: "Cabinets", choice: "Shaker, Benjamin Moore Simply White", status: "ordered", chip: "money" },
      { area: "Countertops", choice: "Calacatta quartz · 3cm", status: "ordered", chip: "money" },
      { area: "Tile (floor)", choice: '12x24 matte porcelain, herringbone', status: "approved", chip: "accent" },
      { area: "Backsplash", choice: "Zellige, gloss white", status: "approved", chip: "accent" },
      { area: "Plumbing fixtures", choice: "Brushed gold — pending final count", status: "pending", chip: "ai" },
      { area: "Lighting", choice: "Recessed + 2 pendants over island", status: "pending", chip: "ai" },
    ],
    comms: [
      {
        from: "Kate Henderson",
        role: "client",
        time: "Fri 4:12p",
        body: "The cabinet doors look amazing! Quick q — are we still on for tile starting Monday?",
      },
      {
        from: "Claude",
        role: "ai",
        time: "Fri 4:13p",
        body: "Drafted a reply confirming Monday 1pm tile start + the grout-color decision still needed. Queued for your review.",
      },
      {
        from: "You",
        role: "you",
        time: "Fri 5:01p",
        body: "Yes — Marco starts Monday at 1. One thing: need your grout color pick (light vs. charcoal) by Sunday so we don't lose a day.",
      },
    ],
    punch: [
      { item: "Replace hairline-damaged pantry door (supplier RMA)", owner: "Marco", done: false },
      { item: "Caulk gap at range-wall cabinet", owner: "Joe", done: false },
      { item: "Touch-up paint — island return", owner: "Brad", done: false },
      { item: "Verify under-cabinet LED dimming", owner: "Tomas", done: true },
    ],
  },
};

export async function getProject(slug: string): Promise<ProjectDetail | null> {
  const { rows } = await query<ProjectRow>(`${PROJECT_SELECT} WHERE slug = $1`, [slug]);
  if (!rows[0]) return null;
  const item = rowToItem(rows[0]);

  const curated = PROJECT_DETAILS[slug] ?? {};

  // AI-drafted weekly status note (the only AI touch-point on this screen).
  const draft = await ai.draft({ kind: "weekly_status", context: item.name });
  const weeklyStatus = curated.weeklyStatus ?? draft.body.split("\n").find((l) => l.trim()) ?? null;

  const meta = GROUP_META[item.group];

  return {
    slug: item.slug,
    name: item.name,
    status: rows[0].status,
    contractValue: curated.contractValue ?? `${item.value} contract`,
    statusChips:
      curated.statusChips ??
      [
        { kind: meta.chip, label: item.stage, dot: true },
        { kind: "ghost", label: item.sub },
      ],
    subtitle: curated.subtitle ?? `${item.sub} · PM: Joe`,
    pulse: curated.pulse ?? `${item.name} is in the ${item.stage.toLowerCase()} stage. ${item.billed}% billed to date.`,
    milestones: curated.milestones ?? [],
    thisWeek: curated.thisWeek ?? [],
    latestLog: curated.latestLog ?? null,
    weeklyStatus,
    money:
      curated.money ??
      {
        contract: item.value,
        paid: "—",
        nextDraw: "—",
        openCOs: "$0",
        billedPct: item.billed,
        note: `${item.billed}% billed`,
      },
    subs: curated.subs ?? [],
    files: curated.files ?? [],
    filesCount: curated.filesCount ?? 0,
    selections: curated.selections ?? [],
    comms: curated.comms ?? [],
    punch: curated.punch ?? [],
  };
}

export async function getProjectsData(): Promise<ProjectsData> {
  const { rows } = await query<ProjectRow>(`${PROJECT_SELECT} ORDER BY progress DESC, name`);
  const items = rows.map(rowToItem);

  const order: GroupKey[] = ["active", "closeout", "pre_construction"];
  const groups: ProjectGroup[] = order.map((key) => ({
    key,
    ...GROUP_META[key],
    items: items.filter((p) => p.group === key),
  }));

  const contracted = rows.reduce((s, r) => s + r.contract_value, 0);
  const billed = rows.reduce((s, r) => s + r.collected_to_date, 0);

  return {
    summary: `${items.length} projects · ${compactK(contracted)} contracted · ${compactK(billed)} billed YTD`,
    groups,
  };
}
