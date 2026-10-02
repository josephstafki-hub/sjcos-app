// Project cash guard (A13 / WORKFLOW W09 / DESIGN "Cash, price and schedule
// enforcement"). Pure `run`-style module (no server-only import) so the
// disposable-Postgres tests drive it directly; Next.js callers pass a
// transaction runner from lib/commands/db.ts.
//
// Funding available to COMMIT on a project =
//     collected            (settled invoice_payments net of refunds/returns —
//                           or, when that ledger is absent, the verified
//                           manual projects.collected_to_date, labeled as such)
//   − spent                (expenses + paid bills + paid sub invoices, with the
//                           order→bill overlap removed so nothing counts twice)
//   − active reservations  (cash_reservations.state = 'reserved')
//   + approved company funding (company_funding_approvals.state = 'approved')
//
// Sent invoices, promised payments and pending ACH are NOT funds; they appear
// only in projectFundingForecast(). Unknown cash status refuses the affected
// commitment (never unrelated planning). reserveFunds() locks the project row,
// re-reads the balance under the lock and inserts the reservation in the same
// transaction, so two concurrent purchases cannot both spend the last dollar.

import type { Run } from "../commands/core.ts";
import { stageDecision, type Decision } from "../commands/decisions.ts";
import type { Principal } from "../commands/principal.ts";

export type CollectedSource = "invoice_payments" | "projects.collected_to_date";

export interface ProjectFunding {
  projectId: string;
  status: "known" | "unknown";
  reason?: string;
  collectedSource: CollectedSource;
  collectedCents: number;
  spentCents: number;
  reservedCents: number;
  companyFundingCents: number;
  /** collected − spent − reserved + company funding. Negative = overspent. */
  availableCents: number;
  /** Sent-but-unpaid invoices + pending (unsettled) payments. Forecast only. */
  pendingCents: number;
}

const n = (v: unknown) => (v == null ? 0 : Number(v));

async function tableExists(run: Run, name: string): Promise<boolean> {
  const rows = await run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return Boolean(rows[0]?.ok);
}

/** Cash available to commit right now. `forUpdate` locks the project row for
 *  the rest of the caller's transaction (used by reserveFunds). */
export async function projectFunding(run: Run, projectId: string, opts: { forUpdate?: boolean } = {}): Promise<ProjectFunding> {
  const [project] = await run<{ id: string; collected_to_date: number }>(
    `SELECT id, collected_to_date FROM projects WHERE id = $1${opts.forUpdate ? " FOR UPDATE" : ""}`,
    [projectId],
  );
  const unknown = (reason: string): ProjectFunding => ({
    projectId,
    status: "unknown",
    reason,
    collectedSource: "projects.collected_to_date",
    collectedCents: 0,
    spentCents: 0,
    reservedCents: 0,
    companyFundingCents: 0,
    availableCents: 0,
    pendingCents: 0,
  });
  if (!project) return unknown("project not found");

  let collectedSource: CollectedSource = "projects.collected_to_date";
  let collectedCents = n(project.collected_to_date);
  let pendingCents = 0;
  if (await tableExists(run, "invoice_payments")) {
    collectedSource = "invoice_payments";
    const [c] = await run<{ settled: string; pending: string }>(
      `SELECT COALESCE(sum(CASE WHEN p.status = 'settled' AND p.kind IN ('payment','credit') THEN p.amount_cents
                              WHEN p.status = 'settled' AND p.kind IN ('refund','return') THEN -p.amount_cents
                              ELSE 0 END), 0)::bigint AS settled,
              COALESCE(sum(CASE WHEN p.status = 'pending' AND p.kind = 'payment' THEN p.amount_cents ELSE 0 END), 0)::bigint AS pending
         FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE i.project_id = $1`,
      [projectId],
    );
    collectedCents = n(c?.settled);
    pendingCents += n(c?.pending);
  }
  const [inv] = await run<{ outstanding: string }>(
    `SELECT COALESCE(sum(amount), 0)::bigint AS outstanding FROM invoices WHERE project_id = $1 AND status = 'sent'`,
    [projectId],
  );
  pendingCents += n(inv?.outstanding);

  // Spent: expenses (except those paying a PO whose commitment already has a
  // paid bill — the bill is the record then), paid bills, paid sub invoices
  // for subs with no paid bill on this project.
  const [spent] = await run<{ expenses: string; bills: string; sub_invoices: string }>(
    `SELECT
       (SELECT COALESCE(sum(e.amount_cents), 0) FROM expenses e
         WHERE e.project_id = $1
           AND NOT EXISTS (SELECT 1 FROM purchase_orders po JOIN bills b ON b.commitment_id = po.commitment_id
                            WHERE po.id = e.purchase_order_id AND b.state = 'paid'))::bigint AS expenses,
       (SELECT COALESCE(sum(b.amount_cents), 0) FROM bills b WHERE b.project_id = $1 AND b.state = 'paid')::bigint AS bills,
       (SELECT COALESCE(sum(si.amount), 0) FROM sub_invoices si
         WHERE si.project_id = $1 AND si.status = 'paid'
           AND NOT EXISTS (SELECT 1 FROM bills b WHERE b.project_id = $1 AND b.sub_slug = si.sub_slug AND b.state = 'paid'))::bigint AS sub_invoices`,
    [projectId],
  );
  const spentCents = n(spent?.expenses) + n(spent?.bills) + n(spent?.sub_invoices);
  const [res] = await run<{ reserved: string }>(
    `SELECT COALESCE(sum(amount_cents), 0)::bigint AS reserved FROM cash_reservations WHERE project_id = $1 AND state = 'reserved'`,
    [projectId],
  );
  const [cf] = await run<{ approved: string }>(
    `SELECT COALESCE(sum(amount_cents), 0)::bigint AS approved FROM company_funding_approvals WHERE project_id = $1 AND state = 'approved'`,
    [projectId],
  );
  const reservedCents = n(res?.reserved);
  const companyFundingCents = n(cf?.approved);
  return {
    projectId,
    status: "known",
    collectedSource,
    collectedCents,
    spentCents,
    reservedCents,
    companyFundingCents,
    availableCents: collectedCents - spentCents - reservedCents + companyFundingCents,
    pendingCents,
  };
}

export interface FundingForecastPoint {
  date: string; // YYYY-MM-DD
  label: string;
  amountCents: number;
  kind: "expected_milestone" | "sent_invoice" | "pending_payment";
}

export interface ProjectFundingForecast extends ProjectFunding {
  expected: FundingForecastPoint[];
  /** availableCents + every expected inflow — a ceiling, never a spend limit. */
  forecastCents: number;
}

/** Expected inflows (milestone funding events, sent invoices, pending
 *  payments). Planning input only; reserveFunds ignores it. */
export async function projectFundingForecast(run: Run, projectId: string): Promise<ProjectFundingForecast> {
  const base = await projectFunding(run, projectId);
  const events = await run<{ date: string | null; label: string; amount_cents: number }>(
    `SELECT COALESCE(status_at::date, CURRENT_DATE)::text AS date, trigger_text AS label, amount_cents
       FROM funding_events WHERE project_id = $1 AND status IN ('expected','requested') ORDER BY sort_order, id`,
    [projectId],
  );
  const sent = await run<{ date: string | null; label: string; amount_cents: number }>(
    `SELECT COALESCE(due_at, (sent_at + interval '14 days')::date, CURRENT_DATE)::text AS date, number || ' ' || milestone AS label, amount AS amount_cents
       FROM invoices WHERE project_id = $1 AND status = 'sent' ORDER BY id`,
    [projectId],
  );
  const expected: FundingForecastPoint[] = [
    ...events.map((e) => ({ date: e.date ?? "", label: e.label || "Milestone", amountCents: n(e.amount_cents), kind: "expected_milestone" as const })),
    ...sent.map((e) => ({ date: e.date ?? "", label: e.label.trim() || "Invoice", amountCents: n(e.amount_cents), kind: "sent_invoice" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return { ...base, expected, forecastCents: base.availableCents + expected.reduce((s, e) => s + e.amountCents, 0) };
}

export type ReserveResult =
  | { ok: true; reservationId: number; funding: ProjectFunding; reused: boolean }
  | { ok: false; reason: string; shortfallCents: number | null; funding: ProjectFunding };

/** Atomically reserve project cash for a commitment. Locks the project row,
 *  recomputes the balance under the lock, and inserts the reservation in the
 *  caller's transaction. Refuses with the exact shortfall. Idempotent per
 *  commitment (a retried commit finds its live reservation). */
export async function reserveFunds(
  run: Run,
  input: { projectId: string; commitmentId: number | null; amountCents: number; note?: string },
): Promise<ReserveResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error("amountCents must be a non-negative integer number of cents");
  }
  const funding = await projectFunding(run, input.projectId, { forUpdate: true });
  if (funding.status === "unknown") {
    return { ok: false, reason: `Cash status for this project is unknown (${funding.reason}); the commitment is refused until it is reconciled.`, shortfallCents: null, funding };
  }
  if (input.commitmentId != null) {
    const [live] = await run<{ id: number; amount_cents: number }>(
      `SELECT id, amount_cents FROM cash_reservations WHERE commitment_id = $1 AND state = 'reserved'`,
      [input.commitmentId],
    );
    if (live) {
      if (n(live.amount_cents) !== input.amountCents) {
        return { ok: false, reason: `Commitment ${input.commitmentId} already holds a reservation of a different amount; release it before re-reserving.`, shortfallCents: null, funding };
      }
      return { ok: true, reservationId: Number(live.id), funding, reused: true };
    }
  }
  if (funding.availableCents < input.amountCents) {
    const shortfallCents = input.amountCents - funding.availableCents;
    return {
      ok: false,
      reason: `Project funds available to commit are $${(funding.availableCents / 100).toFixed(2)}; this commitment needs $${(input.amountCents / 100).toFixed(2)} — short by $${(shortfallCents / 100).toFixed(2)}.`,
      shortfallCents,
      funding,
    };
  }
  const [row] = await run<{ id: number }>(
    `INSERT INTO cash_reservations (project_id, commitment_id, amount_cents, note) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.projectId, input.commitmentId, input.amountCents, input.note ?? ""],
  );
  return { ok: true, reservationId: Number(row.id), funding: { ...funding, reservedCents: funding.reservedCents + input.amountCents, availableCents: funding.availableCents - input.amountCents }, reused: false };
}

export interface ConsumeResult {
  consumedCents: number;
  releasedCents: number;
  /** Payment exceeded the reservation by this much (escalate). */
  shortfallCents: number;
}

/** Reconcile a payment against its commitment's live reservation. The paid
 *  amount is consumed; the remainder is released only when the caller
 *  attests the commitment is complete (`releaseRemainder`), otherwise it stays
 *  reserved for the balance. Never double counts: the consumed part leaves
 *  'reserved' in the same statement the bill becomes 'paid'. */
export async function consumeReservationOnPayment(
  run: Run,
  input: { commitmentId: number; amountCents: number; releaseRemainder?: boolean; note?: string },
): Promise<ConsumeResult> {
  const [live] = await run<{ id: number; project_id: string; amount_cents: number }>(
    `SELECT id, project_id, amount_cents FROM cash_reservations WHERE commitment_id = $1 AND state = 'reserved' FOR UPDATE`,
    [input.commitmentId],
  );
  if (!live) return { consumedCents: 0, releasedCents: 0, shortfallCents: input.amountCents };
  const reserved = n(live.amount_cents);
  const consumed = Math.min(reserved, input.amountCents);
  const remainder = reserved - consumed;
  await run(`UPDATE cash_reservations SET state = 'consumed', amount_cents = $2, note = $3, updated_at = now() WHERE id = $1`, [
    live.id,
    consumed,
    input.note ?? "consumed on payment",
  ]);
  let released = 0;
  if (remainder > 0) {
    if (input.releaseRemainder) {
      await run(`INSERT INTO cash_reservations (project_id, commitment_id, amount_cents, state, note) VALUES ($1, $2, $3, 'released', 'unused after final payment')`, [
        live.project_id,
        input.commitmentId,
        remainder,
      ]);
      released = remainder;
    } else {
      await run(`INSERT INTO cash_reservations (project_id, commitment_id, amount_cents, state, note) VALUES ($1, $2, $3, 'reserved', 'balance after partial payment')`, [
        live.project_id,
        input.commitmentId,
        remainder,
      ]);
    }
  }
  return { consumedCents: consumed, releasedCents: released, shortfallCents: Math.max(0, input.amountCents - reserved) };
}

/** Release a live reservation only when it is verifiably unused: the
 *  commitment is void, or fully paid/accepted with no unpaid matched bill. */
export async function releaseUnusedReservation(
  run: Run,
  input: { commitmentId: number; reason: string },
): Promise<{ ok: true; releasedCents: number } | { ok: false; reason: string }> {
  const [c] = await run<{ state: string; unpaid: number }>(
    `SELECT c.state,
            (SELECT count(*)::int FROM bills b WHERE b.commitment_id = c.id AND b.state IN ('pending','approved','manual_pending')) AS unpaid
       FROM commitments c WHERE c.id = $1 FOR UPDATE`,
    [input.commitmentId],
  );
  if (!c) return { ok: false, reason: "No such commitment." };
  if (c.state !== "void" && c.state !== "paid") {
    return { ok: false, reason: `Reservation stays until the commitment is void or paid (it is ${c.state}).` };
  }
  if (n(c.unpaid) > 0) return { ok: false, reason: "A matched bill on this commitment is still unpaid." };
  const rows = await run<{ amount_cents: number }>(
    `UPDATE cash_reservations SET state = 'released', note = $2, updated_at = now() WHERE commitment_id = $1 AND state = 'reserved' RETURNING amount_cents`,
    [input.commitmentId, input.reason],
  );
  return { ok: true, releasedCents: rows.reduce((s, r) => s + n(r.amount_cents), 0) };
}

export interface ShortfallInput {
  projectId: string;
  amountCents: number;
  purpose: string;
  effect: string;
  principal: Principal;
  commitmentId?: number | null;
  href?: string | null;
}

/** A funding gap or a company-cash need becomes an explicit 'funding' decision
 *  naming project, amount, purpose and effect (DECISIONS: "Company cash for
 *  project"). One pending decision per project+purpose; a changed amount
 *  supersedes it. */
export async function escalateShortfall(run: Run, input: ShortfallInput): Promise<{ decision: Decision; approvalId: number; created: boolean }> {
  const [p] = await run<{ name: string; slug: string }>(`SELECT name, slug FROM projects WHERE id = $1`, [input.projectId]);
  const title = `Company cash needed: $${(input.amountCents / 100).toFixed(2)} for ${p?.name ?? "project"} — ${input.purpose}`.slice(0, 300);
  const staged = await stageDecision(run, {
    kind: "funding",
    action: "fund_project_from_company_cash",
    title,
    summary: {
      project: p?.name ?? input.projectId,
      amount: `$${(input.amountCents / 100).toFixed(2)}`,
      purpose: input.purpose,
      effect: input.effect,
      commitmentId: input.commitmentId ?? null,
    },
    targetKind: "project",
    targetId: input.projectId,
    amountCents: input.amountCents,
    content: { projectId: input.projectId, amountCents: input.amountCents, purpose: input.purpose },
    projectId: input.projectId,
    href: input.href ?? (p ? `/projects/${p.slug}` : null),
    dedupeKey: `funding:${input.projectId}:${input.purpose.toLowerCase().replace(/\s+/g, "-").slice(0, 80)}`,
    requestedBy: input.principal,
  });
  const [existing] = await run<{ id: number }>(`SELECT id FROM company_funding_approvals WHERE decision_id = $1`, [staged.decision.id]);
  if (existing) return { decision: staged.decision, approvalId: Number(existing.id), created: false };
  if (staged.superseded) {
    await run(`UPDATE company_funding_approvals SET state = 'withdrawn', updated_at = now() WHERE decision_id = $1 AND state = 'proposed'`, [staged.superseded]);
  }
  const [row] = await run<{ id: number }>(
    `INSERT INTO company_funding_approvals (project_id, amount_cents, purpose, effect, decision_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.projectId, input.amountCents, input.purpose, input.effect, staged.decision.id],
  );
  return { decision: staged.decision, approvalId: Number(row.id), created: true };
}

/** After the owner approves a 'funding' decision, apply it: the approval row
 *  flips to 'approved' and the amount joins availableCents. Idempotent. */
export async function applyCompanyFunding(run: Run, decisionId: string): Promise<{ ok: true; amountCents: number } | { ok: false; reason: string }> {
  const [d] = await run<{ status: string; amount_cents: number | null }>(`SELECT status, amount_cents FROM decisions WHERE id = $1 FOR UPDATE`, [decisionId]);
  if (!d) return { ok: false, reason: "No such decision." };
  if (d.status !== "approved" && d.status !== "consumed") return { ok: false, reason: `Funding decision is ${d.status}, not approved.` };
  const rows = await run<{ amount_cents: number }>(
    `UPDATE company_funding_approvals SET state = 'approved', updated_at = now() WHERE decision_id = $1 AND state IN ('proposed','approved') RETURNING amount_cents`,
    [decisionId],
  );
  if (!rows[0]) return { ok: false, reason: "No funding proposal is bound to that decision." };
  return { ok: true, amountCents: n(rows[0].amount_cents) };
}
