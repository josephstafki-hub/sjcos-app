// WHO is on a to-do — THE single definition site for multi-person assignment
// (table work_item_assignees, db/apply-multi-assignees.mjs). Plain .mjs with no
// imports, like lib/triage-lanes.mjs, so the Next app (lib/queue-scope.ts,
// lib/engine.ts, lib/actions/*) and the MCP server (mcp/sjcos-mcp.mjs, which
// can't import TS) read and write assignment exactly the same way.
//
// The rules (Joe, 2026-09-27 and 2026-09-30):
//   • Any number of people can be on one to-do — Joe and Abigail together,
//     or any team member alongside them. Only the owner changes who.
//   • No rows = the owner's own. Everything agents, detectors and runbooks
//     file lands that way, and it is what the old NULL meant.
//   • "Just the owner" is stored as no rows: the owner's id is only ever
//     stored alongside someone else, so there is one spelling of "Joe's".

/** LEFT JOIN LATERAL that yields `asg.assigned` for work item `w`: everyone on
 *  it as a JSON array of {userId, name, initials}, owner first then by name.
 *  NULL when nobody is (= the owner's own). Select `asg.assigned` with it. */
export const ASSIGNEES_JOIN_SQL = `
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('userId', au.id, 'name', au.name, 'initials', au.initials)
                        ORDER BY (au.role = 'owner') DESC, au.name) AS assigned
          FROM work_item_assignees wa
          JOIN users au ON au.id = wa.user_id
         WHERE wa.work_item_id = w.id
      ) asg ON true`;

/** WHERE condition: the person in bind parameter `param` (e.g. "$1") is on
 *  work item `w`. */
export function isOnItemSql(param) {
  return `EXISTS (SELECT 1 FROM work_item_assignees wa
                   WHERE wa.work_item_id = w.id AND wa.user_id = ${param})`;
}

/** Replace everyone on to-do $1 with the uuid[] in $2, in ONE statement (so it
 *  is atomic without a transaction). People who stay on it keep their
 *  assigned_at. Also blanks the legacy single-person column, which is what
 *  keeps db/apply-multi-assignees.mjs safe to re-run after the deploy.
 *  Returns one row — {added_user_ids: uuid[] | null}, the people newly put on
 *  it — or no row when the work item doesn't exist. */
export const REPLACE_ASSIGNEES_SQL = `
    WITH item AS (
      UPDATE work_items SET assigned_user_id = NULL, updated_at = now()
       WHERE id = $1
      RETURNING id
    ), removed AS (
      DELETE FROM work_item_assignees wa USING item
       WHERE wa.work_item_id = item.id AND NOT (wa.user_id = ANY($2::uuid[]))
    ), added AS (
      INSERT INTO work_item_assignees (work_item_id, user_id)
      SELECT item.id, u FROM item, unnest($2::uuid[]) AS u
      ON CONFLICT DO NOTHING
      RETURNING user_id
    )
    SELECT (SELECT array_agg(user_id::text) FROM added) AS added_user_ids FROM item`;

/** Everyone on to-do $1 now, plus its title: {title, ids: text[]} — ids empty
 *  when it's the owner's own — or no row when the work item doesn't exist. */
export const CURRENT_ASSIGNEES_SQL = `
    SELECT w.title,
           COALESCE(array_agg(wa.user_id::text) FILTER (WHERE wa.user_id IS NOT NULL), '{}') AS ids
      FROM work_items w
      LEFT JOIN work_item_assignees wa ON wa.work_item_id = w.id
     WHERE w.id = $1
     GROUP BY w.id`;

/** Which ids to store for the people picked for a to-do. Duplicates collapse,
 *  and a pick with nobody but the owner in it is stored as no rows — "just
 *  Joe" and "nobody" must not be two different spellings of his own to-do.
 *  @param {{ id: string, role: string }[]} people
 *  @returns {string[]} */
export function idsToStore(people) {
  if (!people.some((p) => p.role !== "owner")) return [];
  return [...new Set(people.map((p) => p.id))];
}

/** Same set of people, in any order? Used to skip a no-op write (which would
 *  still bump updated_at and reorder the queue).
 *  @param {string[]} a @param {string[]} b */
export function sameAssignees(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((id) => sb.has(id));
}

/** "Abigail" · "Joe & Abigail" · "Joe, Abigail & Marco".
 *  @param {string[]} names */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** The notification a person gets when they're put on a to-do. Names whoever
 *  else is on it, so a shared task never reads as theirs alone.
 *  @param {string} title @param {string[]} otherNames
 *  @returns {{ title: string, subline: string }} */
export function assignedNotice(title, otherNames) {
  return {
    title: `Joe assigned you: ${title}`,
    subline: otherNames.length
      ? `With ${joinNames(otherNames)}. It's on your Today now.`
      : "It's on your Today now.",
  };
}
