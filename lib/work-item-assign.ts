import "server-only";

// The app's one write path for WHO is on a to-do — the Today card picker
// (lib/actions/today.ts) and the /engine board (lib/actions/engine.ts) both land
// here. Callers gate on requireRole("owner") first: holding an area lets you
// work your queue, never re-deal it (Joe, 2026-09-27). The SQL and the rules
// live in lib/work-item-assignees.mjs, shared with the MCP server.

import { query, queryOne } from "./db";
import { emit } from "./notify";
import {
  CURRENT_ASSIGNEES_SQL,
  REPLACE_ASSIGNEES_SQL,
  assignedNotice,
  idsToStore,
  sameAssignees,
} from "./work-item-assignees.mjs";

type Result = { ok: true } | { ok: false; error: string };

interface Person {
  id: string;
  name: string;
  role: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The people a pick names — or null if any of them can't hold a to-do. Only
 *  an active internal login (owner or staff) can: never a sub or client portal
 *  account, never a deactivated one. The ids arrive from the client, so a
 *  malformed one is refused here rather than blowing up the uuid cast. */
export async function pickedPeople(userIds: string[]): Promise<Person[] | null> {
  const ids = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  if (!ids.every((id) => UUID_RE.test(id))) return null;
  const { rows } = await query<Person>(
    `SELECT id, name, role FROM users
      WHERE id = ANY($1::uuid[]) AND active AND role IN ('owner','staff')`,
    [ids],
  );
  return rows.length === ids.length ? rows : null;
}

/** Put exactly `userIds` on a to-do (empty = back to the owner's own). A no-op
 *  when nothing changes, so it doesn't bump updated_at and reshuffle the queue.
 *  Everyone newly put on it — other than the owner — gets a notification
 *  naming whoever they share it with, so a hand-off is never silent. */
export async function setAssignees(workItemId: string, userIds: string[]): Promise<Result> {
  const people = await pickedPeople(userIds);
  if (!people) return { ok: false, error: "Only an active team login can hold a to-do." };
  if (!UUID_RE.test(workItemId)) return { ok: false, error: "That work item no longer exists." };

  const cur = await queryOne<{ title: string; ids: string[] }>(CURRENT_ASSIGNEES_SQL, [workItemId]);
  if (!cur) return { ok: false, error: "That work item no longer exists." };

  const next = idsToStore(people);
  if (sameAssignees(cur.ids, next)) return { ok: true };

  const row = await queryOne<{ added_user_ids: string[] | null }>(REPLACE_ASSIGNEES_SQL, [
    workItemId,
    next,
  ]);
  await notifyAdded(cur.title, row?.added_user_ids ?? [], people.filter((p) => next.includes(p.id)));
  return { ok: true };
}

/** Put a brand-new to-do's people on it. Same notification as setAssignees. */
export async function assignNewItem(workItemId: string, title: string, people: Person[]): Promise<void> {
  const next = idsToStore(people);
  if (!next.length) return;
  const row = await queryOne<{ added_user_ids: string[] | null }>(REPLACE_ASSIGNEES_SQL, [
    workItemId,
    next,
  ]);
  await notifyAdded(title, row?.added_user_ids ?? [], people.filter((p) => next.includes(p.id)));
}

async function notifyAdded(title: string, addedIds: string[], onIt: Person[]): Promise<void> {
  for (const person of onIt) {
    // The owner is the one doing the assigning — "Joe assigned you" to Joe
    // would be noise.
    if (person.role === "owner" || !addedIds.includes(person.id)) continue;
    const notice = assignedNotice(
      title,
      onIt.filter((p) => p.id !== person.id).map((p) => p.name),
    );
    await emit({
      kind: "job",
      tag: "Assigned",
      accent: "accent",
      icon: "star",
      title: notice.title,
      subline: notice.subline,
      href: "/today",
      audienceUserId: person.id,
    });
  }
}
