// Soft delete for project files (db/migrations/0032_project_uploads.sql).
//
// Deleting a file moves its files row, whole, into file_trash for 30 days and
// leaves the blob on disk, so Restore puts back exactly what was there (same
// id, same links). A file anything still points at (a bid packet, a signature
// request, a document draft…) is refused instead: deleting the row would
// cascade or null those links, and a restore could not bring them back.
//
// Used by mcp/upload-tools.mjs (delete_project_file / restore_project_file)
// and the Files tab's Restore button (lib/actions/files.ts). No "@/" imports:
// the MCP server loads this file directly with node.

import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { Run } from "./commands/core.ts";
import { recordWorkflowEvent } from "./workflow/engine.ts";

export const TRASH_DAYS = 30;

/** Links that don't stop a delete: the upload that made the file. */
const IGNORED_REFS = new Set(["project_uploads.file_id"]);

/** Every table.column that still points at this file. */
export async function fileReferences(run: Run, fileId: string): Promise<string[]> {
  const fks = await run<{ tbl: string; col: string }>(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'files'::regclass`,
  );
  const out: string[] = [];
  for (const { tbl, col } of fks) {
    const ref = `${tbl}.${col}`;
    if (IGNORED_REFS.has(ref)) continue;
    // Identifiers come from the catalog, not the caller; quote them anyway.
    const q = (s: string) => s.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");
    const hit = await run(`SELECT 1 FROM ${q(tbl)} WHERE ${q(col)} = $1 LIMIT 1`, [fileId]);
    if (hit.length) out.push(ref);
  }
  return out;
}

export interface TrashedFile {
  file_id: string;
  project_slug: string;
  name: string;
  reason: string;
  deleted_by: string;
  deleted_at: string;
  purge_after: string;
}

const TRASH_COLS = `file_id, project_slug, name, reason, deleted_by,
  to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at,
  to_char(purge_after AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS purge_after`;

async function projectIdOf(run: Run, slug: string): Promise<string | null> {
  const [p] = await run<{ id: string }>(`SELECT id FROM projects WHERE slug = $1`, [slug]);
  return p?.id ?? null;
}

/** Move a project file to the trash. Caller decides who may; run inside one
 *  transaction so the trash row and the delete land together. */
export async function trashProjectFile(
  run: Run,
  input: { projectSlug: string; fileId: string; reason: string; deletedBy: string },
): Promise<{ ok: true; trashed: TrashedFile } | { ok: false; error: string }> {
  const [f] = await run<{ id: string; name: string }>(
    `SELECT id, name FROM files WHERE id = $1 AND project_key = $2 AND storage_path IS NOT NULL FOR UPDATE`,
    [input.fileId, input.projectSlug],
  );
  if (!f) return { ok: false, error: `No file ${input.fileId} on project ${input.projectSlug}. Use list_project_files for ids.` };
  const refs = await fileReferences(run, f.id);
  if (refs.length)
    return {
      ok: false,
      error: `'${f.name}' is still used by ${refs.join(", ")}; remove it there first (e.g. remove_bid_file). Nothing was deleted.`,
    };
  const [trashed] = await run<TrashedFile>(
    `INSERT INTO file_trash (file_id, project_slug, name, row, reason, deleted_by, purge_after)
     SELECT f.id, $2, f.name, to_jsonb(f), $3, $4, now() + make_interval(days => $5)
       FROM files f WHERE f.id = $1
     ON CONFLICT (file_id) DO UPDATE
       SET project_slug = EXCLUDED.project_slug, name = EXCLUDED.name, row = EXCLUDED.row,
           reason = EXCLUDED.reason, deleted_by = EXCLUDED.deleted_by,
           deleted_at = now(), purge_after = EXCLUDED.purge_after
     RETURNING ${TRASH_COLS}`,
    [f.id, input.projectSlug, input.reason, input.deletedBy, TRASH_DAYS],
  );
  await run(`DELETE FROM files WHERE id = $1`, [f.id]);
  const projectId = await projectIdOf(run, input.projectSlug);
  if (projectId)
    await recordWorkflowEvent(run, {
      projectId,
      kind: "file_deleted",
      ref: `file:${f.id}:${trashed.deleted_at}`,
      detail: { file_id: f.id, name: f.name, reason: input.reason },
      actor: input.deletedBy,
    });
  return { ok: true, trashed };
}

/** Put a trashed file back, same id. Refused while a live file on the project
 *  has the same name (one current copy per name). */
export async function restoreProjectFile(
  run: Run,
  input: { fileId: string; restoredBy: string },
): Promise<{ ok: true; file_id: string; name: string; project_slug: string } | { ok: false; error: string }> {
  const [t] = await run<{ file_id: string; project_slug: string; name: string }>(
    `SELECT file_id, project_slug, name FROM file_trash WHERE file_id = $1 FOR UPDATE`,
    [input.fileId],
  );
  if (!t) return { ok: false, error: `No deleted file ${input.fileId} (restores last ${TRASH_DAYS} days).` };
  const [clash] = await run<{ id: string }>(
    `SELECT id FROM files WHERE project_key = $1 AND name = $2 AND storage_path IS NOT NULL LIMIT 1`,
    [t.project_slug, t.name],
  );
  if (clash)
    return { ok: false, error: `A newer '${t.name}' (${clash.id}) is on the project; delete that one first to restore this copy.` };
  await run(
    `INSERT INTO files SELECT (jsonb_populate_record(NULL::files, row)).* FROM file_trash WHERE file_id = $1`,
    [t.file_id],
  );
  await run(`DELETE FROM file_trash WHERE file_id = $1`, [t.file_id]);
  const projectId = await projectIdOf(run, t.project_slug);
  if (projectId)
    await recordWorkflowEvent(run, {
      projectId,
      kind: "file_restored",
      ref: `file:${t.file_id}:${new Date().toISOString()}`,
      detail: { file_id: t.file_id, name: t.name },
      actor: input.restoredBy,
    });
  return { ok: true, file_id: t.file_id, name: t.name, project_slug: t.project_slug };
}

export async function listFileTrash(run: Run, projectSlug: string): Promise<TrashedFile[]> {
  return run<TrashedFile>(
    `SELECT ${TRASH_COLS} FROM file_trash WHERE project_slug = $1 AND purge_after > now() ORDER BY deleted_at DESC`,
    [projectSlug],
  );
}

/** Drop trash past its 30 days, blobs (and cached thumbnails) included. */
export async function purgeFileTrash(run: Run, uploadDir: string): Promise<number> {
  const gone = await run<{ file_id: string; storage_path: string | null }>(
    `DELETE FROM file_trash WHERE purge_after <= now() RETURNING file_id, row->>'storage_path' AS storage_path`,
  );
  for (const g of gone) {
    if (!g.storage_path) continue;
    // A restored-then-replaced file could share the blob name; never unlink a live one.
    const live = await run(`SELECT 1 FROM files WHERE storage_path = $1 LIMIT 1`, [g.storage_path]);
    if (live.length) continue;
    await unlink(path.join(uploadDir, path.basename(g.storage_path))).catch(() => {});
    await clearThumbnails(uploadDir, g.file_id);
  }
  return gone.length;
}

/** Remove a file's cached thumbnails (lib/file-serve.ts keys them by id), so
 *  replaced bytes don't keep showing the old picture. */
export async function clearThumbnails(uploadDir: string, fileId: string): Promise<void> {
  const dir = path.join(uploadDir, ".thumbs");
  const prefix = `${path.basename(fileId)}__w`;
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => unlink(path.join(dir, n)).catch(() => {})));
}
