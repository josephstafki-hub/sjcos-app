// Lead activity log (round 3, Session 2). A real timeline of what's happened on
// a lead — stage moves, estimate drafted/sent, contact edits, notes. Read here
// for the Activity tab; written by the lead server actions via logLeadActivity.
// Server-only (imports lib/db → pg); never import a VALUE from this into a
// client component.

import { query } from "./db";

export type LeadActivityKind =
  | "created"
  | "stage"
  | "estimate"
  | "email"
  | "contact"
  | "note";

export interface LeadActivityRow {
  id: number;
  kind: LeadActivityKind;
  summary: string;
  actor: string;
  /** A deterministic relative label, e.g. "5d ago" / "just now". */
  when: string;
}

interface RawRow {
  id: number;
  kind: LeadActivityKind;
  summary: string;
  actor: string;
  age_seconds: number;
}

/** Deterministic relative-time label (no locale → no hydration mismatch). */
export function relativeAge(seconds: number): string {
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** The activity timeline for a lead, newest first. */
export async function getLeadActivity(slug: string): Promise<LeadActivityRow[]> {
  const { rows } = await query<RawRow>(
    `SELECT a.id, a.kind, a.summary, a.actor,
            EXTRACT(EPOCH FROM (now() - a.created_at))::int AS age_seconds
       FROM lead_activity a
       JOIN leads l ON l.id = a.lead_id
      WHERE l.slug = $1
      ORDER BY a.created_at DESC, a.id DESC`,
    [slug],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    actor: r.actor,
    when: relativeAge(r.age_seconds),
  }));
}

// Activity kinds that represent a genuine touch on the LEAD (a reply sent, a
// stage moved, contact info confirmed) — as opposed to passive AI prep work
// (drafting an estimate, auto-scoring, importing photos) that doesn't mean
// anyone actually engaged with the client. Every current call site already
// lines up with this split; see lib/actions/leads.ts and lib/intake.ts.
const REAL_CONTACT_KINDS: ReadonlySet<LeadActivityKind> = new Set(["stage", "contact", "email"]);

/** Append an activity row for a lead, looked up by slug. Safe no-op if the lead
 *  doesn't exist (the subquery yields no row to insert).
 *
 *  Also the single place that keeps `leads.last_contact_at` and the stale
 *  `flag_label`/`flag_kind` "Needs reply" chip honest: a real contact-kind
 *  activity (stage/contact/email) bumps last_contact_at and clears the flag,
 *  since nothing else in the app ever did — a lead could sit flagged forever
 *  even after being replied to and moved through several stages. AI-authored
 *  activity (draftEstimate, auto-scoring) intentionally does NOT clear it —
 *  drafting isn't replying. */
export async function logLeadActivity(
  slug: string,
  kind: LeadActivityKind,
  summary: string,
  actor = "Joe",
): Promise<void> {
  await query(
    `INSERT INTO lead_activity (lead_id, kind, summary, actor)
     SELECT id, $2, $3, $4 FROM leads WHERE slug = $1`,
    [slug, kind, summary, actor],
  );
  if (REAL_CONTACT_KINDS.has(kind)) {
    await query(
      `UPDATE leads SET last_contact_at = now(), flag_label = NULL, flag_kind = NULL WHERE slug = $1`,
      [slug],
    );
  }
}
