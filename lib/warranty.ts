// Warranty data builder. DB-backed (Phase 7-B): active claims read from
// warranty_claims, the under-warranty grid from warranty_projects (closed/
// closeout records distinct from the live projects table). The AI claim
// summary still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";
import { closeEntityRoom } from "./rooms";
import { warrantyRoomKey } from "./chat";
import { deriveWarranty, type DerivedWarrantyItem } from "./warranty-mn";

/** Claim status dot — accent (in progress), flag (overdue), ghost (waiting). */
export type ClaimDot = "accent" | "flag" | "ghost";

export interface WarrantyClaim {
  /** warranty_claims.id — used to open/resolve the claim. */
  id: string;
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
  /** Still-covered MN statutory items (Minn. Stat. §327A.02); lapsed tiers are
   *  omitted so the list shrinks as periods expire. */
  items?: DerivedWarrantyItem[];
  /** Shown when coverage can't be itemized (no start date on file). */
  coverageNote?: string;
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
  id: string;
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
  closed_iso: string | null;
  warranty: string;
  flag: string | null;
}

export async function getWarrantyData(): Promise<WarrantyData> {
  const [claimsRes, tableProjectsRes, liveProjectsRes, todayRes] = await Promise.all([
    query<
      ClaimRow & {
        opened_label: string | null;
        ack_label: string | null;
        resolve_label: string | null;
        ack_days: number | null;
        resolve_days: number | null;
        acknowledged: boolean;
      }
    >(`
      SELECT id, project, client, issue, age_label, deadline_label, step, dot,
             to_char(opened_at, 'Mon FMDD')          AS opened_label,
             to_char(ack_deadline_at, 'Mon FMDD')     AS ack_label,
             to_char(resolve_deadline_at, 'Mon FMDD') AS resolve_label,
             (ack_deadline_at - CURRENT_DATE)         AS ack_days,
             (resolve_deadline_at - CURRENT_DATE)     AS resolve_days,
             acknowledged
      FROM warranty_claims
      WHERE resolved = false
      ORDER BY opened_at DESC`),
    query<ProjectRow>(`
      SELECT project, client,
             to_char(closed_at, 'FMMon FMDD YYYY') AS closed,
             to_char(closed_at, 'YYYY-MM-DD')      AS closed_iso,
             warranty_label AS warranty,
             flag
      FROM warranty_projects
      ORDER BY closed_at DESC`),
    query<{ project: string; slug: string; client: string | null; closed: string | null; closed_iso: string | null }>(`
      SELECT name AS project, slug,
             NULLIF(NULLIF(client_name, ''), name)  AS client,
             CASE WHEN updated_at::date > created_at::date
                  THEN to_char(updated_at, 'FMMon FMDD YYYY') END AS closed,
             CASE WHEN updated_at::date > created_at::date
                  THEN to_char(updated_at, 'YYYY-MM-DD') END AS closed_iso
      FROM projects WHERE status = 'warranty' ORDER BY updated_at DESC`),
    query<{ today: string }>(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`),
  ]);
  const todayISO = todayRes.rows[0]?.today ?? new Date().toISOString().slice(0, 10);

  const claims: WarrantyClaim[] = claimsRes.rows.map((r) => {
    // Prefer the real ack/resolve deadlines; fall back to legacy showcase text.
    let deadline = r.deadline_label ?? "";
    let dot: ClaimDot = r.dot === "flag" || r.dot === "ghost" ? r.dot : "accent";
    if (!r.acknowledged && r.ack_label) {
      deadline = `Ack by ${r.ack_label}`;
      if (r.ack_days !== null && r.ack_days <= 1) dot = "flag";
    } else if (r.resolve_label) {
      deadline = `Resolve by ${r.resolve_label}`;
      if (r.resolve_days !== null && r.resolve_days <= 5) dot = "flag";
    }
    return {
      id: r.id,
      project: r.project,
      client: r.client,
      age: r.opened_label ? `opened ${r.opened_label}` : r.age_label ?? "",
      issue: r.issue,
      deadline,
      step: r.acknowledged ? r.step ?? "Acknowledged — in progress" : r.step ?? "Awaiting acknowledgment",
      dot,
    };
  });

  // Under-warranty grid: legacy warranty_projects rows + live projects currently
  // in the warranty stage (deduped by project name). Each project's MN statutory
  // coverage (Minn. Stat. §327A.02) is derived from its warranty start date;
  // lapsed tiers drop off the item list, and a project whose every tier has
  // lapsed is removed from the grid entirely (P1-F1).
  const seen = new Set<string>();
  const projects: WarrantyProject[] = [];
  // Live warranty-stage projects whose coverage fully lapsed → their warranty
  // chat room is auto-closed below (the P1-D2 hook that had no product event).
  const expiredWarrantyRoomSlugs: string[] = [];

  const noteFor = (derived: ReturnType<typeof deriveWarranty>): string | undefined =>
    derived
      ? undefined
      : "Coverage dates not on file — add a closeout date to itemize MN warranty periods.";

  for (const r of tableProjectsRes.rows) {
    const derived = deriveWarranty(r.closed_iso, todayISO);
    if (derived?.allExpired) continue; // fully lapsed → out of warranty (no live room)
    seen.add(r.project);
    projects.push({
      project: r.project,
      client: r.client,
      closed: r.closed,
      warranty: r.warranty,
      flag: r.flag ?? undefined,
      items: derived?.active,
      coverageNote: noteFor(derived),
    });
  }
  // Imported historical folders have no real closed date (created = updated at
  // import time) and are named after the client — don't fabricate either field.
  for (const r of liveProjectsRes.rows) {
    if (seen.has(r.project)) continue;
    const derived = deriveWarranty(r.closed_iso, todayISO);
    if (derived?.allExpired) {
      expiredWarrantyRoomSlugs.push(r.slug); // fully lapsed → close its warranty room
      continue;
    }
    projects.push({
      project: r.project,
      client: r.client ?? "Historical project",
      closed: r.closed ?? "Unknown",
      warranty: r.closed ? "Under warranty" : "Imported record — closed date not on file",
      items: derived?.active,
      // The imported-record warranty line already states the missing date, so no
      // extra note; a live warranty-stage project always has a derivable date.
    });
  }

  // Auto-close the warranty rooms of projects that have fully aged out. Idempotent
  // (closeEntityRoom no-ops once closed) and best-effort — room bookkeeping must
  // never break the warranty page render.
  if (expiredWarrantyRoomSlugs.length) {
    try {
      await Promise.allSettled(
        expiredWarrantyRoomSlugs.map((slug) => closeEntityRoom(warrantyRoomKey(slug))),
      );
    } catch {
      /* ignore — display already reflects the removal */
    }
  }

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

/** Projects the owner can log a warranty claim against (for the /warranty
 *  add-claim picker). */
export async function getWarrantyProjectOptions(): Promise<{ slug: string; name: string }[]> {
  const { rows } = await query<{ slug: string; name: string }>(
    `SELECT slug, name FROM projects ORDER BY (status = 'warranty') DESC, name`,
  );
  return rows;
}

// ─── Client-portal warranty view (P4-3) ──────────────────────────────────────

export interface ClientClaim {
  id: string;
  issue: string;
  status: string;
  when: string;
}

export interface ClientWarranty {
  coverage: string;
  claims: ClientClaim[];
}

/** Warranty coverage blurb + the client's own open claims, for the portal
 *  warranty panel shown when their project is in the warranty stage. */
export async function getClientWarranty(slug: string): Promise<ClientWarranty> {
  const cov = await query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'company.warranty_terms'`,
  );
  const { rows } = await query<{ id: string; issue: string; resolved: boolean; acknowledged: boolean; when_label: string }>(
    `SELECT wc.id, wc.issue, wc.resolved, wc.acknowledged,
            to_char(wc.opened_at, 'Mon FMDD') AS when_label
       FROM warranty_claims wc JOIN projects p ON p.id = wc.project_id
      WHERE p.slug = $1
      ORDER BY wc.opened_at DESC LIMIT 20`,
    [slug],
  );
  return {
    coverage:
      cov.rows[0]?.value ||
      "One-year workmanship warranty from substantial completion. Manufacturer warranties on materials pass through per their terms.",
    claims: rows.map((r) => ({
      id: r.id,
      issue: r.issue,
      status: r.resolved ? "Resolved" : r.acknowledged ? "In progress" : "Received",
      when: r.when_label,
    })),
  };
}
