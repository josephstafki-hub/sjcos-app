"use server";

// Read-only lookups the discovery-checklist screens need beside the backend
// actions in ./discovery-checklist.ts: lead and call pickers for the session
// header, the lead's contact details for the summary, and the live-call bar.
// No writes here — every checklist change goes through the backend commands.

import { can, getCurrentUser, requireAccess } from "@/lib/dal";
import { query, queryOne } from "@/lib/db";
import { activeCallSnapshot } from "./discovery-checklist";
import { searchChecklistLeads } from "@/lib/checklist-lead-search";

export interface ChecklistLead { id: string; slug: string; name: string; scope: string; phone: string | null; email: string | null; on_call?: boolean }
export interface ChecklistCallOption { id: string; label: string; number: string; started_at: string; direction: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lead search as a server action (the picker itself uses the GET route
 *  /api/calls/checklist-leads, which doesn't queue behind the sync). */
export async function checklistLeadSearch(text: string, callNumber?: string | null): Promise<ChecklistLead[]> {
  await requireAccess("comms");
  return searchChecklistLeads(text, callNumber);
}

export async function checklistLeadInfo(leadId: string): Promise<ChecklistLead | null> {
  await requireAccess("comms");
  if (!UUID.test(leadId)) return null;
  return queryOne<ChecklistLead>(`SELECT id, slug, name, COALESCE(scope,'') AS scope, phone, email FROM leads WHERE id = $1`, [leadId]);
}

export async function checklistLeadBySlug(slug: string): Promise<ChecklistLead | null> {
  await requireAccess("comms");
  return queryOne<ChecklistLead>(`SELECT id, slug, name, COALESCE(scope,'') AS scope, phone, email FROM leads WHERE slug = $1`, [slug]);
}

/** Call picker for "Call: none ▾": recent calls, newest first. */
export async function checklistRecentCalls(): Promise<ChecklistCallOption[]> {
  await requireAccess("comms");
  const { rows } = await query<ChecklistCallOption>(
    `SELECT id, COALESCE(NULLIF(btrim(contact_name),''), counterparty_number) AS label, counterparty_number AS number,
            started_at::text AS started_at, direction
       FROM calls WHERE started_at > now() - interval '14 days' ORDER BY started_at DESC LIMIT 25`,
  );
  return rows;
}

export interface LiveCallBarCall {
  id: string; status: string; direction: string; label: string | null; number: string;
  started_at: string; answered_at: string | null; session_id: string | null;
  /** The lead this call is tied to (by the call row, or its checklist). */
  lead_id: string | null; lead_slug: string | null;
}
export interface LiveCallBarManual { id: string; lead_name: string | null; lead_slug: string | null; started_at: string }
export interface LiveCallBarData { calls: LiveCallBarCall[]; manual: LiveCallBarManual[] }

/** The app-wide live-call bar (plan §4.1): ringing/bridged calls from the last
 *  2 h and this person's own open hand-ticked checklists. Null for anyone
 *  without Calls access — no query runs for them. */
export async function liveCallBarData(): Promise<LiveCallBarData | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, "comms")) return null;
  const snap = await activeCallSnapshot();
  const leads = await query<{ id: string; lead_name: string | null; lead_id: string | null; lead_slug: string | null }>(
    `SELECT c.id, COALESCE(NULLIF(btrim(c.contact_name),''), l.name) AS lead_name, l.id AS lead_id, l.slug AS lead_slug
       FROM calls c
       LEFT JOIN checklist_sessions s ON s.call_id = c.id
       LEFT JOIN leads l ON l.id = COALESCE(c.lead_id, s.lead_id)
      WHERE c.id = ANY($1::uuid[])`,
    [snap.calls.map((c) => c.id)],
  );
  const byCall = new Map(leads.rows.map((r) => [r.id, r]));
  const manual = await query<LiveCallBarManual>(
    `SELECT s.id, l.name AS lead_name, l.slug AS lead_slug, s.started_at::text AS started_at
       FROM checklist_sessions s LEFT JOIN leads l ON l.id = s.lead_id
      WHERE s.call_id IS NULL AND s.status = 'open' AND s.created_by = $1 AND s.started_at > now() - interval '2 hours'
      ORDER BY s.started_at DESC LIMIT 3`,
    [user.id],
  );
  return {
    calls: snap.calls.map((c) => {
      const l = byCall.get(c.id);
      return { id: c.id, status: c.status, direction: c.direction, label: l?.lead_name ?? c.contact_name, number: c.counterparty_number, started_at: c.started_at, answered_at: c.answered_at, session_id: c.session_id, lead_id: l?.lead_id ?? null, lead_slug: l?.lead_slug ?? null };
    }),
    manual: manual.rows,
  };
}
