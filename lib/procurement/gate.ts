// Construction gate (DECISIONS "Construction gate", WORKFLOW W09): a signed
// construction agreement AND the construction deposit paid before material
// orders or awards are placed. The deposit is lib/workflow/deposit.ts's: the
// pre-con fee, or any other payment on the job, does not open it. Default
// reader uses signature_requests + that deposit check; a caller may inject its
// own checker (tests, or a richer reader from WS-money). Unknown → refuse.

import type { Run } from "../commands/core.ts";
import { constructionDepositPaid, DEPOSIT_NOT_PAID } from "../workflow/deposit.ts";

export interface GateVerdict {
  ok: boolean;
  signed: boolean;
  /** The construction deposit is paid (lib/workflow/deposit.ts). */
  initialPaymentReceived: boolean;
  unknown: boolean;
  reason: string;
}

export type ConstructionGate = (run: Run, projectId: string) => Promise<GateVerdict>;

export const constructionGateSatisfied: ConstructionGate = async (run, projectId) => {
  const [p] = await run<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [projectId]);
  if (!p) return { ok: false, signed: false, initialPaymentReceived: false, unknown: true, reason: "project not found" };
  const [sig] = await run<{ n: number }>(
    `SELECT count(*)::int AS n FROM signature_requests WHERE project_id = $1 AND doc_type IN ('contract','sow') AND status = 'signed'`,
    [projectId],
  );
  const signed = Number(sig?.n ?? 0) > 0;
  const paid = await constructionDepositPaid(run, projectId);
  const ok = signed && paid;
  return {
    ok,
    signed,
    initialPaymentReceived: paid,
    unknown: false,
    reason: ok
      ? "construction agreement signed and construction deposit paid"
      : `construction gate not met: ${signed ? "" : "no signed construction agreement"}${!signed && !paid ? "; " : ""}${paid ? "" : DEPOSIT_NOT_PAID}`,
  };
};
