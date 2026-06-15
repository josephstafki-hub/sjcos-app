// Warranty data builder. Mock-backed today; in Phase 7 it reads closed
// projects (the projects table already exists) + a warranty_claims table added
// then. Shape stays stable.

import { ai } from "./ai";

/** Claim status dot — accent (in progress), flag (overdue), ghost (waiting). */
export type ClaimDot = "accent" | "flag" | "ghost";

export interface WarrantyClaim {
  project: string;
  client: string;
  /** "opened 4 hrs ago via portal" tail (the prefix is rendered in the card). */
  age: string;
  issue: string;
  /** Acknowledgment-deadline chip, e.g. "5d ack · Fri". */
  deadline: string;
  /** AI status line, e.g. "Reply drafted · Marco prepped". */
  step: string;
  dot: ClaimDot;
}

export interface WarrantyProject {
  project: string;
  client: string;
  closed: string;
  /** Warranty term + end, e.g. "1 yr · ends May 23 2027". */
  warranty: string;
  /** Optional flag chip, e.g. "open claim" — also draws a red border. */
  flag?: string;
}

export interface WarrantyData {
  eyebrow: string;
  /** AI claim summary shown in the brief bubble. */
  summary: string;
  filters: string[];
  claims: WarrantyClaim[];
  underWarrantyTotal: number;
  projects: WarrantyProject[];
}

const CLAIMS: WarrantyClaim[] = [
  {
    project: "Sandberg built-ins",
    client: "N. Sandberg",
    age: "4 hrs",
    issue: "Cabinet hinge loose · soft-close failing on 1 door",
    deadline: "5d ack · Fri",
    step: "Reply drafted · Marco prepped",
    dot: "accent",
  },
];

const PROJECTS: WarrantyProject[] = [
  { project: "Olson porch", client: "Diane Olson", closed: "May 22 2026", warranty: "1 yr · ends May 23 2027" },
  { project: "Sandberg built-ins", client: "N. Sandberg", closed: "Mar 14 2026", warranty: "1 yr · ends Mar 14 2027", flag: "open claim" },
  { project: "Bauer roof line", client: "L. Bauer", closed: "Feb 22 2026", warranty: "1 yr · ends Feb 22 2027" },
  { project: "Reyes prior bath", client: "G. Reyes", closed: "Feb 8 2026", warranty: "1 yr · ends Feb 8 2027" },
  { project: "Knutsen mudroom", client: "P. Knutsen", closed: "Jan 28 2026", warranty: "1 yr · ends Jan 28 2027" },
  { project: "Mendez kitchen", client: "A. Mendez", closed: "Dec 14 2025", warranty: "2 yr · structural" },
];

const UNDER_WARRANTY_TOTAL = 32;

export async function getWarrantyData(): Promise<WarrantyData> {
  const overdue = CLAIMS.filter((c) => c.dot === "flag").length;

  // The claim summary is the AI touch-point — routed through the service so
  // Phase 7 composes it from the real claim record with no screen change.
  const { summary } = await ai.summarize({
    focus: "warranty",
    text:
      "Sandberg cabinet hinge — claim opened today. 5-day acknowledgment " +
      "deadline runs Fri May 29. I have a reply draft + Marco prepped.",
  });

  return {
    eyebrow: `${UNDER_WARRANTY_TOTAL} closed projects under warranty · ${CLAIMS.length} active claim${CLAIMS.length === 1 ? "" : "s"} · ${overdue} overdue`,
    summary,
    filters: ["Active claims", "Under warranty", "Expired"],
    claims: CLAIMS,
    underWarrantyTotal: UNDER_WARRANTY_TOTAL,
    projects: PROJECTS,
  };
}
