// Warranty data builder. DB-backed (Phase 7-B): active claims read from
// warranty_claims, the under-warranty grid from warranty_projects (closed/
// closeout records distinct from the live projects table). The AI claim
// summary still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";

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
  /** Input for the AI claim summary; the text streams in via getWarrantySummary. */
  summaryInput: string;
  filters: string[];
  claims: WarrantyClaim[];
  underWarrantyTotal: number;
  projects: WarrantyProject[];
}

interface ClaimRow {
  project: string;
  client: string;
  issue: string;
  age_label: string | null;
  deadline_label: string | null;
  step: string | null;
  dot: string;
}

interface ProjectRow {
  project: string;
  client: string;
  closed: string;
  warranty: string;
  flag: string | null;
}

export async function getWarrantyData(): Promise<WarrantyData> {
  const [claimsRes, projectsRes] = await Promise.all([
    query<ClaimRow>(`
      SELECT project, client, issue, age_label, deadline_label, step, dot
      FROM warranty_claims
      WHERE resolved = false
      ORDER BY opened_at DESC`),
    query<ProjectRow>(`
      SELECT project, client,
             to_char(closed_at, 'FMMon FMDD YYYY') AS closed,
             warranty_label AS warranty,
             flag
      FROM warranty_projects
      ORDER BY closed_at DESC`),
  ]);

  const claims: WarrantyClaim[] = claimsRes.rows.map((r) => ({
    project: r.project,
    client: r.client,
    age: r.age_label ?? "",
    issue: r.issue,
    deadline: r.deadline_label ?? "",
    step: r.step ?? "",
    dot: (r.dot === "flag" || r.dot === "ghost" ? r.dot : "accent") as ClaimDot,
  }));

  const projects: WarrantyProject[] = projectsRes.rows.map((r) => ({
    project: r.project,
    client: r.client,
    closed: r.closed,
    warranty: r.warranty,
    flag: r.flag ?? undefined,
  }));

  const overdue = claims.filter((c) => c.dot === "flag").length;
  const underWarrantyTotal = projects.length;

  // The claim summary is the AI touch-point — routed through the service. The
  // input is composed from the active claim(s); the mock relays it and a real
  // model composes from the same rows in Phase 7.3.
  const summaryInput = claims.length
    ? claims
        .map((c) => `${c.project}: ${c.issue} (${c.deadline}). ${c.step}.`)
        .join(" ")
    : "No active warranty claims right now.";

  return {
    eyebrow: `${underWarrantyTotal} closed projects under warranty · ${claims.length} active claim${claims.length === 1 ? "" : "s"} · ${overdue} overdue`,
    summaryInput,
    filters: ["Active claims", "Under warranty", "Expired"],
    claims,
    underWarrantyTotal,
    projects,
  };
}

/** The AI warranty claim summary, streamed separately (see AiStream). */
export async function getWarrantySummary(text: string): Promise<string> {
  const { summary } = await ai.summarize({ focus: "warranty", text });
  return summary;
}
