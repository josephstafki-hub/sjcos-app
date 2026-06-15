// Subs directory data builder. Mock-backed today; swaps to DB queries in
// Phase 7 (the subs table already exists — see db/schema.sql). The card shape
// below is display-oriented (initials, fav, star int, trade filter key) and
// maps from the raw `Sub` row then; the screen never changes.

import type { CoiStatus } from "./types";
import { ai } from "./ai";

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

const SUBS: SubCard[] = [
  { slug: "marco", initials: "MR", name: "Marco Rivas", trade: "Tile · stone", tradeKey: "Tile", rate: "$60/hr", openJobs: 1, jobsCount: 14, rating: 5, fav: true, coiStatus: "current", coiLabel: "Aug 14" },
  { slug: "tomas", initials: "TS", name: "Tomas Sanchez", trade: "Electric", tradeKey: "Electric", rate: "$72/hr", openJobs: 2, jobsCount: 22, rating: 5, fav: true, coiStatus: "current", coiLabel: "Oct 3" },
  { slug: "brad", initials: "BP", name: "Brad Petersen", trade: "Paint", tradeKey: "Paint", rate: "$48/hr", openJobs: 1, jobsCount: 18, rating: 4, fav: false, coiStatus: "current", coiLabel: "Aug 14" },
  { slug: "jen", initials: "JD", name: "Jen Doyle Plumbing", trade: "Plumbing", tradeKey: "Plumbing", rate: "$85/hr", openJobs: 0, jobsCount: 8, rating: 5, fav: false, coiStatus: "current", coiLabel: "Jul 22" },
  { slug: "kris", initials: "KR", name: "Kris Rajan", trade: "Framing", tradeKey: "Framing", rate: "$58/hr", openJobs: 0, jobsCount: 9, rating: 4, fav: false, coiStatus: "current", coiLabel: "Nov 11" },
  { slug: "rivera", initials: "RH", name: "Rivera HVAC", trade: "HVAC", tradeKey: "HVAC", rate: "lump sum", openJobs: 0, jobsCount: 4, rating: 4, fav: false, coiStatus: "current", coiLabel: "Sep 1" },
  { slug: "carl", initials: "CL", name: "Carl Lund", trade: "Tile", tradeKey: "Tile", rate: "$55/hr", openJobs: 0, jobsCount: 3, rating: 3, fav: false, coiStatus: "expiring", coiLabel: "Jun 1" },
  { slug: "falk", initials: "FT", name: "Falk Floors", trade: "Flooring", tradeKey: "Flooring", rate: "sq ft", openJobs: 0, jobsCount: 6, rating: 4, fav: false, coiStatus: "current", coiLabel: "Dec 8" },
];

export interface SubsData {
  summary: string;
  trades: TradeFilter[];
  subs: SubCard[];
}

export async function getSubsData(): Promise<SubsData> {
  const workingThisWeek = SUBS.filter((s) => s.openJobs > 0).length;
  const expiring = SUBS.filter((s) => s.coiStatus === "expiring").length;

  return {
    summary: `${SUBS.length} subs · ${workingThisWeek} working this week · ${expiring} COI expiring`,
    trades: [...TRADES],
    subs: SUBS,
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
  jobsCount: number;
  rating: number;
  reliability: { label: string; value: string }[];
  /** AI reliability summary (mock now; ai.summarize over job history in Phase 7). */
  aiSummary: string;
  recentJobs: { name: string; detail: string; dot: JobDot }[];
  paperwork: { label: string; value: string; ok: boolean }[];
  rate: { amount: string; unit: string; note: string };
  taxNote: string;
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
  const card = SUBS.find((s) => s.slug === slug);
  if (!card) return null;

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
  };
}
