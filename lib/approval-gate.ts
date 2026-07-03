import "server-only";

// Pre-con approval gate read layer. Computes the design + selections legs of the
// gate for a project (the estimate leg is checked per-estimate at contract time
// / in the client component). Reuses existing mechanisms: the design sign-off is
// a signed `doc_type='design'` e-sign request; the selections sign-off is the
// project's selection-approval flow (all decided, none pending, ≥1 approved).

import { queryOne } from "./db";
import type { ApprovalGateBase } from "./approval-gate-types";

export async function getApprovalGate(slug: string): Promise<ApprovalGateBase> {
  const design = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM signature_requests sr JOIN projects p ON p.id = sr.project_id
      WHERE p.slug = $1 AND sr.doc_type = 'design' AND sr.status = 'signed'`,
    [slug],
  );
  const designOk = (design?.n ?? 0) > 0;

  const sel = await queryOne<{ total: number; pending: number; approved: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ps.status = 'pending')::int  AS pending,
            count(*) FILTER (WHERE ps.status = 'approved')::int AS approved
       FROM project_selections ps JOIN projects p ON p.id = ps.project_id
      WHERE p.slug = $1 AND ps.status <> 'draft'`,
    [slug],
  );
  const total = sel?.total ?? 0;
  const pending = sel?.pending ?? 0;
  const approved = sel?.approved ?? 0;
  const selectionsOk = total > 0 && pending === 0 && approved > 0;

  return {
    design: designOk,
    designDetail: designOk
      ? "Design/prints e-signed"
      : "Send the design/prints for e-signature and get them signed",
    selections: selectionsOk,
    selectionsDetail: selectionsOk
      ? `${approved} selection${approved === 1 ? "" : "s"} approved`
      : total === 0
        ? "No selections sent to the client yet"
        : `${pending} selection${pending === 1 ? "" : "s"} still awaiting client approval`,
  };
}
