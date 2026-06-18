// Subs directory data builder. DB-backed (Phase 7.2): list + detail read the
// subs table via lib/db. The card shape is display-oriented (initials, fav,
// star int, trade filter key, COI label) — derived from the row in the mapper.
// Detail merges curated reliability content per slug; AI summary via lib/ai.ts.

import type { CoiStatus } from "./types";
import { ai } from "./ai";
import { query } from "./db";

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
  coiStatus: Extract<CoiStatus, "current" | "expiring">;
  /** COI date display, e.g. "Aug 14" (current) or "Jun 1" (expiring). */
  coiLabel: string;
}

export interface SubsData {
  summary: string;
  trades: TradeFilter[];
  subs: SubCard[];
}

// ─── DB row → display mapping ────────────────────────────────────────────────

interface SubRow {
  slug: string;
  name: string;
  trade: string;
  rate: string | null;
  fav: boolean;
  open_jobs: number;
  jobs_count: number;
  rating: string | null;
  coi_status: string;
  coi_label: string | null;
  email: string | null;
  phone: string | null;
  notes: string;
}

const SUB_SELECT = `
  SELECT slug, name, trade, rate, fav, open_jobs, jobs_count, rating, coi_status,
         to_char(coi_expires_at, 'FMMon FMDD') AS coi_label, email, phone,
         COALESCE(notes, '') AS notes
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
    slug: r.slug,
    initials: subInitials(r.name),
    name: r.name,
    trade: r.trade,
    tradeKey: r.trade.split(/\s/)[0] as SubCard["tradeKey"],
    rate: r.rate ?? "",
    openJobs: r.open_jobs,
    jobsCount: r.jobs_count,
    rating: Math.round(Number(r.rating ?? 0)),
    fav: r.fav,
    coiStatus: r.coi_status === "expiring" ? "expiring" : "current",
    coiLabel: r.coi_label ?? "",
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
    summary: `${subs.length} subs · ${workingThisWeek} working this week · ${expiring} COI expiring`,
    trades: [...TRADES],
    subs,
  };
}

// ─── Sub detail ───────────────────────────────────────────────────────────

/** Recent-job dot tone — accent (in progress), money (paid), ghost (other). */
export type JobDot = "accent" | "money" | "ghost";

export interface SubDetail {
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
  /** AI reliability summary (mock now; ai.summarize over job history in Phase 7). */
  aiSummary: string;
  recentJobs: { name: string; detail: string; dot: JobDot }[];
  paperwork: { label: string; value: string; ok: boolean }[];
  rate: { amount: string; unit: string; note: string };
  taxNote: string;
  /** Owner's free-form private notes on the sub (editable, persisted). */
  notes: string;
}

/** Rich curated content keyed by slug. Subs not listed here get a sensible
 *  generic detail built from their card, so every card opens a real page. */
const DETAILS: Record<string, Partial<SubDetail>> = {
  marco: {
    tradeLine: "tile + stone",
    contact: "marco@rivastile.example · (612) 555-0102 · Mpls · onboarded Apr 2023",
    reliability: [
      { label: "On-time", value: "13 / 14 (93%)" },
      { label: "Quality QC pass", value: "14 / 14" },
      { label: "Bid accuracy", value: "±4% avg" },
      { label: "Response time", value: "~ 2 hrs" },
    ],
    aiSummary:
      "Marco is one of two preferred tile subs. Strong with marble — first call " +
      "for Calacatta or zellige work. Slightly slower on backsplash tear-out; " +
      "build that into the schedule.",
    recentJobs: [
      { name: "Henderson kitchen", detail: "in progress · tile day 1", dot: "accent" },
      { name: "Olson porch · tile entry", detail: "Apr · $1,800 · paid", dot: "money" },
      { name: "Sandberg bath", detail: "Mar · $6,400 · paid", dot: "money" },
      { name: "Reyes bath (prior job)", detail: "Feb · $8,200 · paid", dot: "money" },
    ],
    paperwork: [
      { label: "COI · GL + WC", value: "Aug 14", ok: true },
      { label: "W-9", value: "on file", ok: true },
      { label: "Sub agreement", value: "v3 · Apr", ok: true },
      { label: "Add'l insured · SJC", value: "yes", ok: true },
    ],
    rate: { amount: "$60", unit: "/hr", note: "Lump-sum on jobs > 60 hrs" },
    taxNote: "1099 reminder · file by Jan 31 · 2025 total $52,800",
  },
};

/** Split a free-form rate string ("$60/hr", "lump sum", "sq ft") into an
 *  amount + unit for the rate card. */
function splitRate(rate: string): { amount: string; unit: string } {
  const m = rate.match(/^(\$[\d,]+)\s*(\/.*)?$/);
  return m ? { amount: m[1], unit: m[2] ?? "" } : { amount: rate, unit: "" };
}

export async function getSub(slug: string): Promise<SubDetail | null> {
  const { rows } = await query<SubRow>(`${SUB_SELECT} WHERE slug = $1`, [slug]);
  if (!rows[0]) return null;
  const card = rowToCard(rows[0]);

  const curated = DETAILS[slug] ?? {};

  const fallbackSummary =
    `${card.name} has completed ${card.jobsCount} jobs with SJC at a ` +
    `${card.rating}-star rating. A fuller reliability profile fills in as ` +
    `jobs are logged.`;

  // The reliability blurb is the AI touch-point — routed through the service so
  // Phase 7 can compose it from real job history with zero screen changes.
  const { summary: aiSummary } = await ai.summarize({
    text: curated.aiSummary ?? fallbackSummary,
    focus: "sub-reliability",
  });

  const { amount, unit } = splitRate(card.rate);

  return {
    slug: card.slug,
    initials: card.initials,
    name: card.name,
    tradeLine: curated.tradeLine ?? card.trade.toLowerCase(),
    working: card.openJobs > 0,
    coiStatus: card.coiStatus,
    coiLabel: card.coiLabel,
    w9: curated.w9 ?? "on file",
    contact: curated.contact ?? `${card.trade} · onboarded 2024`,
    phone: rows[0].phone,
    email: rows[0].email,
    jobsCount: card.jobsCount,
    rating: card.rating,
    reliability:
      curated.reliability ??
      [
        { label: "Jobs completed", value: String(card.jobsCount) },
        { label: "Rating", value: `${card.rating} / 5` },
        { label: "Open jobs", value: String(card.openJobs) },
        { label: "Response time", value: "—" },
      ],
    aiSummary,
    recentJobs: curated.recentJobs ?? [],
    paperwork:
      curated.paperwork ??
      [
        { label: "COI · GL + WC", value: card.coiLabel, ok: card.coiStatus === "current" },
        { label: "W-9", value: "on file", ok: true },
        { label: "Sub agreement", value: "—", ok: false },
      ],
    rate: curated.rate ?? { amount, unit, note: "" },
    taxNote: curated.taxNote ?? "1099 reminder · file by Jan 31",
    notes: rows[0].notes,
  };
}
