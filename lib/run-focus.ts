import "server-only";

import { queryOne } from "@/lib/db";
import { hrefForScope, type RunFocus } from "@/lib/entity-href";

// Which page shows what a run is working on. The Claude runner
// (scripts/run-claude-agent.mjs) records a run_effects row per sjcos tool call
// with the entity it named — project slug, lead slug, work item, draft id… —
// and this turns the LATEST such row into an href + label for the operator
// panel's live-action navigation (components/panel/LiveActionNav.tsx).
// Read on every 2s poll of a live run, so: one small lookup, never throws.

/** entity_kind "project_<key>" → the project page tab (lib/project-tabs.ts). */
const PROJECT_TAB: Record<string, string> = {
  ops: "Ops",
  floor: "Floor",
  mood: "Mood",
  selections: "Selections",
  bidding: "Bidding",
  money: "Money",
  documents: "Documents",
  schedule: "Schedule",
  subs: "Subs",
  files: "Files",
  daily_log: "Daily log",
};

function projectHref(slug: string, tab?: string | null, focus?: string | null): string {
  const q = new URLSearchParams();
  if (tab) q.set("tab", tab);
  if (focus) q.set("focus", focus);
  const qs = q.toString();
  return `/projects/${slug}${qs ? `?${qs}` : ""}`;
}

function withTab(name: string, tab?: string | null): string {
  return tab ? `${name} · ${tab}` : name;
}

/** Same match the resolver uses everywhere: a slug or a uuid, as text. */
const BY_REF = `slug = $1 OR id::text = $1`;

async function resolve(kind: string, id: string): Promise<RunFocus | null> {
  if (kind === "project" || kind.startsWith("project_")) {
    const tab = kind === "project" ? null : (PROJECT_TAB[kind.slice("project_".length)] ?? null);
    const p = await queryOne<{ slug: string; name: string }>(
      `SELECT slug, name FROM projects WHERE ${BY_REF}`,
      [id],
    );
    return p ? { href: projectHref(p.slug, tab), label: withTab(p.name, tab) } : null;
  }
  if (kind === "lead") {
    const l = await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM leads WHERE ${BY_REF}`, [id]);
    return l ? { href: `/leads/${l.slug}`, label: l.name } : null;
  }
  if (kind === "vendor") {
    const v = await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM vendors WHERE ${BY_REF}`, [id]);
    return v ? { href: `/vendors/${v.slug}`, label: v.name } : null;
  }
  if (kind === "sub") {
    const v = await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM subs WHERE ${BY_REF}`, [id]);
    return v ? { href: `/subs/${v.slug}`, label: v.name } : null;
  }
  if (kind === "work_item") {
    const w = await queryOne<{ title: string }>(`SELECT title FROM work_items WHERE id::text = $1`, [id]);
    return w ? { href: `/workbench?s=${encodeURIComponent(id)}`, label: w.title } : null;
  }
  if (kind === "document_draft") {
    const d = await queryOne<{ id: string; slug: string | null; name: string | null }>(
      `SELECT d.id::text AS id, p.slug, p.name
         FROM document_drafts d LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.id::text = $1`,
      [id],
    );
    if (!d) return null;
    return d.slug
      ? { href: projectHref(d.slug, "Documents", `draft-${d.id}`), label: withTab(d.name ?? d.slug, "Documents") }
      : { href: "/files", label: "Documents" };
  }
  if (kind === "purchase_order" || kind === "bid_package") {
    const table = kind === "purchase_order" ? "purchase_orders" : "bid_packages";
    const tab = kind === "purchase_order" ? "Money" : "Bidding";
    const r = await queryOne<{ slug: string; name: string }>(
      `SELECT p.slug, p.name FROM ${table} x JOIN projects p ON p.id = x.project_id WHERE x.id::text = $1`,
      [id],
    );
    return r ? { href: projectHref(r.slug, tab), label: withTab(r.name, tab) } : null;
  }
  if (kind === "newsletter_issue") return { href: "/newsletter", label: "Newsletter" };
  // Unknown kind: fall back to the table's section page, if it has one.
  const href = hrefForScope(kind);
  return href ? { href, label: kind.replace(/_/g, " ") } : null;
}

/** The page for the entity the run most recently touched, or null when it
 *  hasn't named one yet (or the reference no longer resolves). */
export async function getRunFocus(runId: string): Promise<RunFocus | null> {
  try {
    const row = await queryOne<{ entity_kind: string; entity_id: string }>(
      `SELECT entity_kind, entity_id FROM run_effects
        WHERE run_id = $1 AND entity_id IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [runId],
    );
    if (!row) return null;
    return await resolve(row.entity_kind, row.entity_id);
  } catch {
    // Focus is a nicety on top of the poll; never let it fail a turn.
    return null;
  }
}
