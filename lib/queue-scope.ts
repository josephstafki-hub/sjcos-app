// WHOSE TO-DOS a Today queue is built from.
//
// Deliberately dependency-free (no db, no ai, no React): this is the one rule
// that decides whether a team member reads their own board or Joe's, so it is
// worth being able to test on its own — see tests/staff-separation.test.mjs.
// lib/today.ts re-exports everything here, so nothing else had to move.

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

const OPEN_WORK_ITEMS_SELECT = `
    SELECT w.id, w.title, left(NULLIF(w.body, ''), 140) AS body,
           w.status, w.priority, w.effort_class,
           to_char(w.due_at, 'FMMon FMDD') AS due,
           w.snoozed_until,
           w.promoted_at,
           p.slug AS project_slug, p.name AS project_name, p.status AS project_status,
           l.slug AS lead_slug, l.name AS lead_name,
           w.assigned_user_id, au.name AS assigned_name, au.initials AS assigned_initials
      FROM work_items w
      LEFT JOIN projects p ON p.id = w.project_id
      LEFT JOIN leads l ON l.id = w.lead_id
      LEFT JOIN users au ON au.id = w.assigned_user_id
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
 *  Staff: strictly `assigned_user_id = them`. NULL means the owner's, so an
 *  unassigned to-do is never a team member's problem by accident. */
export function openWorkItemsSql(viewer: QueueViewer): { sql: string; params: string[] } {
  if (isOwner(viewer)) return { sql: OPEN_WORK_ITEMS_SELECT, params: [] };
  return { sql: `${OPEN_WORK_ITEMS_SELECT}\n       AND w.assigned_user_id = $1`, params: [viewer.id] };
}

export const OPEN_WORK_ITEMS_ORDER_SQL = `
     ORDER BY array_position(ARRAY['urgent','high','normal','low'], w.priority),
              w.due_at NULLS LAST,
              w.updated_at DESC,
              w.id`;
