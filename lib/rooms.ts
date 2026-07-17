// Entity chat-room bookkeeping (P1-D2). Plain server helpers (NOT "use server"
// — these are called from already-owner-gated Server Actions in lib/actions/*).
// A room is auto-opened when a lead/project/warranty case is created and closed
// (closed_at set, never deleted) when the entity goes lost/completed/closed, so
// the transcript under the key survives. The stored set lives in chat_rooms;
// lib/chat.ts reads open rooms from it. All writes here are idempotent so a
// re-fired action (re-click, retried transition) never duplicates or resurrects
// state. Room bookkeeping must never block the entity CRUD it rides on, so
// callers wrap these in try/catch.

import { query } from "./db";
import { roomKey, leadRoomKey, warrantyRoomKey } from "./chat";

type EntityType = "lead" | "project" | "warranty";

function keyFor(type: EntityType, ref: string): string {
  if (type === "lead") return leadRoomKey(ref);
  if (type === "warranty") return warrantyRoomKey(ref);
  return roomKey(ref);
}

/** Open (or reopen) the room for an entity. Upsert: creating a room and
 *  reopening a previously-closed one are the same primitive. */
export async function openEntityRoom(type: EntityType, ref: string, name: string): Promise<void> {
  await query(
    `INSERT INTO chat_rooms (key, entity_type, entity_ref, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET closed_at = NULL, name = EXCLUDED.name`,
    [keyFor(type, ref), type, ref, name],
  );
}

/** Close a room by its channel key. No-op if already closed or missing. Also
 *  clears the nav unread badge for the key (a closed room has no UI to mark it
 *  read), mirroring how archiveChannel handles bare channels. */
export async function closeEntityRoom(key: string): Promise<void> {
  const res = await query(
    `UPDATE chat_rooms SET closed_at = now() WHERE key = $1 AND closed_at IS NULL`,
    [key],
  );
  if (res.rowCount) {
    await query(
      `INSERT INTO chat_reads (channel_key, last_read_at)
       VALUES ($1, now())
       ON CONFLICT (channel_key) DO UPDATE SET last_read_at = now()`,
      [key],
    );
  }
}

/** Resolve the currently-open room key backing a project (its project room, or
 *  its warranty room once it has completed construction). */
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
 *  project's participants follow it into its warranty room on completion.
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
