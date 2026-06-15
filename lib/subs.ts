// Subs directory data builder. Mock-backed today; swaps to DB queries in
// Phase 7 (the subs table already exists — see db/schema.sql). The card shape
// below is display-oriented (initials, fav, star int, trade filter key) and
// maps from the raw `Sub` row then; the screen never changes.

import type { CoiStatus } from "./types";

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
