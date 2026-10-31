// Warranty data builder. DB-backed (Phase 7-B): active claims read from
// warranty_claims, the under-warranty grid from warranty_projects (closed/
// closeout records distinct from the live projects table). The AI claim
// summary still routes through lib/ai.ts.

import { ai } from "./ai";
import { query } from "./db";
import { type DerivedWarrantyItem } from "./warranty-mn";

/** Claim status dot — accent (in progress), flag (overdue), ghost (waiting). */
export type ClaimDot = "accent" | "flag" | "ghost";

export interface WarrantyClaim {
  /** warranty_claims.id — used to open/resolve the claim. */
  id: string;
  resolved: boolean;
  acknowledged: boolean;
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
  status: "active" | "expired" | "unconfirmed";
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
  resolved: boolean;
}

interface ProjectRow {
  project: string;
  client: string;
  closed: string;
  closed_iso: string | null;
  warranty: string;
  flag: string | null;
  ends_iso: string | null;
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
             (ack_deadline_at - (now() AT TIME ZONE 'America/Chicago')::date)         AS ack_days,
             (resolve_deadline_at - (now() AT TIME ZONE 'America/Chicago')::date)     AS resolve_days,
             acknowledged, resolved
      FROM warranty_claims
      ORDER BY opened_at DESC`),
    query<ProjectRow>(`
      SELECT project, client,
             to_char(closed_at, 'FMMon FMDD YYYY') AS closed,
             to_char(closed_at, 'YYYY-MM-DD')      AS closed_iso,
             warranty_label AS warranty,
             flag, to_char(warranty_ends_at, 'YYYY-MM-DD') AS ends_iso
      FROM warranty_projects
      ORDER BY closed_at DESC`),
    query<{ project: string; slug: string; client: string | null; closed: string | null; closed_iso: string | null; terms: string | null }>(`
      SELECT p.name AS project, p.slug, NULLIF(NULLIF(p.client_name, ''), p.name) AS client,
             to_char(s.signed_at AT TIME ZONE 'America/Chicago', 'FMMon FMDD YYYY') AS closed,
             to_char(s.signed_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') AS closed_iso,
             (SELECT NULLIF(trim(value), '') FROM app_settings WHERE key = 'company.warranty_terms') AS terms
      FROM projects p LEFT JOIN client_signoffs s ON s.project_id = p.id
      WHERE p.status = 'warranty' ORDER BY p.name`),
    query<{ today: string }>(`SELECT to_char((now() AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS today`),
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
      resolved: r.resolved,
      acknowledged: r.acknowledged,
      project: r.project,
      client: r.client,
      age: r.opened_label ? `opened ${r.opened_label}` : r.age_label ?? "",
      issue: r.issue,
      deadline,
      step: r.acknowledged ? r.step ?? "Acknowledged — in progress" : r.step ?? "Awaiting acknowledgment",
      dot,
    };
  });

  // Explicit recorded terms/end dates are evidence. A stage or modification
  // timestamp is not a closeout event, nor permission to invent a warranty.
  const seen = new Set<string>();
  const projects: WarrantyProject[] = [];
  for (const r of tableProjectsRes.rows) {
    seen.add(r.project);
    const configured = Boolean(r.closed_iso && r.warranty?.trim());
    projects.push({
      project: r.project, client: r.client, closed: r.closed || "Not recorded",
      warranty: configured ? r.warranty : "Warranty terms not recorded",
      status: !configured ? "unconfirmed" : r.ends_iso && r.ends_iso < todayISO ? "expired" : "active",
      flag: r.flag ?? undefined,
      coverageNote: r.ends_iso ? `Coverage ends ${r.ends_iso}` : "No coverage end date recorded.",
    });
  }
  for (const r of liveProjectsRes.rows) {
    if (seen.has(r.project)) continue;
    projects.push({
      project: r.project, client: r.client ?? "Historical project",
      closed: r.closed ?? "Not recorded",
      warranty: r.terms || "Warranty terms not configured",
      status: r.closed_iso && r.terms ? "active" : "unconfirmed",
      coverageNote: !r.closed_iso ? "Written closeout sign-off not recorded. Coverage dates are unconfirmed." : "No coverage end date recorded. Refer to the configured terms.",
    });
  }
  const activeClaims = claims.filter(c => !c.resolved);
  const overdue = activeClaims.filter((c) => c.dot === "flag").length;
  const underWarrantyTotal = projects.filter(p => p.status === "active").length;

  // The claim summary is the AI touch-point — routed through the service. The
  // input is composed from the active claim(s); the mock relays it and a real
  // model composes from the same rows in Phase 7.3.
  const summaryInput = activeClaims.length
    ? activeClaims
        .map((c) => `${c.project}: ${c.issue} (${c.deadline}). ${c.step}.`)
        .join(" ")
    : "No active warranty claims right now.";

  return {
    eyebrow: `${underWarrantyTotal} closed projects under warranty · ${activeClaims.length} active claim${activeClaims.length === 1 ? "" : "s"} · ${overdue} overdue`,
    summaryInput,
    filters: ["Active claims", "Under warranty", "Expired", "Needs details", "Resolved claims"],
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
      "Warranty terms have not been configured. Contact SJ Carpentry to confirm coverage.",
    claims: rows.map((r) => ({
      id: r.id,
      issue: r.issue,
      status: r.resolved ? "Resolved" : r.acknowledged ? "In progress" : "Received",
      when: r.when_label,
    })),
  };
}
