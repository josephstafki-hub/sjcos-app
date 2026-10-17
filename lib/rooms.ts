// Entity chat-room bookkeeping (P1-D2). Plain server helpers (NOT "use server"
// — these are called from already-owner-gated Server Actions in lib/actions/*).
// A room is open while its lead/project is active and archived (closed_at set,
// never deleted) once the lead is lost/converted or the project reaches
// warranty, so the transcript under the key survives. The stored set lives in
// chat_rooms; lib/chat.ts reads it.
//
// The lifecycle itself is enforced on the tables (sync_chat_rooms(), fired by
// triggers on leads and projects — db/apply-chat-room-lifecycle.mjs), so every
// writer keeps rooms in step, not just the actions that call in here. The
// open/close calls below still run where they always did (they agree with the
// reconcile and carry membership); archiveRoom/restoreRoom are the owner's
// manual override, recorded in chat_rooms.hold. All writes here are idempotent.
// Room bookkeeping must never block the entity CRUD it rides on, so callers
// wrap these in try/catch.

import { query } from "./db";
import { roomKey, leadRoomKey, warrantyRoomKey } from "./chat";

type EntityType = "lead" | "project" | "warranty";

function keyFor(type: EntityType, ref: string): string {
  if (type === "lead") return leadRoomKey(ref);
  if (type === "warranty") return warrantyRoomKey(ref);
  return roomKey(ref);
}

/** Open (or reopen) the room for an entity. Upsert: creating a room and
 *  reopening a previously-closed one are the same primitive. Same rule as the
 *  table reconcile: a room the owner archived by hand stays archived. */
export async function openEntityRoom(type: EntityType, ref: string, name: string): Promise<void> {
  await query(
    `INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE
        SET closed_at = CASE WHEN chat_rooms.hold = 'archived' THEN chat_rooms.closed_at END,
            hold = NULLIF(chat_rooms.hold, 'open'),
            name = EXCLUDED.name`,
    [keyFor(type, ref), type, ref, name],
  );
}

/** Close a room by its channel key. No-op if already closed, missing, or held
 *  open by the owner (a room restored by hand stays up until the owner archives
 *  it — the warranty page's aging sweep must not undo that click). Also
 *  clears the nav unread badge for the key (a closed room has no UI to mark it
 *  read), mirroring how archiveChannel handles bare channels.
 *
 *  Read markers are per-person now, and a room that closes is gone for everyone
 *  who was in it — so stamp one for each of them (plus the owner), not just the
 *  single global marker this used to write. */
export async function closeEntityRoom(key: string): Promise<void> {
  const res = await query(
    `UPDATE chat_rooms SET closed_at = now()
      WHERE key = $1 AND closed_at IS NULL AND hold IS DISTINCT FROM 'open'`,
    [key],
  );
  if (res.rowCount) {
    await query(
      `INSERT INTO chat_reads_by_user (channel_key, user_id, last_read_at)
         SELECT $1, u.id, now() FROM users u
          WHERE u.active
            AND (u.role = 'owner'
                 OR EXISTS (
                   SELECT 1 FROM chat_team_members tm
                     JOIN team_members t ON t.slug = tm.member_slug
                    WHERE tm.channel_key = $1 AND t.user_id = u.id
                 ))
       ON CONFLICT (channel_key, user_id) DO UPDATE SET last_read_at = now()`,
      [key],
    );
  }
}

/** Is this room's lead/project active right now (i.e. would the reconcile keep
 *  it open on its own)? */
async function entityActive(key: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM chat_room_entities WHERE key = $1`, [key]);
  return rows.length > 0;
}

/** Owner archives a room by hand. On a live job that's an override, so it is
 *  held archived until the job itself closes; on a finished one it simply
 *  agrees with the reconcile. Returns false if the room doesn't exist. */
export async function archiveRoom(key: string): Promise<boolean> {
  const hold = (await entityActive(key)) ? "archived" : null;
  const res = await query(
    `UPDATE chat_rooms SET closed_at = COALESCE(closed_at, now()), hold = $2 WHERE key = $1`,
    [key, hold],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Owner restores an archived room — the one-click reverse of an archive. On a
 *  finished job it's held open until the owner archives it again; on a live
 *  one it simply agrees with the reconcile. Members and transcript were never
 *  touched, so it comes back exactly as it was. */
export async function restoreRoom(key: string): Promise<boolean> {
  const hold = (await entityActive(key)) ? null : "open";
  const res = await query(`UPDATE chat_rooms SET closed_at = NULL, hold = $2 WHERE key = $1`, [key, hold]);
  return (res.rowCount ?? 0) > 0;
}

/** Resolve the currently-open room key backing a project: its project room
 *  (or, for a job that finished before 2026-10-16, a warranty room the owner
 *  restored by hand). None once the project is finished and archived. */
async function openRoomKeyForProject(projectSlug: string): Promise<string | null> {
  const { rows } = await query<{ key: string }>(
    `SELECT key FROM chat_rooms
      WHERE entity_type IN ('project','warranty') AND entity_ref = $1 AND closed_at IS NULL
      ORDER BY opened_at DESC LIMIT 1`,
    [projectSlug],
  );
  return rows[0]?.key ?? null;
}

/** Auto-add a sub to the project's open room (P1-D2 — "any sub added to that
 *  entity is auto-added to its room"). Idempotent; no-op if no open room. */
export async function addSubToEntityRoom(projectSlug: string, subSlug: string): Promise<void> {
  const key = await openRoomKeyForProject(projectSlug);
  if (!key) return;
  await query(
    `INSERT INTO chat_members (channel_key, sub_slug) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [key, subSlug],
  );
}

/** Remove a sub from the project's open room when they're pulled off the job. */
export async function removeSubFromEntityRoom(projectSlug: string, subSlug: string): Promise<void> {
  const key = await openRoomKeyForProject(projectSlug);
  if (!key) return;
  await query(`DELETE FROM chat_members WHERE channel_key = $1 AND sub_slug = $2`, [key, subSlug]);
}

/** Copy all membership (subs, team, clients) from one room key to another, so a
 *  lead's participants follow it into its project room on conversion.
 *  Idempotent on every table. */
export async function carryRoomMembership(fromKey: string, toKey: string): Promise<void> {
  await query(
    `INSERT INTO chat_members (channel_key, sub_slug)
     SELECT $2, sub_slug FROM chat_members WHERE channel_key = $1
     ON CONFLICT DO NOTHING`,
    [fromKey, toKey],
  );
  await query(
    `INSERT INTO chat_team_members (channel_key, member_slug)
     SELECT $2, member_slug FROM chat_team_members WHERE channel_key = $1
     ON CONFLICT DO NOTHING`,
    [fromKey, toKey],
  );
  await query(
    `INSERT INTO chat_room_clients (room_key, name, email)
     SELECT $2, name, email FROM chat_room_clients WHERE room_key = $1
     ON CONFLICT (room_key, name) DO NOTHING`,
    [fromKey, toKey],
  );
}
