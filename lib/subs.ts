// Subs directory data builder. DB-backed (Phase 7.2): list + detail read the
// subs table via lib/db. The card shape is display-oriented (initials, fav,
// star int, trade filter key, COI label) — derived from the row in the mapper.
// Detail merges curated reliability content per slug; AI summary via lib/ai.ts.

import type { CoiStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";
import { coiStatusSql, w9OnFileSql } from "./sub-docs";

/** Trade filter buttons, in design order. "All" is the default selection. */
export const TRADES = [
  "All",
  "Tile",
  "Electric",
  "Plumbing",
  "Paint",
  "Framing",
  "HVAC",
  "Flooring",
] as const;

export type TradeFilter = (typeof TRADES)[number];

export interface SubCard {
  archived: boolean;
  slug: string;
  initials: string;
  name: string;
  /** Display trade line, e.g. "Tile · stone". */
  trade: string;
  /** Canonical trade for the filter chips — one of TRADES (minus "All"). */
  tradeKey: Exclude<TradeFilter, "All">;
  /** Free-form rate display, e.g. "$60/hr" / "lump sum" / "sq ft". */
  rate: string;
  openJobs: number;
  jobsCount: number;
  /** 0–5 whole stars. */
  rating: number;
  /** Preferred sub — accent avatar + star. */
  fav: boolean;
  coiStatus: CoiStatus;
  /** COI date display, e.g. "Aug 14" (current) or "Jun 1" (expiring). */
  coiLabel: string;
  /** A live W-9 document is on file (sub_documents). */
  w9OnFile: boolean;
}

export interface SubsData {
  summary: string;
  trades: TradeFilter[];
  subs: SubCard[];
}

// ─── DB row → display mapping ────────────────────────────────────────────────

interface SubRow {
  archived: boolean;
  slug: string;
  name: string;
  trade: string;
  rate: string | null;
  fav: boolean;
  open_jobs: number;
  jobs_count: number;
  rating: string | null;
  coi_status: CoiStatus;
  coi_label: string | null;
  w9_on_file: boolean;
  email: string | null;
  phone: string | null;
  notes: string;
  /** Real assignments still on the board — see live_total. */
  live_open_jobs: number;
  /** Real rows in project_subs for this sub. The static subs.jobs_count column
   *  predates project_subs and holds pre-system history, so the card takes the
   *  GREATER of the two: a sub with 2 live assignments reads 2 instead of 0,
   *  while an old hand's logged history isn't erased by the switch. */
  live_total: number;
  live_completed: number;
  created_label: string;
}

const SUB_SELECT = `
  SELECT slug, archived_at IS NOT NULL AS archived, to_char(created_at, 'FMMon FMDD, YYYY') AS created_label, name, trade, rate, fav, open_jobs, jobs_count, rating,
         ${coiStatusSql("subs")} AS coi_status,
         to_char(coi_expires_at, 'FMMon FMDD') AS coi_label,
         ${w9OnFileSql("subs")} AS w9_on_file, email, phone,
         COALESCE(notes, '') AS notes,
         (SELECT count(*)::int FROM project_subs ps
            JOIN projects p ON p.id = ps.project_id
           WHERE ps.sub_slug = subs.slug AND p.status <> 'warranty') AS live_open_jobs,
         (SELECT count(*)::int FROM project_subs ps
           WHERE ps.sub_slug = subs.slug) AS live_total,
         (SELECT count(*)::int FROM project_subs ps JOIN projects p ON p.id = ps.project_id
           WHERE ps.sub_slug = subs.slug AND p.status = 'warranty') AS live_completed
  FROM subs`;

/** Initials from a sub's display name: first two alphabetic words. */
function subInitials(name: string): string {
  const w = name.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x));
  if (w.length === 0) return name.slice(0, 2).toUpperCase();
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[1][0]).toUpperCase();
}

function rowToCard(r: SubRow): SubCard {
  return {
    archived: r.archived,
    slug: r.slug,
    initials: subInitials(r.name),
    name: r.name,
    trade: r.trade,
    tradeKey: r.trade.split(/\s/)[0] as SubCard["tradeKey"],
    rate: r.rate ?? "",
    // Live assignments win over the stale static columns — an assignment made on
    // the project Subs tab is what "working" actually means.
    openJobs: r.live_open_jobs,
    jobsCount: Math.max(r.jobs_count, r.live_completed),
    rating: Math.round(Number(r.rating ?? 0)),
    fav: r.fav,
    coiStatus: r.coi_status,
    coiLabel: r.coi_label ?? "",
    w9OnFile: r.w9_on_file,
  };
}

export async function getSubsData(): Promise<SubsData> {
  const { rows } = await query<SubRow>(
    `${SUB_SELECT} ORDER BY fav DESC, rating DESC, jobs_count DESC`,
  );
  const subs = rows.map(rowToCard);

  const workingThisWeek = subs.filter((s) => s.openJobs > 0).length;
  const expiring = subs.filter((s) => s.coiStatus === "expiring").length;

  return {
    summary: `${subs.length} subs · ${workingThisWeek} with open jobs · ${expiring} COI expiring`,
    trades: [...TRADES],
    subs,
  };
}

// ─── Sub detail ───────────────────────────────────────────────────────────

/** Recent-job dot tone — accent (in progress), money (paid), ghost (other). */
export type JobDot = "accent" | "money" | "ghost";

export interface SubDetail {
  rawTrade: string;
  rawRate: string;
  assignmentCount: number;
  removedJobs: { projectSlug: string; name: string }[];
  archived: boolean;
  slug: string;
  initials: string;
  name: string;
  /** Trade tagline shown after the name, e.g. "tile + stone". */
  tradeLine: string;
  working: boolean;
  coiStatus: SubCard["coiStatus"];
  coiLabel: string;
  w9: string;
  /** One-line contact strip: email · phone · city · onboarded. */
  contact: string;
  /** Structured contact for the Call action; null when unknown. */
  phone: string | null;
  email: string | null;
  jobsCount: number;
  rating: number;
  reliability: { label: string; value: string }[];
  /** Raw text the AI summary is composed from. NOT awaited in getSub — the
   *  summary streams via getSubSummary() in a Suspense slot so the page never
   *  blocks on CPU Qwen (~10–20s). */
  aiSummaryInput: string;
  recentJobs: {
    projectSlug: string;
    name: string;
    detail: string;
    dot: JobDot;
  }[];
  paperwork: { label: string; value: string; ok: boolean }[];
  rate: { amount: string; unit: string; note: string };
  taxNote: string;
  /** Owner's free-form private notes on the sub (editable, persisted). */
  notes: string;
}

/** Rich curated content keyed by slug. Subs not listed here get a sensible
 *  generic detail built from their card, so every card opens a real page.
 *  NOTE: recentJobs is deliberately NOT curated — a sub's job history comes from
 *  project_subs only (see getSubJobs). Curated jobs here would mask the real
 *  assignments this page exists to show. */
/** Split a free-form rate string ("$60/hr", "lump sum", "sq ft") into an
 *  amount + unit for the rate card. */
function splitRate(rate: string): { amount: string; unit: string } {
  const m = rate.match(/^(\$[\d,]+)\s*(\/.*)?$/);
  return m ? { amount: m[1], unit: m[2] ?? "" } : { amount: rate, unit: "" };
}

// ─── Real job history (project_subs) ─────────────────────────────────────────
// The sub's side of the assignment. The project Subs tab writes project_subs;
// this reads it back, so an assignment shows on both records.

/** Dot tone per project stage: on site now / delivered / not started yet. */
const JOB_DOT: Record<string, JobDot> = {
  construction: "accent",
  closeout: "accent",
  warranty: "money",
};

/** Short human stage label for the job's detail line. */
const JOB_STAGE_TEXT: Record<string, string> = {
  precon_signed: "upcoming",
  floor_plan: "upcoming",
  mood_board: "upcoming",
  selections: "upcoming",
  bidding: "upcoming",
  construction_contract: "upcoming",
  construction: "in progress",
  closeout: "closeout",
  warranty: "complete",
};

interface SubJobRow {
  project_slug: string;
  name: string;
  status: string;
  role_label: string;
  assigned_label: string;
  date_label: string | null;
}

/** A sub's real assignments, newest first. Empty when they're on no jobs — the
 *  page's honest "No jobs yet" state. No money is shown: project_subs carries no
 *  per-sub payment, and inventing one would be worse than omitting it. */
async function getSubJobs(
  slug: string,
  trade: string,
): Promise<SubDetail["recentJobs"]> {
  const { rows } = await query<SubJobRow>(
    `SELECT p.slug AS project_slug, p.name, p.status, ps.role_label,
            to_char(ps.assigned_at, 'FMMon FMDD') AS assigned_label,
            CASE
              WHEN ps.start_date IS NOT NULL AND ps.end_date IS NOT NULL
                THEN to_char(ps.start_date, 'FMMon FMDD') || ' – ' || to_char(ps.end_date, 'FMMon FMDD')
              WHEN ps.start_date IS NOT NULL THEN 'starts ' || to_char(ps.start_date, 'FMMon FMDD')
              WHEN ps.end_date   IS NOT NULL THEN 'due '    || to_char(ps.end_date, 'FMMon FMDD')
              ELSE NULL
            END AS date_label
       FROM project_subs ps JOIN projects p ON p.id = ps.project_id
      WHERE ps.sub_slug = $1
      ORDER BY ps.assigned_at DESC
      `,
    [slug],
  );
  return rows.map((r) => ({
    projectSlug: r.project_slug,
    name: r.name,
    detail: [
      r.role_label || trade,
      r.date_label ?? `assigned ${r.assigned_label}`,
      JOB_STAGE_TEXT[r.status] ?? r.status,
    ]
      .filter(Boolean)
      .join(" · "),
    dot: JOB_DOT[r.status] ?? "ghost",
  }));
}

export async function getSub(slug: string): Promise<SubDetail | null> {
  const { rows } = await query<SubRow>(`${SUB_SELECT} WHERE slug = $1`, [slug]);
  if (!rows[0]) return null;
  const card = rowToCard(rows[0]);

  const curated: Partial<SubDetail> = {};
  const recentJobs = await getSubJobs(slug, card.trade);

  const fallbackSummary =
    `${card.name} has completed ${card.jobsCount} jobs with SJC at a ` +
    `${card.rating ? `${card.rating}-star rating` : "rating not yet recorded"}. A fuller reliability profile fills in as ` +
    `jobs are logged.`;

  // The reliability blurb is the AI touch-point. It is NOT awaited here — that
  // would block the page on ~10–20s of CPU inference. The raw input is returned;
  // getSubSummary() resolves it inside a Suspense slot on the page.
  const aiSummaryInput = curated.aiSummaryInput ?? fallbackSummary;

  const { amount, unit } = splitRate(card.rate);

  return {
    archived: card.archived,
    rawTrade: rows[0].trade,
    rawRate: rows[0].rate ?? "",
    assignmentCount: rows[0].live_total,
    removedJobs: (
      await query<{ projectSlug: string; name: string }>(
        `SELECT p.slug AS "projectSlug",p.name FROM sub_assignment_trash t JOIN projects p ON p.id=t.project_id WHERE t.sub_slug=$1 AND NOT EXISTS(SELECT 1 FROM project_subs ps WHERE ps.project_id=t.project_id AND ps.sub_slug=t.sub_slug) ORDER BY t.removed_at DESC`,
        [slug],
      )
    ).rows,
    slug: card.slug,
    initials: card.initials,
    name: card.name,
    tradeLine: curated.tradeLine ?? card.trade.toLowerCase(),
    working: card.openJobs > 0,
    coiStatus: card.coiStatus,
    coiLabel: card.coiLabel,
    w9: curated.w9 ?? (card.w9OnFile ? "on file" : "missing"),
    contact:
      curated.contact ??
      [rows[0].email, rows[0].phone, `Added ${rows[0].created_label}`]
        .filter(Boolean)
        .join(" · "),
    phone: rows[0].phone,
    email: rows[0].email,
    jobsCount: card.jobsCount,
    rating: card.rating,
    reliability: curated.reliability ?? [
      { label: "Jobs completed", value: String(card.jobsCount) },
      {
        label: "Rating",
        value: card.rating ? `${card.rating} / 5` : "Not rated",
      },
      { label: "Open jobs", value: String(card.openJobs) },
      { label: "Response time", value: "—" },
    ],
    aiSummaryInput,
    recentJobs,
    paperwork: curated.paperwork ?? [
      {
        label: "COI · GL + WC",
        value: card.coiLabel || "missing",
        ok: card.coiStatus === "current" && !!card.coiLabel,
      },
      {
        label: "W-9",
        value: card.w9OnFile ? "on file" : "missing",
        ok: card.w9OnFile,
      },
      { label: "Sub agreement", value: "—", ok: false },
    ],
    rate: curated.rate ?? { amount, unit, note: "" },
    // No fabricated 1099 reminder — the note only shows when curated/real.
    taxNote: curated.taxNote ?? "",
    notes: rows[0].notes,
  };
}

/** The AI reliability summary, resolved separately from getSub() so it can
 *  stream inside a Suspense boundary instead of blocking the page on Qwen. */
export async function getSubSummary(input: string): Promise<string> {
  const { summary } = await ai.summarize({
    text: input,
    focus: "sub-reliability",
  });
  return summary;
}
