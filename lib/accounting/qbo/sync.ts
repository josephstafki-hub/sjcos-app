// QuickBooks Online sync (A14) — pure `run(sql, params)` style.
//
//   importPostedEntities   read/import supported posted entities per cursor;
//                          match by existing mapping first, otherwise record
//                          the row as `unmapped` with PROPOSED candidates
//                          (amount + date + customer) — never attached
//                          automatically; detect QBO edits/voids after we
//                          posted → `conflict` (+ a decision for Joe).
//   exportIssuedInvoice /  controlled outbound mirror of an SJC-issued invoice /
//   exportConfirmedPayment a settled customer payment, once, only when that
//                          direction's switch is on; idempotent on the mapping.
//   reconcilePayout        gross receipt − processor fee = net deposit as ONE
//                          economic event: payment mapping + fee Expense
//                          mapping + Deposit match; never a second revenue.
//   confirmMapping /       owner review of unmapped/conflict rows.
//   rejectMapping
//
// Every write is keyed on (realm, entity, qbo_id) or (realm, entity, internal)
// so repeated runs create no duplicate revenue or cash (VALIDATION V16).

import { createHash } from "node:crypto";
import type { Run } from "../../commands/core.ts";
import { canonicalJson } from "../../commands/core.ts";
import { stageDecision } from "../../commands/decisions.ts";
import type { Principal } from "../../commands/principal.ts";
import type { QboAdapter, QboDoc, QboEntityKind } from "./types.ts";

export type SyncSwitch = "import_read" | "export_invoices" | "export_payments";

export interface QboMappingRow {
  id: string;
  realm_id: string;
  entity_kind: QboEntityKind;
  qbo_id: string | null;
  sync_token: string | null;
  version_hash: string | null;
  qbo_voided: boolean;
  internal_kind: string | null;
  internal_id: string | null;
  direction: "import" | "export";
  state: "unmapped" | "posted" | "settled" | "reconciled" | "conflict" | "rejected";
  candidates: Array<{ internal_kind: string; internal_id: string; score: number; why: string }>;
  snapshot: Record<string, unknown>;
  amount_cents: number | null;
  txn_date: string | null;
  note: string;
}

const MAP_COLS = `id, realm_id, entity_kind, qbo_id, sync_token, version_hash, qbo_voided, internal_kind, internal_id, direction, state, candidates, snapshot,
  amount_cents, txn_date::text AS txn_date, note`;

export const IMPORT_KINDS: QboEntityKind[] = ["Customer", "Invoice", "Payment", "Purchase", "Bill", "Deposit"];

const cents = (dollars: number | undefined | null) => (dollars == null ? null : Math.round(Number(dollars) * 100));
const versionHash = (d: QboDoc) =>
  createHash("sha256").update(canonicalJson({ Id: d.Id, SyncToken: d.SyncToken, TotalAmt: d.TotalAmt, TxnDate: d.TxnDate, Voided: !!d.Voided, DocNumber: d.DocNumber, Line: d.Line ?? null })).digest("hex");
/** What we keep of a QBO document: identity, money, dates — never a full dump. */
const sanitize = (d: QboDoc): Record<string, unknown> => ({ Id: d.Id, SyncToken: d.SyncToken, TxnDate: d.TxnDate ?? null, TotalAmt: d.TotalAmt ?? null, DocNumber: d.DocNumber ?? null, CustomerRef: d.CustomerRef ?? null, Voided: !!d.Voided, LastUpdatedTime: d.MetaData?.LastUpdatedTime ?? null });

export async function ensureConnection(run: Run, input: { realmId: string; environment: "fake" | "sandbox" | "production"; companyName?: string; state?: "connected" | "disconnected" | "expired" | "error"; error?: string | null }): Promise<void> {
  await run(
    `INSERT INTO qbo_connection (realm_id, environment, state, company_name, last_error)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (realm_id) DO UPDATE SET environment = EXCLUDED.environment, state = EXCLUDED.state,
       company_name = CASE WHEN EXCLUDED.company_name <> '' THEN EXCLUDED.company_name ELSE qbo_connection.company_name END, last_error = EXCLUDED.last_error`,
    [input.realmId, input.environment, input.state ?? "connected", input.companyName ?? "", input.error ?? null],
  );
}

export async function switchOn(run: Run, key: SyncSwitch): Promise<boolean> {
  const [r] = await run<{ enabled: boolean }>(`SELECT enabled FROM qbo_sync_settings WHERE key = $1`, [key]);
  return r?.enabled === true;
}

export async function setSwitch(run: Run, key: SyncSwitch, enabled: boolean, by: string): Promise<void> {
  await run(`INSERT INTO qbo_sync_settings (key, enabled, updated_by, updated_at) VALUES ($1, $2, $3, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, enabled, by]);
}

// ── Candidates: proposals only ───────────────────────────────────────────────

async function candidatesFor(run: Run, kind: QboEntityKind, doc: QboDoc): Promise<QboMappingRow["candidates"]> {
  const amount = cents(doc.TotalAmt);
  if (amount == null || amount <= 0) return [];
  const date = doc.TxnDate ?? null;
  if (kind === "Invoice") {
    const rows = await run<{ id: number; number: string; issued_at: string | null; client_name: string }>(
      `SELECT i.id::int AS id, i.number, COALESCE(i.issued_at, i.sent_at, i.created_at)::date::text AS issued_at, p.client_name
         FROM invoices i JOIN projects p ON p.id = i.project_id
        WHERE i.amount = $1 AND i.status <> 'void' AND (i.external_ref->'qbo'->>'id') IS NULL
        ORDER BY abs(COALESCE(i.issued_at, i.sent_at, i.created_at)::date - COALESCE($2::date, CURRENT_DATE)) LIMIT 5`,
      [amount, date],
    );
    return rows.map((r) => ({ internal_kind: "invoice", internal_id: String(r.id), score: date && r.issued_at === date ? 0.9 : 0.6, why: `same amount${date && r.issued_at === date ? " and date" : ""}; invoice ${r.number} (${r.client_name})` }));
  }
  if (kind === "Payment") {
    const rows = await run<{ id: number; received_at: string; invoice_id: number }>(
      `SELECT p.id::int AS id, p.received_at::date::text AS received_at, p.invoice_id::int AS invoice_id
         FROM invoice_payments p WHERE p.amount_cents = $1 AND p.kind = 'payment' AND (p.external_sync->'qbo'->>'id') IS NULL
        ORDER BY abs(p.received_at::date - COALESCE($2::date, CURRENT_DATE)) LIMIT 5`,
      [amount, date],
    );
    return rows.map((r) => ({ internal_kind: "invoice_payment", internal_id: String(r.id), score: date && r.received_at === date ? 0.9 : 0.6, why: `same amount${date && r.received_at === date ? " and date" : ""}; payment on invoice ${r.invoice_id}` }));
  }
  if (kind === "Purchase" || kind === "Bill") {
    const rows = await run<{ id: number; expense_date: string; vendor_label: string }>(
      `SELECT id::int AS id, expense_date::text AS expense_date, vendor_label FROM expenses WHERE amount_cents = $1 AND source_ref NOT LIKE 'qbo:%'
        ORDER BY abs(expense_date - COALESCE($2::date, CURRENT_DATE)) LIMIT 5`,
      [amount, date],
    );
    return rows.map((r) => ({ internal_kind: "expense", internal_id: String(r.id), score: date && r.expense_date === date ? 0.9 : 0.6, why: `same amount${date && r.expense_date === date ? " and date" : ""}; ${r.vendor_label || "expense"}` }));
  }
  return [];
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ImportResult {
  realmId: string;
  dryRun: boolean;
  kinds: Record<string, { seen: number; created: number; updated: number; conflicts: number; cursor_to: string | null }>;
  conflicts: Array<{ mapping_id: string; entity_kind: string; qbo_id: string; reason: string; decision_id: string | null }>;
}

export async function importPostedEntities(
  run: Run,
  adapter: QboAdapter,
  input: { realmId: string; kinds?: QboEntityKind[]; dryRun?: boolean; principal: Principal },
): Promise<ImportResult> {
  const enabled = await switchOn(run, "import_read");
  const dryRun = input.dryRun ?? !enabled; // the switch OFF forces a dry-run
  const [conn] = await run<{ cursors: Record<string, string> }>(`SELECT cursors FROM qbo_connection WHERE realm_id = $1`, [input.realmId]);
  const cursors = conn?.cursors ?? {};
  const out: ImportResult = { realmId: input.realmId, dryRun, kinds: {}, conflicts: [] };
  for (const kind of input.kinds ?? IMPORT_KINDS) {
    const since = cursors[kind] ?? null;
    const docs = await adapter.listChanges(kind, since);
    const stat = { seen: docs.length, created: 0, updated: 0, conflicts: 0, cursor_to: since };
    for (const doc of docs) {
      const hash = versionHash(doc);
      const [existing] = await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = $2 AND qbo_id = $3 FOR UPDATE`, [input.realmId, kind, doc.Id]);
      const lastUpdated = doc.MetaData?.LastUpdatedTime ?? null;
      if (lastUpdated && (!stat.cursor_to || lastUpdated > stat.cursor_to)) stat.cursor_to = lastUpdated;
      if (!existing) {
        stat.created++;
        if (dryRun) continue;
        const candidates = await candidatesFor(run, kind, doc);
        await run(
          `INSERT INTO qbo_mappings (realm_id, entity_kind, qbo_id, sync_token, version_hash, qbo_voided, direction, state, candidates, snapshot, amount_cents, txn_date, note)
           VALUES ($1, $2, $3, $4, $5, $6, 'import', 'unmapped', $7::jsonb, $8::jsonb, $9, $10, $11)`,
          [input.realmId, kind, doc.Id, doc.SyncToken, hash, !!doc.Voided, JSON.stringify(candidates), JSON.stringify(sanitize(doc)), cents(doc.TotalAmt), doc.TxnDate ?? null, candidates.length ? `${candidates.length} candidate match(es) proposed — review before attaching` : "no internal candidate; stays unmapped"],
        );
        continue;
      }
      if (existing.version_hash === hash) continue; // unchanged
      stat.updated++;
      // A mapping we posted without a stored version (legacy/confirmed row):
      // adopt the current version once, no conflict — nothing was compared.
      const wasPosted = existing.version_hash != null && ["posted", "settled", "reconciled"].includes(existing.state);
      const reason = doc.Voided && !existing.qbo_voided ? "voided in QuickBooks after we posted it" : "edited in QuickBooks after we posted it";
      if (dryRun) {
        if (wasPosted) stat.conflicts++;
        continue;
      }
      if (wasPosted) {
        stat.conflicts++;
        await run(`UPDATE qbo_mappings SET state = 'conflict', sync_token = $2, version_hash = $3, qbo_voided = $4, snapshot = $5::jsonb, amount_cents = $6, note = $7 WHERE id = $1`, [existing.id, doc.SyncToken, hash, !!doc.Voided, JSON.stringify(sanitize(doc)), cents(doc.TotalAmt), reason]);
        const { decision } = await stageDecision(run, {
          kind: "other",
          action: "resolve_accounting_conflict",
          title: `QuickBooks ${kind} ${doc.DocNumber ?? doc.Id} ${doc.Voided ? "voided" : "changed"} after SJC OS posted it`,
          summary: { effect: "Decide which record is right: keep the QuickBooks change (SJC OS re-maps), or re-post from SJC OS. Nothing is changed automatically.", changes: [reason], gaps: [`internal ${existing.internal_kind ?? "?"} ${existing.internal_id ?? "?"}`] },
          targetKind: "qbo_mapping",
          targetId: existing.id,
          content: { mapping_id: existing.id, version_hash: hash },
          dedupeKey: `qbo_conflict:${existing.id}`,
          requestedBy: input.principal,
          href: "/settings/accounting",
        });
        out.conflicts.push({ mapping_id: existing.id, entity_kind: kind, qbo_id: doc.Id, reason, decision_id: decision.id });
      } else {
        await run(`UPDATE qbo_mappings SET sync_token = $2, version_hash = $3, qbo_voided = $4, snapshot = $5::jsonb, amount_cents = $6, txn_date = $7 WHERE id = $1`, [existing.id, doc.SyncToken, hash, !!doc.Voided, JSON.stringify(sanitize(doc)), cents(doc.TotalAmt), doc.TxnDate ?? null]);
      }
    }
    out.kinds[kind] = stat;
    await run(
      `INSERT INTO qbo_import_batches (realm_id, entity_kind, cursor_from, cursor_to, seen, created, updated, conflicts, dry_run, finished_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
      [input.realmId, kind, since, stat.cursor_to, stat.seen, stat.created, stat.updated, stat.conflicts, dryRun],
    );
    if (!dryRun && stat.cursor_to && stat.cursor_to !== since) {
      await run(`UPDATE qbo_connection SET cursors = cursors || $2::jsonb, last_sync_at = now() WHERE realm_id = $1`, [input.realmId, JSON.stringify({ [kind]: stat.cursor_to })]);
    }
  }
  return out;
}

// ── Export (controlled, per-direction switch) ────────────────────────────────

export type ExportResult = { ok: true; mappingId: string; qboId: string; created: boolean } | { ok: false; reason: string; code: "switch_off" | "not_found" | "not_issued" | "no_customer" | "no_invoice_mapping" | "not_settled" };

/** Mirror an ISSUED SJC invoice to QBO once (never drafts, never voids). */
export async function exportIssuedInvoice(run: Run, adapter: QboAdapter, input: { realmId: string; invoiceId: number; by: string }): Promise<ExportResult> {
  if (!(await switchOn(run, "export_invoices"))) return { ok: false, reason: "export_invoices is off — invoices are not mirrored to QuickBooks until Joe turns the direction on", code: "switch_off" };
  const [inv] = await run<{ id: number; number: string; amount: number; status: string; issued_at: string | null; client_name: string; project_slug: string; external_ref: Record<string, unknown> }>(
    `SELECT i.id::int AS id, i.number, i.amount, i.status, COALESCE(i.issued_at, i.sent_at)::date::text AS issued_at, p.client_name, p.slug AS project_slug, i.external_ref
       FROM invoices i JOIN projects p ON p.id = i.project_id WHERE i.id = $1 FOR UPDATE`,
    [input.invoiceId],
  );
  if (!inv) return { ok: false, reason: "invoice not found", code: "not_found" };
  if (["draft", "void"].includes(inv.status)) return { ok: false, reason: `invoice ${inv.number} is ${inv.status}; only issued invoices are mirrored`, code: "not_issued" };
  const [existing] = await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Invoice' AND internal_kind = 'invoice' AND internal_id = $2 AND state <> 'rejected'`, [input.realmId, String(inv.id)]);
  if (existing?.qbo_id) return { ok: true, mappingId: existing.id, qboId: existing.qbo_id, created: false };
  const customer = await customerFor(run, adapter, input.realmId, inv.client_name);
  const doc = await adapter.create("Invoice", { DocNumber: inv.number, TxnDate: inv.issued_at ?? undefined, TotalAmt: inv.amount / 100, CustomerRef: { value: customer.qboId, name: inv.client_name }, Line: [{ Amount: inv.amount / 100, DetailType: "SalesItemLineDetail", Description: `SJC OS invoice ${inv.number} (${inv.project_slug})` }] });
  const [m] = await run<{ id: string }>(
    `INSERT INTO qbo_mappings (realm_id, entity_kind, qbo_id, sync_token, version_hash, internal_kind, internal_id, direction, state, snapshot, amount_cents, txn_date, note)
     VALUES ($1, 'Invoice', $2, $3, $4, 'invoice', $5, 'export', 'posted', $6::jsonb, $7, $8, $9) RETURNING id`,
    [input.realmId, doc.Id, doc.SyncToken, versionHash(doc), String(inv.id), JSON.stringify(sanitize(doc)), inv.amount, inv.issued_at, `posted by ${input.by}`],
  );
  await run(`UPDATE invoices SET external_ref = external_ref || $2::jsonb WHERE id = $1`, [inv.id, JSON.stringify({ qbo: { id: doc.Id, sync_token: doc.SyncToken, realm: input.realmId } })]);
  return { ok: true, mappingId: m.id, qboId: doc.Id, created: true };
}

async function customerFor(run: Run, adapter: QboAdapter, realmId: string, clientName: string): Promise<{ qboId: string }> {
  const key = clientName.trim().toLowerCase() || "unknown";
  const [m] = await run<{ qbo_id: string }>(`SELECT qbo_id FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Customer' AND internal_kind = 'client' AND internal_id = $2 AND qbo_id IS NOT NULL`, [realmId, key]);
  if (m) return { qboId: m.qbo_id };
  const doc = await adapter.create("Customer", { DisplayName: clientName.trim() || "Unknown client" } as Partial<QboDoc>);
  await run(`INSERT INTO qbo_mappings (realm_id, entity_kind, qbo_id, sync_token, version_hash, internal_kind, internal_id, direction, state, snapshot) VALUES ($1, 'Customer', $2, $3, $4, 'client', $5, 'export', 'posted', $6::jsonb) ON CONFLICT DO NOTHING`, [realmId, doc.Id, doc.SyncToken, versionHash(doc), key, JSON.stringify({ Id: doc.Id, DisplayName: clientName })]);
  return { qboId: doc.Id };
}

/** Mirror a SETTLED customer payment once, applied to the mirrored invoice. */
export async function exportConfirmedPayment(run: Run, adapter: QboAdapter, input: { realmId: string; invoicePaymentId: number; by: string }): Promise<ExportResult> {
  if (!(await switchOn(run, "export_payments"))) return { ok: false, reason: "export_payments is off", code: "switch_off" };
  const [p] = await run<{ id: number; invoice_id: number; amount_cents: number; status: string; kind: string; received_at: string; provider: string | null; provider_ref: string | null }>(
    `SELECT id::int AS id, invoice_id::int AS invoice_id, amount_cents, status, kind, received_at::date::text AS received_at, provider, provider_ref FROM invoice_payments WHERE id = $1 FOR UPDATE`,
    [input.invoicePaymentId],
  );
  if (!p) return { ok: false, reason: "payment not found", code: "not_found" };
  if (p.kind !== "payment" || p.status !== "settled") return { ok: false, reason: `payment ${p.id} is ${p.kind}/${p.status}; only settled payments are mirrored`, code: "not_settled" };
  const [existing] = await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Payment' AND internal_kind = 'invoice_payment' AND internal_id = $2 AND state <> 'rejected'`, [input.realmId, String(p.id)]);
  if (existing?.qbo_id) return { ok: true, mappingId: existing.id, qboId: existing.qbo_id, created: false };
  const [invMap] = await run<{ qbo_id: string }>(`SELECT qbo_id FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Invoice' AND internal_kind = 'invoice' AND internal_id = $2 AND qbo_id IS NOT NULL AND state <> 'rejected'`, [input.realmId, String(p.invoice_id)]);
  if (!invMap) return { ok: false, reason: `invoice ${p.invoice_id} is not mirrored yet; export the invoice first`, code: "no_invoice_mapping" };
  const doc = await adapter.create("Payment", { TxnDate: p.received_at, TotalAmt: p.amount_cents / 100, Line: [{ Amount: p.amount_cents / 100, LinkedTxn: [{ TxnId: invMap.qbo_id, TxnType: "Invoice" }] }], PrivateNote: p.provider ? `${p.provider} ${p.provider_ref ?? ""}`.trim() : "recorded in SJC OS" } as Partial<QboDoc>);
  const [m] = await run<{ id: string }>(
    `INSERT INTO qbo_mappings (realm_id, entity_kind, qbo_id, sync_token, version_hash, internal_kind, internal_id, direction, state, snapshot, amount_cents, txn_date, note)
     VALUES ($1, 'Payment', $2, $3, $4, 'invoice_payment', $5, 'export', 'settled', $6::jsonb, $7, $8, $9) RETURNING id`,
    [input.realmId, doc.Id, doc.SyncToken, versionHash(doc), String(p.id), JSON.stringify(sanitize(doc)), p.amount_cents, p.received_at, `posted by ${input.by}`],
  );
  await run(`UPDATE invoice_payments SET external_sync = external_sync || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ qbo: { id: doc.Id, sync_token: doc.SyncToken, realm: input.realmId } })]);
  return { ok: true, mappingId: m.id, qboId: doc.Id, created: true };
}

// ── Payout reconciliation: one economic event ────────────────────────────────

export interface PayoutInput {
  realmId: string;
  provider: string;
  payoutRef: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  /** invoice_payments ids the payout covers. */
  invoicePaymentIds: number[];
  depositQboId?: string | null;
  by: string;
}

export type PayoutResult = { ok: true; reconciled: number; feeMappingId: string | null; depositMappingId: string | null; created: boolean } | { ok: false; reason: string };

/** Gross − fee = net, or it is an exception. Payment mappings become
 *  `reconciled`; the fee is ONE Expense mapping; the deposit is matched (not
 *  created) by its QBO id when known. Repeating the same payout changes nothing. */
export async function reconcilePayout(run: Run, input: PayoutInput): Promise<PayoutResult> {
  if (input.grossCents - input.feeCents !== input.netCents) return { ok: false, reason: `gross ${input.grossCents} − fee ${input.feeCents} ≠ net ${input.netCents}; not reconciled (exception, no guess)` };
  const [feeExisting] = await run<{ id: string }>(`SELECT id FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Expense' AND internal_kind = 'processor_fee' AND internal_id = $2`, [input.realmId, `${input.provider}:${input.payoutRef}`]);
  if (feeExisting) {
    const [dep] = await run<{ id: string }>(`SELECT id FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Deposit' AND internal_kind = 'payout' AND internal_id = $2`, [input.realmId, `${input.provider}:${input.payoutRef}`]);
    return { ok: true, reconciled: 0, feeMappingId: feeExisting.id, depositMappingId: dep?.id ?? null, created: false };
  }
  const paid = await run<{ id: string; amount_cents: number }>(
    `SELECT id, amount_cents FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = 'Payment' AND internal_kind = 'invoice_payment' AND internal_id = ANY($2::text[]) AND state IN ('settled','posted')`,
    [input.realmId, input.invoicePaymentIds.map(String)],
  );
  const covered = paid.reduce((s, p) => s + Number(p.amount_cents ?? 0), 0);
  if (paid.length !== input.invoicePaymentIds.length) return { ok: false, reason: `${input.invoicePaymentIds.length - paid.length} payment(s) are not mirrored/settled yet; reconcile after they post` };
  if (covered !== input.grossCents) return { ok: false, reason: `mirrored payments total ${covered} cents but the payout's gross is ${input.grossCents}; not reconciled` };
  await run(`UPDATE qbo_mappings SET state = 'reconciled', note = note || $2 WHERE id = ANY($1::uuid[])`, [paid.map((p) => p.id), ` · payout ${input.provider}:${input.payoutRef}`]);
  const [fee] = await run<{ id: string }>(
    `INSERT INTO qbo_mappings (realm_id, entity_kind, internal_kind, internal_id, direction, state, amount_cents, note)
     VALUES ($1, 'Expense', 'processor_fee', $2, 'export', $3, $4, $5) RETURNING id`,
    [input.realmId, `${input.provider}:${input.payoutRef}`, input.feeCents > 0 ? "posted" : "reconciled", input.feeCents, `processor fee for payout ${input.payoutRef} (gross ${input.grossCents}, net ${input.netCents}); one economic event, no second income`],
  );
  let depositMappingId: string | null = null;
  if (input.depositQboId) {
    const [dep] = await run<{ id: string }>(
      `INSERT INTO qbo_mappings (realm_id, entity_kind, qbo_id, internal_kind, internal_id, direction, state, amount_cents, note)
       VALUES ($1, 'Deposit', $2, 'payout', $3, 'import', 'reconciled', $4, $5)
       ON CONFLICT (realm_id, entity_kind, qbo_id) WHERE qbo_id IS NOT NULL DO UPDATE SET internal_kind = 'payout', internal_id = EXCLUDED.internal_id, state = 'reconciled', note = EXCLUDED.note
       RETURNING id`,
      [input.realmId, input.depositQboId, `${input.provider}:${input.payoutRef}`, input.netCents, `net deposit of payout ${input.payoutRef} matched to ${paid.length} payment(s) + fee`],
    );
    depositMappingId = dep?.id ?? null;
  }
  return { ok: true, reconciled: paid.length, feeMappingId: fee.id, depositMappingId, created: true };
}

// ── Owner review ─────────────────────────────────────────────────────────────

export async function confirmMapping(run: Run, input: { mappingId: string; internalKind: string; internalId: string; by: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [m] = await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE id = $1 FOR UPDATE`, [input.mappingId]);
  if (!m) return { ok: false, reason: "no such mapping" };
  if (!["unmapped", "conflict"].includes(m.state)) return { ok: false, reason: `mapping is ${m.state}; nothing to confirm` };
  const [dup] = await run<{ id: string }>(`SELECT id FROM qbo_mappings WHERE realm_id = $1 AND entity_kind = $2 AND internal_kind = $3 AND internal_id = $4 AND state <> 'rejected' AND id <> $5`, [m.realm_id, m.entity_kind, input.internalKind, input.internalId, m.id]);
  if (dup) return { ok: false, reason: `${input.internalKind} ${input.internalId} is already mapped to another QuickBooks ${m.entity_kind}` };
  await run(`UPDATE qbo_mappings SET internal_kind = $2, internal_id = $3, state = CASE WHEN entity_kind = 'Payment' THEN 'settled' ELSE 'posted' END, candidates = '[]'::jsonb, note = $4 WHERE id = $1`, [m.id, input.internalKind, input.internalId, `confirmed by ${input.by}`]);
  if (m.entity_kind === "Invoice" && input.internalKind === "invoice" && m.qbo_id) await run(`UPDATE invoices SET external_ref = external_ref || $2::jsonb WHERE id = $1`, [Number(input.internalId), JSON.stringify({ qbo: { id: m.qbo_id, sync_token: m.sync_token, realm: m.realm_id } })]);
  if (m.entity_kind === "Payment" && input.internalKind === "invoice_payment" && m.qbo_id) await run(`UPDATE invoice_payments SET external_sync = external_sync || $2::jsonb WHERE id = $1`, [Number(input.internalId), JSON.stringify({ qbo: { id: m.qbo_id, sync_token: m.sync_token, realm: m.realm_id } })]);
  return { ok: true };
}

export async function rejectMapping(run: Run, mappingId: string, by: string, reason: string): Promise<boolean> {
  const rows = await run(`UPDATE qbo_mappings SET state = 'rejected', note = $2 WHERE id = $1 AND state IN ('unmapped','conflict') RETURNING id`, [mappingId, `rejected by ${by}: ${reason}`]);
  return rows.length === 1;
}

export interface QboSummary {
  connection: { realm_id: string; environment: string; state: string; company_name: string; last_sync_at: string | null; last_error: string | null; cursors: Record<string, string> } | null;
  switches: Record<SyncSwitch, boolean>;
  counts: Record<string, number>;
  unmapped: QboMappingRow[];
  conflicts: QboMappingRow[];
  batches: Array<{ entity_kind: string; seen: number; created: number; updated: number; conflicts: number; dry_run: boolean; started_at: string }>;
}

export async function qboSummary(run: Run, realmId: string | null): Promise<QboSummary> {
  const [connection] = realmId
    ? await run<QboSummary["connection"] & object>(`SELECT realm_id, environment, state, company_name, last_sync_at::text AS last_sync_at, last_error, cursors FROM qbo_connection WHERE realm_id = $1`, [realmId])
    : await run<QboSummary["connection"] & object>(`SELECT realm_id, environment, state, company_name, last_sync_at::text AS last_sync_at, last_error, cursors FROM qbo_connection ORDER BY updated_at DESC LIMIT 1`);
  const sw = await run<{ key: SyncSwitch; enabled: boolean }>(`SELECT key, enabled FROM qbo_sync_settings`);
  const switches = { import_read: false, export_invoices: false, export_payments: false } as Record<SyncSwitch, boolean>;
  for (const s of sw) switches[s.key] = s.enabled;
  const realm = connection?.realm_id ?? realmId;
  const counts: Record<string, number> = {};
  if (realm) for (const r of await run<{ state: string; n: number }>(`SELECT state, count(*)::int AS n FROM qbo_mappings WHERE realm_id = $1 GROUP BY state`, [realm])) counts[r.state] = r.n;
  const unmapped = realm ? await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE realm_id = $1 AND state = 'unmapped' ORDER BY txn_date DESC NULLS LAST, created_at DESC LIMIT 100`, [realm]) : [];
  const conflicts = realm ? await run<QboMappingRow>(`SELECT ${MAP_COLS} FROM qbo_mappings WHERE realm_id = $1 AND state = 'conflict' ORDER BY updated_at DESC LIMIT 100`, [realm]) : [];
  const batches = realm ? await run<QboSummary["batches"][number]>(`SELECT entity_kind, seen, created, updated, conflicts, dry_run, started_at::text AS started_at FROM qbo_import_batches WHERE realm_id = $1 ORDER BY id DESC LIMIT 20`, [realm]) : [];
  return { connection: connection ?? null, switches, counts, unmapped, conflicts, batches };
}
