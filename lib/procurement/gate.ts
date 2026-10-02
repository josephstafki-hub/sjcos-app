// Construction gate (DECISIONS "Construction gate", WORKFLOW W09): a signed
// construction agreement AND a received initial payment before material
// orders or awards are placed. Default reader uses signature_requests +
// invoice_payments/invoices; a caller may inject its own checker (tests, or a
// richer reader from WS-money). Unknown → refuse.

import type { Run } from "../commands/core.ts";

export interface GateVerdict {
  ok: boolean;
  signed: boolean;
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
  const [hasLedger] = await run<{ ok: boolean }>(`SELECT to_regclass('public.invoice_payments') IS NOT NULL AS ok`);
  let paid = false;
  if (hasLedger?.ok) {
    const [pm] = await run<{ n: number }>(
      `SELECT count(*)::int AS n FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.project_id = $1 AND p.status = 'settled' AND p.kind = 'payment' AND p.amount_cents > 0`,
      [projectId],
    );
    paid = Number(pm?.n ?? 0) > 0;
  } else {
    const [pm] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1 AND status = 'paid'`, [projectId]);
    paid = Number(pm?.n ?? 0) > 0;
  }
  const ok = signed && paid;
  return {
    ok,
    signed,
    initialPaymentReceived: paid,
    unknown: false,
    reason: ok
      ? "construction agreement signed and initial payment received"
      : `construction gate not met: ${signed ? "" : "no signed construction agreement"}${!signed && !paid ? "; " : ""}${paid ? "" : "no initial payment received"}`,
  };
};
