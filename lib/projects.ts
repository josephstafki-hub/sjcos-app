// Projects list data builder. Mock-backed today; swaps to DB queries on the
// projects table (db/schema.sql) in Phase 7. Shape stays stable.

import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectStatus } from "./types";

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
