// Projects data builder. DB-backed (Phase 7.2): list + detail read the
// projects table via lib/db. Detail merges curated rich content (milestones,
// daily log, subs) per slug; the AI weekly-status note still routes through
// lib/ai.ts.

import type { ChipKind } from "@/components/ui/Chip";
import type { ProjectStatus } from "./types";
import type { ProjectTab } from "./project-tabs";
import { ai } from "./ai";
import { query } from "./db";

type GroupKey = "active" | "closeout" | "warranty" | "pre_construction";

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
  active: { title: "Construction · on site", dot: "accent", chip: "accent", bar: "bg-accent" },
  closeout: { title: "Closeout", dot: "ai", chip: "ai", bar: "bg-ai" },
  warranty: { title: "Under warranty", dot: "ghost", chip: "ghost", bar: "bg-ink-4" },
  pre_construction: { title: "Pre-construction · design", dot: "ghost", chip: "ghost", bar: "bg-ink-4" },
};

/** Map a project's lifecycle stage to its display group on the projects list. */
export function statusGroup(status: ProjectStatus): GroupKey {
  if (status === "construction") return "active";
  if (status === "closeout") return "closeout";
  if (status === "warranty") return "warranty";
  return "pre_construction"; // precon_signed … construction_contract
}

/** Project lifecycle stages, in order, with display labels. */
export const PROJECT_STATUSES: { key: ProjectStatus; label: string }[] = [
  { key: "precon_signed", label: "Pre-con signed" },
  { key: "floor_plan", label: "Floor plan" },
  { key: "mood_board", label: "Mood board" },
  { key: "selections", label: "Selections" },
  { key: "bidding", label: "Bidding" },
  { key: "construction_contract", label: "Construction contract" },
  { key: "construction", label: "Construction" },
  { key: "closeout", label: "Closeout" },
  { key: "warranty", label: "Warranty" },
];

/** The project-detail tab that surfaces the tool for a given lifecycle stage.
 *  Drives which tab opens first on the project detail (the design's stage-gated
 *  flow). Stages without a dedicated tool fall back to Overview. */
export function stageToolTab(status: ProjectStatus): ProjectTab {
  switch (status) {
    case "floor_plan":
      return "Floor";
    case "mood_board":
      return "Mood";
    case "selections":
      return "Selections";
    case "bidding":
      return "Bidding";
    case "construction":
      return "Daily log";
    case "closeout":
      // Closeout opens on its first section, the punch list.
      return "Closeout";
    default:
      return "Overview"; // precon_signed, construction_contract, warranty
  }
}

/** Human label for a stage key. */
export function projectStageLabel(status: ProjectStatus): string {
  return PROJECT_STATUSES.find((s) => s.key === status)?.label ?? status;
}

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
  /** Curated weekly-status note (when one is hand-authored). */
  weeklyStatus: string | null;
  /** Project name to draft a weekly status for (null when curated/none). The
   *  draft streams via getProjectWeeklyStatus so the page doesn't block on Qwen. */
  weeklyStatusName: string | null;
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
  punch: { id: number; item: string; owner: string; done: boolean; clientConfirmed: boolean }[];
}

interface PunchRow {
  id: number;
  item: string;
  owner_name: string;
  done: boolean;
  client_confirmed_at: Date | null;
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
      { name: "Deposit (on signing)", value: "$11,680", status: "paid", date: "Mar 8" },
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
        from: "AI assistant",
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
  },
};

export async function getProject(slug: string): Promise<ProjectDetail | null> {
  const { rows } = await query<ProjectRow>(`${PROJECT_SELECT} WHERE slug = $1`, [slug]);
  if (!rows[0]) return null;
  const item = rowToItem(rows[0]);

  const curated = PROJECT_DETAILS[slug] ?? {};

  // Punch list is real (project_punch table); checkboxes toggle `done`.
  const punchRes = await query<PunchRow>(
    `SELECT pp.id, pp.item, pp.owner_name, pp.done, pp.client_confirmed_at
       FROM project_punch pp
       JOIN projects p ON p.id = pp.project_id
      WHERE p.slug = $1
      ORDER BY pp.sort_order, pp.id`,
    [slug],
  );
  const punch = punchRes.rows.map((r) => ({
    id: r.id,
    item: r.item,
    owner: r.owner_name,
    done: r.done,
    clientConfirmed: r.client_confirmed_at != null,
  }));

  // The AI-drafted weekly status is NOT awaited here — that would block the page
  // on ~15s of CPU inference. Curated text shows immediately; otherwise the
  // draft streams via getProjectWeeklyStatus() inside a Suspense slot.
  const weeklyStatus = curated.weeklyStatus ?? null;
  const weeklyStatusName = curated.weeklyStatus ? null : item.name;

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
    weeklyStatusName,
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
    punch,
  };
}

/** The AI-drafted weekly-status line. Resolved separately from getProject() so
 *  it can stream inside a Suspense boundary instead of blocking the page. */
export async function getProjectWeeklyStatus(name: string): Promise<string> {
  const draft = await ai.draft({ kind: "weekly_status", context: name });
  return draft.body.split("\n").find((l) => l.trim()) ?? "";
}

/** A real uploaded file scoped to a project (project_key = slug). Curated
 *  showcase names live on ProjectDetail.files; these are blobs on disk that
 *  download through /api/files/[id]. */
export interface ProjectFile {
  id: string;
  name: string;
  type: "doc" | "img" | "folder";
  sizeLabel: string;
  modifiedLabel: string;
  /** Owner published this file to the client dashboard (files.client_visible). */
  clientVisible: boolean;
  /** Uploaded by the client through their portal (files.client_slug). */
  clientUpload: boolean;
  /** "Client upload · Dana" / "PHOTO" — the row's stored subtitle or tag. */
  subtitle: string;
  /** Absolute upload time, e.g. "Aug 14, 3:12pm" — viewer caption. */
  uploadedLabel: string;
  /** Row came from the project's lead stage (still keyed by lead_slug). */
  fromLead: boolean;
}

const FILE_ROW_SELECT = `
  f.id, f.name, f.type, f.size_label, f.modified_label, f.client_visible,
  (f.client_slug IS NOT NULL) AS client_upload,
  COALESCE(NULLIF(f.subtitle, ''), f.tag, '') AS subtitle,
  to_char(f.created_at AT TIME ZONE 'America/Chicago', 'Mon FMDD, FMHH12:MIam') AS uploaded_label`;

interface FileRow {
  id: string;
  name: string;
  type: "doc" | "img" | "folder";
  size_label: string;
  modified_label: string;
  client_visible: boolean;
  client_upload: boolean;
  subtitle: string;
  uploaded_label: string;
  from_lead?: boolean;
}

function fileRowToProjectFile(r: FileRow): ProjectFile {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    sizeLabel: r.size_label,
    modifiedLabel: r.modified_label,
    clientVisible: r.client_visible,
    clientUpload: r.client_upload,
    subtitle: r.subtitle,
    uploadedLabel: r.uploaded_label,
    fromLead: !!r.from_lead,
  };
}

/** Real uploaded files for a project, newest first (uploads only — showcase
 *  rows have no storage_path). Scoped by project_key = slug. */
export async function getProjectFiles(slug: string): Promise<ProjectFile[]> {
  // Includes files still keyed to the project's origin lead (uploaded during
  // the lead stage) — conversion now re-keys them, but older rows may not be.
  const { rows } = await query<FileRow>(
    `SELECT ${FILE_ROW_SELECT},
            (f.project_key IS DISTINCT FROM $1) AS from_lead
       FROM files f
      WHERE f.storage_path IS NOT NULL
        AND (f.project_key = $1
             OR f.lead_slug IN (SELECT l.slug FROM leads l JOIN projects p ON p.lead_id = l.id WHERE p.slug = $1))
      ORDER BY f.created_at DESC`,
    [slug],
  );
  return rows.map(fileRowToProjectFile);
}

/** Real uploaded files attached to a LEAD (files.lead_slug), newest first —
 *  same shape as getProjectFiles so the Files panel is shared between the two
 *  detail pages. Includes lead photos and client uploads from a lead-stage
 *  portal session. */
export async function getLeadFiles(slug: string): Promise<ProjectFile[]> {
  const { rows } = await query<FileRow>(
    `SELECT ${FILE_ROW_SELECT}
       FROM files f
      WHERE f.lead_slug = $1 AND f.storage_path IS NOT NULL
      ORDER BY f.created_at DESC`,
    [slug],
  );
  return rows.map(fileRowToProjectFile);
}

/** A sub assigned to a project, with the contact + COI info the Subs tab needs. */
export interface AssignedSub {
  slug: string;
  name: string;
  trade: string;
  role: string;
  coiStatus: "current" | "expiring" | "expired" | "missing";
  coiLabel: string;
  email: string | null;
  phone: string | null;
  /** Scope of work + scheduled dates for this assignment (6-scope). */
  scope: string;
  startDate: string; // YYYY-MM-DD or ""
  endDate: string; // YYYY-MM-DD or ""
}

/** A sub available to assign (not yet on the project). */
export interface RosterSub {
  slug: string;
  name: string;
  trade: string;
}

const COI_LABEL: Record<string, string> = {
  current: "COI current",
  expiring: "COI expiring",
  expired: "COI expired",
  missing: "No COI",
};

/** Assigned subs + the assignable roster for a project's Subs tab. */
export async function getProjectSubsData(
  slug: string,
): Promise<{ assigned: AssignedSub[]; roster: RosterSub[] }> {
  const assignedQ = query<{
    slug: string;
    name: string;
    trade: string;
    role_label: string;
    coi_status: AssignedSub["coiStatus"];
    email: string | null;
    phone: string | null;
    scope_text: string;
    start_date: string | null;
    end_date: string | null;
  }>(
    `SELECT s.slug, s.name, s.trade, ps.role_label, s.coi_status, s.email, s.phone,
            ps.scope_text,
            to_char(ps.start_date, 'YYYY-MM-DD') AS start_date,
            to_char(ps.end_date,   'YYYY-MM-DD') AS end_date
       FROM project_subs ps
       JOIN subs s ON s.slug = ps.sub_slug
       JOIN projects p ON p.id = ps.project_id
      WHERE p.slug = $1
      ORDER BY ps.assigned_at`,
    [slug],
  );
  const rosterQ = query<RosterSub>(
    `SELECT s.slug, s.name, s.trade
       FROM subs s
      WHERE s.slug NOT IN (
        SELECT ps.sub_slug FROM project_subs ps
        JOIN projects p ON p.id = ps.project_id WHERE p.slug = $1
      )
      ORDER BY s.fav DESC, s.name`,
    [slug],
  );
  const [assigned, roster] = await Promise.all([assignedQ, rosterQ]);
  return {
    assigned: assigned.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      trade: r.trade,
      role: r.role_label,
      coiStatus: r.coi_status,
      coiLabel: COI_LABEL[r.coi_status] ?? r.coi_status,
      email: r.email,
      phone: r.phone,
      scope: r.scope_text ?? "",
      startDate: r.start_date ?? "",
      endDate: r.end_date ?? "",
    })),
    roster: roster.rows,
  };
}

/** One project daily-log entry. */
export interface ProjectLog {
  id: string;
  iso: string;
  dateLabel: string;
  body: string;
  photos: number;
}

/** A project's daily-log history, newest first (project_id-scoped logs only —
 *  the global /schedule log is project_id IS NULL). */
export async function getProjectDailyLogs(slug: string): Promise<ProjectLog[]> {
  const { rows } = await query<{
    id: string;
    iso: string;
    date_label: string;
    body: string;
    photos: number;
  }>(
    `SELECT dl.id,
            to_char(dl.log_date, 'YYYY-MM-DD')      AS iso,
            to_char(dl.log_date, 'Dy Mon FMDD')     AS date_label,
            dl.body, dl.photos
       FROM daily_logs dl
       JOIN projects p ON p.id = dl.project_id
      WHERE p.slug = $1
      ORDER BY dl.log_date DESC, dl.id DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    iso: r.iso,
    dateLabel: r.date_label,
    body: r.body,
    photos: r.photos,
  }));
}

export async function getProjectsData(): Promise<ProjectsData> {
  // Warranty-stage projects are closed jobs; they're managed on the Warranty
  // page, not here, so they're excluded from the projects list entirely.
  const { rows } = await query<ProjectRow>(
    `${PROJECT_SELECT} WHERE status <> 'warranty' ORDER BY progress DESC, name`,
  );
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
