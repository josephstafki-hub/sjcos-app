import "server-only";

import { query, queryOne } from "@/lib/db";
import type { PanelAgent } from "@/lib/dev-agents-meta";
import {
  type FolderEntityKind,
  type FolderEntityRef,
  type RailFolder,
  type RailThread,
  sortKeysFor,
} from "@/lib/thread-rail";

// Panel threads v2 — folders + lifecycle (docs/thread-folders-plan.md).
// Read/build + row mutations for ai_folders and the lifecycle columns on
// ai_conversations. Owner gating and the per-message hooks live in
// lib/actions/ai-chat.ts. Pure partition/sort logic is lib/thread-rail.ts
// (client-safe) so the rail can re-partition without a round trip.

// ─── Entities a folder can be bound to ───────────────────────────────────────

const ENTITY_TABLE: Record<FolderEntityKind, string> = {
  project: "projects",
  lead: "leads",
  vendor: "vendors",
  sub: "subs",
};
const ENTITY_PATH: Record<FolderEntityKind, string> = {
  project: "/projects",
  lead: "/leads",
  vendor: "/vendors",
  sub: "/subs",
};

export interface ResolvedEntity {
  kind: FolderEntityKind;
  /** Canonical id stored on the folder: the slug. */
  slug: string;
  name: string;
  href: string;
}

function isEntityKind(k: string): k is FolderEntityKind {
  return k === "project" || k === "lead" || k === "vendor" || k === "sub";
}

/** Slug-or-uuid → the entity's slug + name (same match run-focus uses). */
export async function resolveEntity(ref: FolderEntityRef): Promise<ResolvedEntity | null> {
  if (!isEntityKind(ref.kind)) return null;
  const row = await queryOne<{ slug: string; name: string }>(
    `SELECT slug, name FROM ${ENTITY_TABLE[ref.kind]} WHERE slug = $1 OR id::text = $1`,
    [ref.id],
  );
  if (!row) return null;
  return { kind: ref.kind, slug: row.slug, name: row.name, href: `${ENTITY_PATH[ref.kind]}/${row.slug}` };
}

async function resolveMany(kind: FolderEntityKind, slugs: string[]): Promise<Map<string, ResolvedEntity>> {
  const out = new Map<string, ResolvedEntity>();
  if (!slugs.length) return out;
  const { rows } = await query<{ slug: string; id: string; name: string }>(
    `SELECT slug, id::text AS id, name FROM ${ENTITY_TABLE[kind]} WHERE slug = ANY($1) OR id::text = ANY($1)`,
    [slugs],
  );
  for (const r of rows) {
    const e = { kind, slug: r.slug, name: r.name, href: `${ENTITY_PATH[kind]}/${r.slug}` };
    out.set(r.slug, e);
    out.set(r.id, e);
  }
  return out;
}

// ─── Job picker search ───────────────────────────────────────────────────────

export interface JobPick {
  kind: FolderEntityKind;
  slug: string;
  name: string;
  /** One-line context under the name: stage / client / trade. */
  sub: string | null;
  /** Still in play (a live project stage, an open lead). Ranked first. */
  current: boolean;
  /** The folder already bound to this job, if any. */
  folderId: string | null;
  folderName: string | null;
}

/** Jobs for the rail's link / new-folder picker. Empty query = the current
 *  jobs, most recently touched first; otherwise a case-insensitive match on
 *  name, client, or address, with prefix hits and current jobs ranked up. */
export async function searchFolderEntities(q: string, limit = 12): Promise<JobPick[]> {
  const term = q.replace(/\s+/g, " ").trim().slice(0, 80);
  const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await query<{
    kind: FolderEntityKind;
    slug: string;
    name: string;
    sub: string | null;
    current: boolean;
    folder_id: string | null;
    folder_name: string | null;
  }>(
    `WITH jobs AS (
       SELECT 'project'::text AS kind, slug, name,
              NULLIF(concat_ws(' · ', CASE WHEN client_name IS DISTINCT FROM name THEN NULLIF(client_name, '') END, replace(status, '_', ' ')), '') AS sub,
              status NOT IN ('warranty') AS current,
              coalesce(updated_at, created_at) AS touched,
              concat_ws(' ', name, client_name, address) AS hay
         FROM projects
       UNION ALL
       SELECT 'lead', slug, name,
              NULLIF(concat_ws(' · ', NULLIF(scope_city, ''), replace(stage, '_', ' ')), ''),
              stage <> 'lost',
              coalesce(last_contact_at, updated_at, created_at),
              concat_ws(' ', name, address, scope_city, email)
         FROM leads
       UNION ALL
       SELECT 'vendor', slug, name, NULLIF(trade, ''), true, coalesce(updated_at, created_at), concat_ws(' ', name, trade)
         FROM vendors
       UNION ALL
       SELECT 'sub', slug, name, NULLIF(trade, ''), true, coalesce(updated_at, created_at), concat_ws(' ', name, trade)
         FROM subs
     )
     SELECT j.kind, j.slug, j.name, j.sub, j.current, f.id AS folder_id,
            CASE WHEN f.id IS NULL THEN NULL ELSE NULLIF(f.name, '') END AS folder_name
       FROM jobs j
       LEFT JOIN ai_folders f ON f.entity_kind = j.kind AND f.entity_id = j.slug
      WHERE $1::text IS NULL OR j.hay ILIKE $1
      ORDER BY
        (j.name ILIKE $2) DESC,          -- name starts with the term
        j.current DESC,
        (j.kind IN ('project','lead')) DESC,
        j.touched DESC NULLS LAST
      LIMIT $3`,
    [like, term ? `${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : "", limit],
  );
  return rows.map((r) => ({
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    sub: r.sub,
    current: r.current,
    folderId: r.folder_id,
    folderName: r.folder_name,
  }));
}

// ─── Folders ─────────────────────────────────────────────────────────────────

interface FolderRow {
  id: string;
  name: string;
  entity_kind: FolderEntityKind | null;
  entity_id: string | null;
  collapsed: boolean;
  sort_key: string | null;
  archived_at: string | null;
}

const FOLDER_COLS = `id, name, entity_kind, entity_id, collapsed, sort_key, archived_at::text AS archived_at`;

/** Folder rows with bound-entity names/pages filled in. */
async function hydrateFolders(rows: FolderRow[]): Promise<RailFolder[]> {
  const byKind: Record<FolderEntityKind, string[]> = { project: [], lead: [], vendor: [], sub: [] };
  for (const r of rows) if (r.entity_kind && r.entity_id) byKind[r.entity_kind].push(r.entity_id);
  const resolved = new Map<FolderEntityKind, Map<string, ResolvedEntity>>();
  for (const kind of Object.keys(byKind) as FolderEntityKind[]) {
    if (byKind[kind].length) resolved.set(kind, await resolveMany(kind, byKind[kind]));
  }
  return rows.map((r) => {
    const e = r.entity_kind && r.entity_id ? resolved.get(r.entity_kind)?.get(r.entity_id) : undefined;
    return {
      id: r.id,
      name: r.name.trim() || e?.name || (r.entity_id ? r.entity_id : "Untitled folder"),
      entityKind: r.entity_kind,
      entityId: r.entity_id,
      entityHref: e?.href ?? null,
      collapsed: r.collapsed,
      archivedAt: r.archived_at,
      sortKey: r.sort_key,
    };
  });
}

export async function listFolders(): Promise<RailFolder[]> {
  const { rows } = await query<FolderRow>(`SELECT ${FOLDER_COLS} FROM ai_folders ORDER BY created_at ASC`);
  return hydrateFolders(rows);
}

export async function getFolder(id: string): Promise<RailFolder | null> {
  const row = await queryOne<FolderRow>(`SELECT ${FOLDER_COLS} FROM ai_folders WHERE id = $1`, [id]);
  return row ? (await hydrateFolders([row]))[0] : null;
}

export async function createFolder(name: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO ai_folders (name) VALUES ($1) RETURNING id`,
    [name.replace(/\s+/g, " ").trim().slice(0, 80) || "New folder"],
  );
  return row!.id;
}

/** The folder bound to an entity, created on first use. Returns null when the
 *  entity doesn't resolve (a stale slug in a route). */
export async function ensureFolderForEntity(ref: FolderEntityRef): Promise<string | null> {
  const e = await resolveEntity(ref);
  if (!e) return null;
  // Insert-or-select on the partial unique index; a concurrent first-use from
  // two tabs converges on one row.
  await query(
    `INSERT INTO ai_folders (name, entity_kind, entity_id) VALUES ('', $1, $2)
     ON CONFLICT (entity_kind, entity_id) WHERE entity_id IS NOT NULL DO NOTHING`,
    [e.kind, e.slug],
  );
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ai_folders WHERE entity_kind = $1 AND entity_id = $2`,
    [e.kind, e.slug],
  );
  if (!row) return null;
  // An archived job folder that gets a new thread comes back into the rail.
  await query(`UPDATE ai_folders SET archived_at = NULL, updated_at = now() WHERE id = $1 AND archived_at IS NOT NULL`, [row.id]);
  return row.id;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await query(`UPDATE ai_folders SET name = $2, updated_at = now() WHERE id = $1`, [
    id,
    name.replace(/\s+/g, " ").trim().slice(0, 80),
  ]);
}

/** Bind (or unbind with null) a folder to an entity. Fails when another
 *  folder already owns that entity — the caller offers a merge instead. */
export async function bindFolder(
  id: string,
  ref: FolderEntityRef | null,
): Promise<{ ok: true } | { ok: false; error: string; existingFolderId?: string }> {
  if (!ref) {
    await query(`UPDATE ai_folders SET entity_kind = NULL, entity_id = NULL, updated_at = now() WHERE id = $1`, [id]);
    return { ok: true };
  }
  const e = await resolveEntity(ref);
  if (!e) return { ok: false, error: "That job could not be found." };
  const other = await queryOne<{ id: string }>(
    `SELECT id FROM ai_folders WHERE entity_kind = $1 AND entity_id = $2 AND id <> $3`,
    [e.kind, e.slug, id],
  );
  if (other) return { ok: false, error: `Another folder is already linked to ${e.name}.`, existingFolderId: other.id };
  await query(`UPDATE ai_folders SET entity_kind = $2, entity_id = $3, updated_at = now() WHERE id = $1`, [id, e.kind, e.slug]);
  return { ok: true };
}

/** Persist a manual order: every listed folder gets a zero-padded sort_key
 *  in one statement (a handful of rows, so no fractional indexing). */
export async function reorderFolders(ids: string[]): Promise<void> {
  const keys = sortKeysFor(ids);
  if (!keys.length) return;
  await query(
    `UPDATE ai_folders f SET sort_key = k.sort_key, updated_at = now()
       FROM unnest($1::uuid[], $2::text[]) AS k(id, sort_key)
      WHERE f.id = k.id`,
    [keys.map((k) => k.id), keys.map((k) => k.sortKey)],
  );
}

export async function setFolderCollapsed(id: string, collapsed: boolean): Promise<void> {
  await query(`UPDATE ai_folders SET collapsed = $2, updated_at = now() WHERE id = $1`, [id, collapsed]);
}

/** Archive hides the folder and everything in it from the rail (threads keep
 *  their own state and come back with the folder). Refused while any thread
 *  inside is working — same rule as archiving one thread. */
export async function setFolderArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (archived) {
    const busy = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM dev_agent_runs r JOIN ai_conversations c ON c.id = r.conversation_id
        WHERE c.folder_id = $1 AND r.status IN ('pending','running')`,
      [id],
    );
    if (Number(busy?.n ?? 0) > 0) return { ok: false, error: "A thread in this folder is still working." };
  }
  await query(`UPDATE ai_folders SET archived_at = $2, updated_at = now() WHERE id = $1`, [
    id,
    archived ? new Date().toISOString() : null,
  ]);
  return { ok: true };
}

/** Delete the folder; its threads become Unfiled (FK ON DELETE SET NULL). */
export async function deleteFolder(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const busy = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM dev_agent_runs r JOIN ai_conversations c ON c.id = r.conversation_id
      WHERE c.folder_id = $1 AND r.status IN ('pending','running')`,
    [id],
  );
  if (Number(busy?.n ?? 0) > 0) return { ok: false, error: "A thread in this folder is still working." };
  await query(`DELETE FROM ai_folders WHERE id = $1`, [id]);
  return { ok: true };
}

// ─── Threads: rail query ─────────────────────────────────────────────────────

interface ThreadRow {
  id: string;
  agent: PanelAgent;
  title: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  last_activity_at: string | null;
  unsettled_at: string | null;
  settled_override: "settled" | "active" | null;
  settled_at: string | null;
  archived_at: string | null;
  pinned_at: string | null;
  pin_order_key: string | null;
  needs_approval: boolean;
  needs_input: boolean;
  working: boolean;
  working_since: string | null;
  last_run_id: string | null;
  last_run_status: RailThread["lastRunStatus"];
  last_run_ended_at: string | null;
  sugg_kind: string | null;
  sugg_id: string | null;
  sugg_n: string | null;
}

const THREAD_SELECT = `
  SELECT c.id, c.agent, c.title, c.folder_id,
         c.created_at::text AS created_at, c.updated_at::text AS updated_at,
         c.last_activity_at::text AS last_activity_at, c.unsettled_at::text AS unsettled_at,
         c.settled_override, c.settled_at::text AS settled_at, c.archived_at::text AS archived_at,
         c.pinned_at::text AS pinned_at, c.pin_order_key,
         EXISTS (SELECT 1 FROM owner_grants g
                  WHERE g.conversation_id = c.id AND g.status = 'requested'
                    AND g.expires_at > now())                                     AS needs_approval,
         EXISTS (SELECT 1 FROM agent_interactions i
                  WHERE i.conversation_id = c.id AND i.status = 'pending')        AS needs_input,
         EXISTS (SELECT 1 FROM dev_agent_runs r
                  WHERE r.conversation_id = c.id AND r.status IN ('pending','running')) AS working,
         (SELECT min(r.created_at)::text FROM dev_agent_runs r
           WHERE r.conversation_id = c.id AND r.status IN ('pending','running'))  AS working_since,
         lr.id AS last_run_id, lr.status AS last_run_status, lr.updated_at::text AS last_run_ended_at,
         s.kind AS sugg_kind, s.id AS sugg_id, s.n::text AS sugg_n
    FROM ai_conversations c
    LEFT JOIN LATERAL (
      SELECT r.id, r.status, r.updated_at FROM dev_agent_runs r
       WHERE r.conversation_id = c.id ORDER BY r.created_at DESC LIMIT 1
    ) lr ON true
    LEFT JOIN LATERAL (
      SELECT min(x.k) AS kind, min(x.entity_id) AS id, count(DISTINCT (x.k, x.entity_id)) AS n
        FROM (SELECT CASE WHEN e.entity_kind LIKE 'project\\_%' THEN 'project' ELSE e.entity_kind END AS k,
                     e.entity_id
                FROM run_effects e JOIN dev_agent_runs r ON r.id = e.run_id
               WHERE r.conversation_id = c.id AND e.entity_id IS NOT NULL
                 AND (e.entity_kind IN ('project','lead','vendor','sub') OR e.entity_kind LIKE 'project\\_%')) x
    ) s ON c.folder_id IS NULL AND c.archived_at IS NULL`;

async function hydrateThreads(rows: ThreadRow[]): Promise<RailThread[]> {
  // Resolve "file under …?" suggestions (unfiled threads whose runs touched
  // exactly one job) to names, batched per kind.
  const want: Record<FolderEntityKind, string[]> = { project: [], lead: [], vendor: [], sub: [] };
  for (const r of rows) {
    if (r.sugg_kind && r.sugg_id && r.sugg_n === "1" && isEntityKind(r.sugg_kind)) want[r.sugg_kind].push(r.sugg_id);
  }
  const resolved = new Map<FolderEntityKind, Map<string, ResolvedEntity>>();
  for (const kind of Object.keys(want) as FolderEntityKind[]) {
    if (want[kind].length) resolved.set(kind, await resolveMany(kind, want[kind]));
  }
  return rows.map((r) => {
    const e =
      r.sugg_kind && r.sugg_id && r.sugg_n === "1" && isEntityKind(r.sugg_kind)
        ? resolved.get(r.sugg_kind)?.get(r.sugg_id)
        : undefined;
    return {
      id: r.id,
      agent: r.agent,
      title: r.title,
      folderId: r.folder_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastActivityAt: r.last_activity_at,
      unsettledAt: r.unsettled_at,
      settledOverride: r.settled_override,
      settledAt: r.settled_at,
      archivedAt: r.archived_at,
      pinnedAt: r.pinned_at,
      pinOrderKey: r.pin_order_key,
      needsApproval: r.needs_approval,
      needsInput: r.needs_input,
      working: r.working,
      workingSince: r.working_since,
      lastRunId: r.last_run_id,
      lastRunStatus: r.last_run_status,
      lastRunEndedAt: r.last_run_ended_at,
      suggestedFolder: e ? { kind: e.kind, id: e.slug, name: e.name } : null,
    };
  });
}

export interface ThreadRail {
  folders: RailFolder[];
  threads: RailThread[];
}

/** Everything the rail shows: all folders (archived ones too, flagged) and
 *  every non-archived thread with its status inputs. Unpaginated like T3 —
 *  one operator, a few hundred threads at most. */
export async function listThreadRail(): Promise<ThreadRail> {
  const [folders, { rows }] = await Promise.all([
    listFolders(),
    query<ThreadRow>(`${THREAD_SELECT} WHERE c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 500`),
  ]);
  return { folders, threads: await hydrateThreads(rows) };
}

/** Archived threads (their own or via an archived folder), newest-archived
 *  first — the "Show archived" list. */
export async function listArchivedThreads(): Promise<RailThread[]> {
  const { rows } = await query<ThreadRow>(
    `${THREAD_SELECT}
      LEFT JOIN ai_folders f ON f.id = c.folder_id
      WHERE c.archived_at IS NOT NULL OR f.archived_at IS NOT NULL
      ORDER BY COALESCE(c.archived_at, f.archived_at) DESC LIMIT 200`,
  );
  return hydrateThreads(rows);
}

// ─── Threads: lifecycle mutations ────────────────────────────────────────────

async function threadBusy(id: string): Promise<{ working: boolean; blocked: boolean }> {
  const row = await queryOne<{ working: boolean; blocked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM dev_agent_runs r WHERE r.conversation_id = $1 AND r.status IN ('pending','running')) AS working,
            (EXISTS (SELECT 1 FROM owner_grants g WHERE g.conversation_id = $1 AND g.status = 'requested' AND g.expires_at > now())
             OR EXISTS (SELECT 1 FROM agent_interactions i WHERE i.conversation_id = $1 AND i.status = 'pending')) AS blocked`,
    [id],
  );
  return row ?? { working: false, blocked: false };
}

/** "I'm done with this": into the Settled shelf, unpinned. Refused while a
 *  run is live or the agent is waiting on Joe. */
export async function settleThread(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const b = await threadBusy(id);
  if (b.working) return { ok: false, error: "Still working — stop the run or let it finish first." };
  if (b.blocked) return { ok: false, error: "The agent is waiting on you — answer it first." };
  await query(
    `UPDATE ai_conversations
        SET settled_override = 'settled',
            settled_at = COALESCE(last_activity_at, updated_at),
            pinned_at = NULL, pin_order_key = NULL,
            snoozed_until = NULL, snoozed_at = NULL
      WHERE id = $1`,
    [id],
  );
  return { ok: true };
}

/** Explicit "keep active": the override that auto-settle respects. */
export async function unsettleThread(id: string): Promise<void> {
  await query(
    `UPDATE ai_conversations
        SET settled_override = 'active', settled_at = NULL, unsettled_at = now()
      WHERE id = $1`,
    [id],
  );
}

/** A new user message is real activity: it clears ANY override (settled or
 *  keep-active) and re-anchors the thread only if it was actually parked. */
export async function touchThreadActivity(id: string): Promise<void> {
  await query(
    `UPDATE ai_conversations
        SET unsettled_at = CASE WHEN settled_override IS NOT NULL OR snoozed_until IS NOT NULL THEN now() ELSE unsettled_at END,
            settled_override = NULL, settled_at = NULL,
            snoozed_until = NULL, snoozed_at = NULL,
            last_activity_at = now()
      WHERE id = $1`,
    [id],
  );
}

export async function setThreadPinned(id: string, pinned: boolean): Promise<void> {
  if (pinned) {
    // Pinning is "this matters now": an unsettle rides along like T3.
    await query(
      `UPDATE ai_conversations
          SET pinned_at = now(),
              settled_override = CASE WHEN settled_override = 'settled' THEN 'active' ELSE settled_override END,
              settled_at = NULL,
              unsettled_at = CASE WHEN settled_override = 'settled' THEN now() ELSE unsettled_at END
        WHERE id = $1`,
      [id],
    );
  } else {
    await query(`UPDATE ai_conversations SET pinned_at = NULL, pin_order_key = NULL WHERE id = $1`, [id]);
  }
}

/** Archive hides; refused while working. Keeps the legacy boolean in step so
 *  any not-yet-migrated reader sees the same answer. */
export async function setThreadArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (archived) {
    const b = await threadBusy(id);
    if (b.working) return { ok: false, error: "Still working — stop the run or let it finish first." };
  }
  await query(
    `UPDATE ai_conversations
        SET archived = $2, archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
      WHERE id = $1`,
    [id, archived],
  );
  return { ok: true };
}

export async function moveThread(id: string, folderId: string | null): Promise<void> {
  await query(`UPDATE ai_conversations SET folder_id = $2 WHERE id = $1`, [id, folderId]);
}

/** File a thread under an entity's folder (created on first use). */
export async function fileThreadUnderEntity(id: string, ref: FolderEntityRef): Promise<string | null> {
  const folderId = await ensureFolderForEntity(ref);
  if (folderId) await moveThread(id, folderId);
  return folderId;
}

// ─── Auto-settle sweep ───────────────────────────────────────────────────────

export const AUTO_SETTLE_SETTING = "panel.autoSettleAfterDays";
const AUTO_SETTLE_DEFAULT_DAYS = 3;
const SWEEP_MIN_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

/** Days of quiet before a neutral thread settles itself; null = off. */
export async function getAutoSettleDays(): Promise<number | null> {
  const row = await queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [AUTO_SETTLE_SETTING]);
  if (!row) return AUTO_SETTLE_DEFAULT_DAYS;
  const v = row.value.trim();
  if (v === "" || v === "off" || v === "null") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : AUTO_SETTLE_DEFAULT_DAYS;
}

/**
 * T3's staleness rule: a thread with no override, nothing live, nothing
 * waiting on Joe, and no activity for N days settles itself, stamped with
 * when the work ended (not when the sweep ran). Called on every poll
 * (throttled in-process to once a minute) and from the agent-retries cron so
 * it also runs when nobody has the panel open.
 */
export async function autoSettleQuietThreads(opts: { force?: boolean } = {}): Promise<{ settled: number }> {
  const now = Date.now();
  if (!opts.force && now - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return { settled: 0 };
  lastSweepAt = now;
  const days = await getAutoSettleDays();
  if (days == null) return { settled: 0 };
  const { rowCount } = await query(
    `UPDATE ai_conversations c
        SET settled_override = 'settled',
            settled_at = COALESCE(c.last_activity_at, c.updated_at),
            pinned_at = NULL, pin_order_key = NULL
      WHERE c.archived_at IS NULL
        AND c.settled_override IS NULL
        AND c.pinned_at IS NULL
        AND COALESCE(c.last_activity_at, c.updated_at) < now() - ($1::numeric * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM dev_agent_runs r WHERE r.conversation_id = c.id AND r.status IN ('pending','running'))
        AND NOT EXISTS (SELECT 1 FROM owner_grants g WHERE g.conversation_id = c.id AND g.status = 'requested' AND g.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM agent_interactions i WHERE i.conversation_id = c.id AND i.status = 'pending')`,
    [days],
  );
  return { settled: rowCount ?? 0 };
}

// ─── Agent context ───────────────────────────────────────────────────────────

/** One line for the agent's page-context block naming the job this thread is
 *  filed under, or null when unfiled. */
export async function folderContextLine(conversationId: string): Promise<string | null> {
  const row = await queryOne<FolderRow>(
    `SELECT f.id, f.name, f.entity_kind, f.entity_id, f.collapsed, f.sort_key, f.archived_at::text AS archived_at
       FROM ai_folders f JOIN ai_conversations c ON c.folder_id = f.id WHERE c.id = $1`,
    [conversationId],
  );
  if (!row) return null;
  const [f] = await hydrateFolders([row]);
  if (f.entityKind && f.entityId) {
    return `This conversation is filed under the ${f.entityKind} "${f.name}" (${f.entityKind} slug: ${f.entityId}). Assume questions are about it unless told otherwise.`;
  }
  return `This conversation is filed under the folder "${f.name}".`;
}
