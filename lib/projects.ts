// Projects list data builder. Mock-backed today; swaps to DB queries on the
// projects table (db/schema.sql) in Phase 7. Shape stays stable.

import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectStatus } from "./types";
import { ai } from "./ai";

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

const PROJECTS: ProjectListItem[] = [
  { slug: "henderson", name: "Henderson kitchen", sub: "Edina · day 74 of ~92", stage: "Tile phase", value: "$58,400", billed: 60, group: "active" },
  { slug: "reyes", name: "Reyes bath", sub: "Mpls · day 22", stage: "Drywall", value: "$18,500", billed: 35, group: "active" },
  { slug: "olson", name: "Olson porch", sub: "Edina · client walk Tues", stage: "Punch list", value: "$22,000", billed: 90, group: "closeout" },
  { slug: "bauer", name: "Bauer mudroom", sub: "Mpls · selections phase", stage: "6/24 selected", value: "$28,000 (est)", billed: 0, group: "pre_construction" },
  { slug: "sandberg", name: "Sandberg built-ins", sub: "Edina · site visit done", stage: "Awaiting selections", value: "$14,000 (est)", billed: 0, group: "pre_construction" },
];

/** Map a project's status to its display group. */
export function statusGroup(status: ProjectStatus): GroupKey {
  if (status === "active") return "active";
  if (status === "closeout") return "closeout";
  return "pre_construction";
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
  },
};

export async function getProject(slug: string): Promise<ProjectDetail | null> {
  const item = PROJECTS.find((p) => p.slug === slug);
  if (!item) return null;

  const curated = PROJECT_DETAILS[slug] ?? {};

  // AI-drafted weekly status note (the only AI touch-point on this screen).
  const draft = await ai.draft({ kind: "weekly_status", context: item.name });
  const weeklyStatus = curated.weeklyStatus ?? draft.body.split("\n").find((l) => l.trim()) ?? null;

  const meta = GROUP_META[item.group];

  return {
    slug: item.slug,
    name: item.name,
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
  };
}

export async function getProjectsData(): Promise<ProjectsData> {
  const order: GroupKey[] = ["active", "closeout", "pre_construction"];
  const groups: ProjectGroup[] = order.map((key) => ({
    key,
    ...GROUP_META[key],
    items: PROJECTS.filter((p) => p.group === key),
  }));

  return {
    summary: "5 projects · $140.9k contracted · $61.5k billed YTD",
    groups,
  };
}
