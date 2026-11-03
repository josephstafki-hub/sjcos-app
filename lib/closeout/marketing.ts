// Marketing photo rights (A17): a job photo may go in a post only once Joe has
// recorded that the client OK'd sharing it (publication_rights present and not
// withdrawn; portal visibility is not a right). /marketing offers only those
// photos for download next to the post text. Joe posts by hand: there is no
// posting agent (removed 2026-11-03) and nothing here sends anything.
// Newsletter drip arming stays owner-only: no code path here touches it.
//
// What the drafting model is allowed to say about a job comes from
// loadJobFacts (the signed estimate and approved change orders), never from
// the job's name or address.

import type { Run } from "../commands/core.ts";
import { isOwner, type Principal } from "../commands/principal.ts";
import { cityFromAddress, type JobFacts } from "../marketing-copy.ts";

export async function grantPublicationRights(run: Run, input: { fileIds: string[]; projectId: string | null; grantedBy: string; grantedByUserId?: string | null; scope?: string[]; note?: string }): Promise<number> {
  let n = 0;
  for (const fileId of input.fileIds) {
    const [live] = await run(`SELECT 1 FROM publication_rights WHERE file_id = $1 AND withdrawn_at IS NULL`, [fileId]);
    if (live) continue;
    await run(`INSERT INTO publication_rights (file_id, project_id, granted_by, granted_by_user_id, scope, note) VALUES ($1, $2, $3, $4, $5::text[], $6)`, [
      fileId,
      input.projectId,
      input.grantedBy,
      input.grantedByUserId ?? null,
      input.scope ?? ["social", "website"],
      input.note ?? "",
    ]);
    n++;
  }
  return n;
}

/** Files on a project the company may publish right now. */
export async function authorizedPhotos(run: Run, projectId: string, scope = "social"): Promise<string[]> {
  const rows = await run<{ file_id: string }>(
    `SELECT DISTINCT r.file_id FROM publication_rights r JOIN files f ON f.id = r.file_id
      WHERE r.project_id = $1 AND r.withdrawn_at IS NULL AND $2 = ANY(r.scope) AND f.type = 'img'`,
    [projectId, scope],
  );
  return rows.map((r) => r.file_id);
}

export interface MarketingDraftRow {
  id: number;
  project_id: string | null;
  kind: string;
  title: string;
  body: string;
  status: string;
}

export async function getDraft(run: Run, id: number): Promise<MarketingDraftRow | null> {
  const [row] = await run<MarketingDraftRow>(`SELECT d.id, d.project_id, d.kind, d.title, d.body, d.status FROM marketing_drafts d WHERE d.id = $1`, [id]);
  return row ? { ...row, id: Number(row.id) } : null;
}

/** Joe takes back the client's OK on a photo. Owner only: it records the
 *  client's permission. */
export async function withdrawPublicationRights(run: Run, principal: Principal, fileId: string, reason: string): Promise<{ withdrawn: number }> {
  if (!isOwner(principal)) throw new Error("Only the owner withdraws publication rights.");
  const rows = await run(`UPDATE publication_rights SET withdrawn_at = now(), withdrawn_reason = $2 WHERE file_id = $1 AND withdrawn_at IS NULL RETURNING id`, [fileId, reason]);
  return { withdrawn: rows.length };
}

/** The job's own record of the work: the work's name, the city (never the
 *  street), and the lines of the estimate the client agreed to plus approved
 *  pre-con changes and change orders. Prices, client names and addresses are
 *  left out on purpose: the model only ever sees what a post may say.
 *  Estimate choice: approved formal (newest) → newest sent formal → none
 *  (a draft estimate is a plan, not work done). */
export async function loadJobFacts(run: Run, projectId: string): Promise<JobFacts | null> {
  const [proj] = await run<{ name: string; client_name: string; address: string | null; sub_label: string | null; lead_scope: string | null; lead_city: string | null }>(
    `SELECT p.name, p.client_name, p.address, p.sub_label, l.scope AS lead_scope, l.scope_city AS lead_city
       FROM projects p LEFT JOIN leads l ON l.id = p.lead_id WHERE p.id = $1`,
    [projectId],
  );
  if (!proj) return null;
  const [est] = await run<{ id: string; title: string }>(
    `SELECT id, title FROM estimates
      WHERE project_id = $1 AND kind = 'formal' AND status IN ('approved','sent')
      ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1`,
    [projectId],
  );
  const lines = await run<{ section: string; description: string }>(
    `SELECT el.section, el.description FROM estimate_lines el JOIN estimates e ON e.id = el.estimate_id
      WHERE el.superseded_by IS NULL AND btrim(el.description) <> ''
        AND (e.id = $2 OR (e.project_id = $1 AND e.kind = 'precon_change' AND e.status = 'approved'))
      ORDER BY (e.id = $2) DESC, e.created_at, el.sort_order, el.id
      LIMIT 60`,
    [projectId, est?.id ?? null],
  );
  const changes = await run<{ title: string; description: string }>(
    `SELECT title, description FROM change_orders WHERE project_id = $1 AND status = 'approved' ORDER BY created_at LIMIT 20`,
    [projectId],
  );
  const scope = [proj.sub_label, proj.lead_scope].map((s) => (s ?? "").trim()).filter(Boolean);
  return {
    work: (est?.title ?? "").trim() || scope[0] || "",
    city: (proj.lead_city ?? "").trim() || cityFromAddress(proj.address),
    scope,
    lines: lines.map((l) => ({ section: l.section.trim(), text: l.description.trim() })),
    changes: changes.map((c) => [c.title, c.description].map((s) => s.trim()).filter(Boolean).join(": ")).filter(Boolean),
    privateWords: [proj.client_name, proj.name, proj.address ?? ""].filter(Boolean),
  };
}
