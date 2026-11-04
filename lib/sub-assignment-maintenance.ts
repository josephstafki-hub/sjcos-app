import type { Run } from "./commands/core.ts";
/** Caller must wrap in a transaction; snapshot survives reload and preserves dates. */
export async function removeAssignment(
  run: Run,
  projectId: string,
  subSlug: string,
) {
  const [a] = await run(
    `SELECT * FROM project_subs WHERE project_id=$1 AND sub_slug=$2 FOR UPDATE`,
    [projectId, subSlug],
  );
  if (!a)
    return { ok: false, error: "This sub is no longer assigned to the job." };
  await run(
    `INSERT INTO sub_assignment_trash(project_id,sub_slug,row) VALUES($1,$2,$3::jsonb) ON CONFLICT(project_id,sub_slug) DO UPDATE SET row=EXCLUDED.row,removed_at=now()`,
    [projectId, subSlug, JSON.stringify(a)],
  );
  await run(`DELETE FROM project_subs WHERE project_id=$1 AND sub_slug=$2`, [
    projectId,
    subSlug,
  ]);
  await run(
    `UPDATE sub_portal_invites SET status='dismissed' WHERE project_id=$1 AND sub_slug=$2 AND status='queued'`,
    [projectId, subSlug],
  );
  return { ok: true };
}
export async function restoreAssignment(
  run: Run,
  projectId: string,
  subSlug: string,
) {
  const [old] = await run(
    `SELECT 1 FROM sub_assignment_trash WHERE project_id=$1 AND sub_slug=$2 FOR UPDATE`,
    [projectId, subSlug],
  );
  if (!old) return { ok: false, error: "No removed assignment to restore." };
  const [live] = await run(
    `SELECT 1 FROM project_subs WHERE project_id=$1 AND sub_slug=$2`,
    [projectId, subSlug],
  );
  if (live)
    return {
      ok: false,
      error:
        "This sub is already assigned. Remove that assignment before restoring this one.",
    };
  await run(
    `INSERT INTO project_subs SELECT (jsonb_populate_record(NULL::project_subs,row)).* FROM sub_assignment_trash WHERE project_id=$1 AND sub_slug=$2`,
    [projectId, subSlug],
  );
  await run(
    `DELETE FROM sub_assignment_trash WHERE project_id=$1 AND sub_slug=$2`,
    [projectId, subSlug],
  );
  return { ok: true };
}
