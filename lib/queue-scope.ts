// WHOSE TO-DOS a Today queue is built from.
//
// Deliberately dependency-free (no db, no ai, no React — its one import is the
// plain-.mjs assignment rules it shares with the MCP server): this is the one
// rule that decides whether a team member reads their own board or Joe's, so it
// is worth being able to test on its own — see tests/staff-separation.test.mjs.
// lib/today.ts re-exports everything here, so nothing else had to move.

import { ASSIGNEES_JOIN_SQL, isOnItemSql, joinNames } from "./work-item-assignees.mjs";

/** Whose Today this is. Everything built from it is for ONE person: the owner
 *  sees every human to-do (handed off or not); a staff member sees only the
 *  ones assigned to them, and none of the business signals — leads needing a
 *  reply, jobs drifting, A/R — which are Joe's to work, not theirs. */
export interface QueueViewer {
  id: string;
  name: string;
  role: string;
}

export const isOwner = (v: QueueViewer) => v.role === "owner";

/** One person on a to-do. */
export interface AssignedTo {
  userId: string;
  name: string;
  initials: string;
}

/** `asg.assigned` (ASSIGNEES_JOIN_SQL's JSON array, NULL when nobody is on it)
 *  → the people on a to-do. Empty = the owner's own. */
export function toAssigned(raw: AssignedTo[] | null | undefined): AssignedTo[] {
  return (raw ?? []).map((a) => ({
    userId: a.userId,
    name: a.name || "Team member",
    initials: a.initials || "?",
  }));
}

/** The "who's on it" line a card shows to `viewerId`, or null when there's
 *  nobody on it but them (Joe's own to-do on his Today; a to-do that's only
 *  Abigail's on hers) — the line exists to flag everyone ELSE.
 *
 *    Joe viewing Abigail's          → "Assigned to Abigail Stafki"
 *    Joe viewing Joe + Abigail      → "Assigned to you & Abigail Stafki"
 *    Abigail viewing Joe + Abigail  → "Assigned to you & Joe Stafki"
 *
 *  `others` is who the line names, for the initials badges. */
export function describeAssignment(
  assigned: AssignedTo[],
  viewerId: string,
): { label: string; others: AssignedTo[] } | null {
  const others = assigned.filter((a) => a.userId !== viewerId);
  if (!others.length) return null;
  const names = joinNames(others.map((a) => a.name));
  const withViewer = others.length < assigned.length;
  return { label: withViewer ? `Assigned to you & ${names}` : `Assigned to ${names}`, others };
}

const OPEN_WORK_ITEMS_SELECT = `
    SELECT w.id, w.title, left(NULLIF(w.body, ''), 140) AS body,
           w.status, w.priority, w.effort_class,
           to_char(w.due_at, 'FMMon FMDD') AS due,
           w.snoozed_until,
           w.promoted_at,
           p.slug AS project_slug, p.name AS project_name, p.status AS project_status,
           l.slug AS lead_slug, l.name AS lead_name,
           asg.assigned
      FROM work_items w
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN leads l ON l.id = w.lead_id${ASSIGNEES_JOIN_SQL}
     WHERE w.status NOT IN ('done','cancelled','waiting_on_client')
       AND (w.snoozed_until IS NULL OR w.snoozed_until <= now())
       AND w.assignee_kind = 'human'
       AND (w.assignee_key IS NULL OR w.assignee_key = 'human-joe')
       AND (l.id IS NULL OR l.stage <> 'lost')`;

/** The open-backlog query for ONE person.
 *
 *  Owner: no assignment filter at all. A to-do he hands to a team member stays
 *  on his Today with their name on it — his rule, 2026-09-27: "it'll always
 *  remain on mine, but will list prominently who it's assigned to."
 *
 *  Staff: strictly the to-dos they are ON (work_item_assignees), alone or
 *  alongside others. Nobody on it means the owner's, so an unassigned to-do is
 *  never a team member's problem by accident. */
export function openWorkItemsSql(viewer: QueueViewer): { sql: string; params: string[] } {
  if (isOwner(viewer)) return { sql: OPEN_WORK_ITEMS_SELECT, params: [] };
  return { sql: `${OPEN_WORK_ITEMS_SELECT}\n       AND ${isOnItemSql("$1")}`, params: [viewer.id] };
}

export const OPEN_WORK_ITEMS_ORDER_SQL = `
     ORDER BY array_position(ARRAY['urgent','high','normal','low'], w.priority),
              w.due_at NULLS LAST,
              w.updated_at DESC,
              w.id`;
