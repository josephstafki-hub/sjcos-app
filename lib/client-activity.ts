// Client activity ledger. One row per thing a client DID in their portal —
// read by the owner-side "Client portal" tab (lead + project) so "what has the
// client done, and when" is a single list. Written by the portal server
// actions via logClientActivity (best-effort, never throws). Server-only.

import { query, queryOne } from "./db";
import type { PortalScope } from "./client-portal";
import { relativeAge, sqlAbsoluteLabel } from "./time";

export type ClientActivityKind =
  | "visit"
  | "upload"
  | "message"
  | "selection"
  | "mood_feedback"
  | "mood_approve"
  | "plan_approve"
  | "sign"
  | "decline"
  | "punch_confirm"
  | "warranty"
  | "claim";

export interface ClientActivityRow {
  id: number;
  kind: ClientActivityKind;
  summary: string;
  detail: string;
  entityKind: string | null;
  entityId: string | null;
  actor: string;
  /** Owner-side deep link (…?tab=X&focus=Y), or null. */
  href: string | null;
  /** Deterministic relative label, e.g. "5m ago". */
  when: string;
  /** Absolute label, e.g. "Aug 14, 3:12pm". */
  whenAbsolute: string;
  /** Rows logged during the lead stage of a project (informational chip). */
  fromLead: boolean;
}

interface LogInput {
  scope: PortalScope;
  kind: ClientActivityKind;
  summary: string;
  detail?: string | null;
  entityKind?: string;
  entityId?: string | number | null;
  actorName?: string | null;
  href?: string | null;
}

/** Owner-side page for a scope, optionally deep-linked to a tab + record. The
 *  detail pages read `?tab=` / `?focus=` server-side to open on the right tab
 *  and highlight the row (components/projects/ProjectTabs, leads/LeadTabs). */
export function ownerHref(
  scope: PortalScope,
  opts: { tab?: string; focus?: string | number | null } = {},
): string {
  const base = scope.kind === "project" ? `/projects/${scope.slug}` : `/leads/${scope.slug}`;
  const q = new URLSearchParams();
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.focus != null && opts.focus !== "") q.set("focus", String(opts.focus));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Owner-side page for a raw users.link_slug ('lead:<slug>' or a project slug). */
export function ownerHrefForLinkSlug(
  linkSlug: string,
  opts: { tab?: string; focus?: string | number | null } = {},
): string {
  const scope: PortalScope = linkSlug.startsWith("lead:")
    ? { kind: "lead", slug: linkSlug.slice("lead:".length) }
    : { kind: "project", slug: linkSlug };
  return ownerHref(scope, opts);
}

/** Append a row. Best-effort: a missing project/lead or a DB hiccup logs and
 *  moves on — the ledger must never block a client action. */
export async function logClientActivity(input: LogInput): Promise<void> {
  try {
    const { scope } = input;
    const idRow =
      scope.kind === "project"
        ? await queryOne<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [scope.slug])
        : await queryOne<{ id: string }>(`SELECT id FROM leads WHERE slug = $1`, [scope.slug]);
    if (!idRow) return;
    await query(
      `INSERT INTO client_activity
         (lead_id, project_id, kind, summary, detail, entity_kind, entity_id, actor_name, href)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        scope.kind === "lead" ? idRow.id : null,
        scope.kind === "project" ? idRow.id : null,
        input.kind,
        input.summary.slice(0, 200),
        input.detail ? input.detail.slice(0, 500) : null,
        input.entityKind ?? null,
        input.entityId != null ? String(input.entityId) : null,
        input.actorName ?? "",
        input.href ?? null,
      ],
    );
  } catch (err) {
    console.error("[client-activity] log failed", err);
  }
}

/** Record a portal visit at most once per client per calendar day (business
 *  time zone) so the ledger reads "opened the portal" without a row per page
 *  load. Called from the client-portal layout. Best-effort. */
export async function logPortalVisit(scope: PortalScope, actorName: string): Promise<void> {
  try {
    const col = scope.kind === "project" ? "project_id" : "lead_id";
    const table = scope.kind === "project" ? "projects" : "leads";
    const idRow = await queryOne<{ id: string }>(`SELECT id FROM ${table} WHERE slug = $1`, [scope.slug]);
    if (!idRow) return;
    const dup = await queryOne<{ id: number }>(
      `SELECT id FROM client_activity
        WHERE ${col} = $1 AND kind = 'visit'
          AND (created_at AT TIME ZONE 'America/Chicago')::date = (now() AT TIME ZONE 'America/Chicago')::date
        LIMIT 1`,
      [idRow.id],
    );
    if (dup) return;
    await query(
      `INSERT INTO client_activity (${col}, kind, summary, actor_name, href)
       VALUES ($1, 'visit', $2, $3, $4)`,
      [idRow.id, `${actorName || "Client"} opened the portal`, actorName ?? "", ownerHref(scope, { tab: "Client portal" })],
    );
  } catch (err) {
    console.error("[client-activity] visit log failed", err);
  }
}

interface RawRow {
  id: number;
  kind: ClientActivityKind;
  summary: string;
  detail: string | null;
  entity_kind: string | null;
  entity_id: string | null;
  actor_name: string;
  href: string | null;
  age_seconds: number;
  when_absolute: string;
  from_lead: boolean;
}

/** The ledger for a scope, newest first. A project includes rows logged during
 *  its lead stage (projects.lead_id). */
export async function getClientActivity(scope: PortalScope, limit = 100): Promise<ClientActivityRow[]> {
  const where =
    scope.kind === "project"
      ? `(a.project_id = (SELECT id FROM projects WHERE slug = $1)
          OR a.lead_id = (SELECT lead_id FROM projects WHERE slug = $1))`
      : `a.lead_id = (SELECT id FROM leads WHERE slug = $1)`;
  const { rows } = await query<RawRow>(
    `SELECT a.id, a.kind, a.summary, a.detail, a.entity_kind, a.entity_id, a.actor_name, a.href,
            EXTRACT(EPOCH FROM (now() - a.created_at))::int AS age_seconds,
            ${sqlAbsoluteLabel("a.created_at")} AS when_absolute,
            (a.lead_id IS NOT NULL) AS from_lead
       FROM client_activity a
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2`,
    [scope.slug, limit],
  );
  // Lead-stage rows were logged with /leads/<slug> links. Uploads, messages,
  // visits and claims all live on the project after conversion (files are
  // re-keyed, the thread is renamed), so point those at the project instead;
  // documents/signatures stay lead-scoped and keep their lead link.
  const REHOME = new Set<ClientActivityKind>(["upload", "message", "visit", "claim"]);
  const rehome = (r: RawRow): string | null => {
    if (!r.href || scope.kind !== "project" || !r.from_lead || !REHOME.has(r.kind)) return r.href;
    const q = r.href.indexOf("?");
    return `/projects/${scope.slug}${q >= 0 ? r.href.slice(q) : ""}`;
  };
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    detail: r.detail ?? "",
    entityKind: r.entity_kind,
    entityId: r.entity_id,
    actor: r.actor_name,
    href: rehome(r),
    when: relativeAge(r.age_seconds),
    whenAbsolute: r.when_absolute,
    fromLead: scope.kind === "project" && r.from_lead,
  }));
}

/** Count of ledger rows newer than a cutoff — for tab badges. */
export async function countRecentClientActivity(scope: PortalScope, days = 7): Promise<number> {
  const where =
    scope.kind === "project"
      ? `(a.project_id = (SELECT id FROM projects WHERE slug = $1)
          OR a.lead_id = (SELECT lead_id FROM projects WHERE slug = $1))`
      : `a.lead_id = (SELECT id FROM leads WHERE slug = $1)`;
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM client_activity a
      WHERE ${where} AND a.created_at > now() - ($2 || ' days')::interval AND a.kind <> 'visit'`,
    [scope.slug, String(days)],
  );
  return row?.n ?? 0;
}
