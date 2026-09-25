import "server-only";

// Next.js binding for QuickBooks Online sync (A14): the cron pass, the
// settings page reads and the owner-only review/switch actions. The adapter
// is fake until the Intuit credentials are present (setup item for Joe).

import { withTransaction, runDirect, ownerPrincipalForPolicy } from "@/lib/commands/db";
import { getQboAdapter, qboEnvironment } from "./qbo/index";
import { ensureConnection, importPostedEntities, exportIssuedInvoice, exportConfirmedPayment, qboSummary, switchOn, type ImportResult, type QboSummary } from "./qbo/sync";

export async function qboRealmId(): Promise<string> {
  const env = qboEnvironment();
  if (env === "fake") return (process.env.QBO_REALM_ID ?? "").trim() || "fake-realm";
  return (process.env.QBO_REALM_ID ?? "").trim();
}

/** Connection check + status row (fake mode records a 'fake' connection so
 *  the settings page can say so honestly). */
export async function refreshQboConnection(): Promise<{ ok: boolean; environment: string; realmId: string; companyName?: string; error?: string }> {
  const env = qboEnvironment();
  const realmId = await qboRealmId();
  try {
    const info = await getQboAdapter().companyInfo();
    await withTransaction((run) => ensureConnection(run, { realmId: info.realmId || realmId, environment: env, companyName: info.companyName, state: "connected" }));
    return { ok: true, environment: env, realmId: info.realmId || realmId, companyName: info.companyName };
  } catch (err) {
    const msg = (err as Error).message;
    await withTransaction((run) => ensureConnection(run, { realmId, environment: env, state: "error", error: msg })).catch(() => undefined);
    return { ok: false, environment: env, realmId, error: msg };
  }
}

/** The timer pass: import (dry-run unless import_read is on), then mirror
 *  issued invoices / settled payments that have no mapping yet (each
 *  direction only when its switch is on). */
export async function runQboSync(opts: { dryRun?: boolean } = {}): Promise<{ environment: string; import: ImportResult; exported: { invoices: number; payments: number; skipped: string[] } }> {
  const env = qboEnvironment();
  const realmId = await qboRealmId();
  const principal = await ownerPrincipalForPolicy();
  const adapter = getQboAdapter();
  await withTransaction((run) => ensureConnection(run, { realmId, environment: env, state: env === "fake" ? "connected" : "connected" }));
  const imported = await withTransaction((run) => importPostedEntities(run, adapter, { realmId, dryRun: opts.dryRun, principal }));
  const exported = { invoices: 0, payments: 0, skipped: [] as string[] };
  if (await switchOn(runDirect, "export_invoices")) {
    const todo = await runDirect<{ id: number }>(`SELECT i.id::int AS id FROM invoices i WHERE i.status NOT IN ('draft','void') AND (i.external_ref->'qbo'->>'id') IS NULL ORDER BY i.id LIMIT 50`);
    for (const t of todo) {
      const r = await withTransaction((run) => exportIssuedInvoice(run, adapter, { realmId, invoiceId: t.id, by: "qbo-sync" }));
      if (r.ok && r.created) exported.invoices++;
      else if (!r.ok) exported.skipped.push(`invoice ${t.id}: ${r.reason}`);
    }
  }
  if (await switchOn(runDirect, "export_payments")) {
    const todo = await runDirect<{ id: number }>(`SELECT p.id::int AS id FROM invoice_payments p WHERE p.kind = 'payment' AND p.status = 'settled' AND (p.external_sync->'qbo'->>'id') IS NULL ORDER BY p.id LIMIT 50`);
    for (const t of todo) {
      const r = await withTransaction((run) => exportConfirmedPayment(run, adapter, { realmId, invoicePaymentId: t.id, by: "qbo-sync" }));
      if (r.ok && r.created) exported.payments++;
      else if (!r.ok) exported.skipped.push(`payment ${t.id}: ${r.reason}`);
    }
  }
  return { environment: env, import: imported, exported };
}

export async function getQboSummary(): Promise<QboSummary & { environment: string; secrets: Record<string, boolean> }> {
  const s = await qboSummary(runDirect, await qboRealmId());
  return {
    ...s,
    environment: qboEnvironment(),
    secrets: Object.fromEntries(["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET", "QBO_REALM_ID", "QBO_REFRESH_TOKEN"].map((k) => [k, Boolean((process.env[k] ?? "").trim())])),
  };
}
