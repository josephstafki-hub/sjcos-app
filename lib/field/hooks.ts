// Injected hook contracts for the field / closeout / owner-time libraries.
//
// WS-field never calls money, funding, sends or the obligations engine
// directly. Every cross-workstream effect goes through one of these functions,
// which the integration owner binds in lib/field/server.ts (and tests bind to
// spies). Defaults are conservative: unknown funding → not available, unknown
// payment → not received, no follow-up creator → no request is filed (and the
// caller is told so).

import type { Run } from "../commands/core.ts";

export interface FundingVerdict {
  ok: boolean;
  /** Reconciled available project cash, or null when unknown. */
  availableCents: number | null;
  reason: string;
}

export interface FollowUpRequest {
  projectId: string;
  subSlug: string | null;
  title: string;
  body: string;
  /** Stable key so the same request is never filed twice. */
  dedupeKey: string;
  /** Who should answer: sub via portal, or Joe. */
  audience: "sub" | "owner";
  priority?: "normal" | "high" | "urgent";
}

export interface OwnerAlert {
  kind: "urgent_item" | "approval_needed";
  title: string;
  body?: string;
  href?: string;
}

export interface FieldHooks {
  /** WS-procurement `lib/funding/*`: reconciled cash available to this project. */
  fundingAvailable: (run: Run, projectId: string) => Promise<FundingVerdict>;
  /** WS-money: has the initial (contract) payment been received in full? */
  initialPaymentReceived: (run: Run, projectId: string) => Promise<boolean>;
  /** WS-money `invoice.issue_progress_on_owner_confirmation` consumer. Called
   *  exactly once per (project, milestone). */
  onMilestoneConfirmed: (run: Run, projectId: string, milestoneKey: string, decisionId: string | null) => Promise<void>;
  /** WS-recovery obligations / work items: file a targeted request. Return
   *  the work item id (or null when nothing was filed). */
  createFollowUp: (run: Run, req: FollowUpRequest) => Promise<string | null>;
  /** WS-approvals notify-owner. Bound so it runs AFTER commit in server.ts. */
  notifyOwner: (alert: OwnerAlert) => Promise<void>;
}

export const NO_FUNDING: FundingVerdict = { ok: false, availableCents: null, reason: "funding status unknown (lib/funding not wired)" };

/** Safe defaults for every hook: nothing external happens, gates stay closed. */
export function defaultFieldHooks(overrides: Partial<FieldHooks> = {}): FieldHooks {
  return {
    fundingAvailable: async () => NO_FUNDING,
    initialPaymentReceived: async (run, projectId) => defaultInitialPaymentReceived(run, projectId),
    onMilestoneConfirmed: async () => {},
    createFollowUp: async () => null,
    notifyOwner: async () => {},
    ...overrides,
  };
}

/** Default reader for the initial payment: if WS-money's invoice_payments
 *  table exists, the first (lowest id) invoice must be covered in full by
 *  recorded payments; else fall back to invoices.status = 'paid' on the
 *  earliest invoice; else false. Never guesses. */
export async function defaultInitialPaymentReceived(run: Run, projectId: string): Promise<boolean> {
  const [t] = await run<{ present: string | null }>(`SELECT to_regclass('public.invoice_payments')::text AS present`);
  if (t?.present) {
    const rows = await run<{ covered: boolean }>(
      `SELECT COALESCE((SELECT sum(p.amount_cents) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) >= i.amount AS covered
         FROM invoices i WHERE i.project_id = $1 ORDER BY i.id LIMIT 1`,
      [projectId],
    );
    return rows[0]?.covered === true;
  }
  const rows = await run<{ status: string }>(`SELECT status FROM invoices WHERE project_id = $1 ORDER BY id LIMIT 1`, [projectId]);
  return rows[0]?.status === "paid";
}
