import "server-only";

// Next.js binding for QuickBooks Online sync (A14): the cron pass, the
// settings page reads and the owner-only review/switch actions. The adapter
// is fake until the Intuit credentials are present (setup item for Joe).

import { withTransaction, runDirect, ownerPrincipalForPolicy } from "@/lib/commands/db";
import {
  fileTokenStore,
  getQboAdapter,
  qboConnectionFile,
  qboConnectionSource,
  qboEnvironment,
  qboOAuthConfigured,
  qboTokenFile,
  resetQboAdapter,
  writeConnectionRecord,
} from "./qbo/index";
import { exchangeCode, qboRedirectUri, revokeToken } from "./qbo/oauth";
import { ensureConnection, importPostedEntities, exportEach, exportIssuedInvoice, exportConfirmedPayment, qboSummary, switchOn, type ImportResult, type QboSummary } from "./qbo/sync";

export async function qboRealmId(): Promise<string> {
  const env = qboEnvironment();
  if (env === "fake") return (process.env.QBO_REALM_ID ?? "").trim() || "fake-realm";
  return qboConnectionSource().realmId ?? "";
}

/** Connection check + status row. Sample data cannot verify a connection.
 *  An owner Disconnect records
 *  'disconnected', not 'error': nothing is wrong, it was turned off. */
export async function refreshQboConnection(): Promise<{ ok: boolean; environment: string; realmId: string; companyName?: string; error?: string }> {
  const env = qboEnvironment();
  const realmId = await qboRealmId();
  if (env === "fake") return {ok: false, environment: env, realmId, error: "Not connected. Ask your account administrator to finish the QuickBooks setup checklist in Settings › Accounting, then connect your company."};
  const src = qboConnectionSource();
  try {
    const info = await getQboAdapter().companyInfo();
    await withTransaction((run) => ensureConnection(run, { realmId: info.realmId || realmId, environment: env, companyName: info.companyName, state: "connected" }));
    return { ok: true, environment: env, realmId: info.realmId || realmId, companyName: info.companyName };
  } catch (err) {
    const msg = (err as Error).message;
    if (realmId) {
      const state = src?.disconnected ? "disconnected" : "error";
      await withTransaction((run) => ensureConnection(run, { realmId, environment: env, state, error: src?.disconnected ? null : msg })).catch(() => undefined);
    }
    return { ok: false, environment: env, realmId, error: msg };
  }
}

/** Finish "Connect to QuickBooks": trade Intuit's one-time code for the
 *  refresh token, keep it in the 0600 token file, remember the chosen
 *  company, then prove the connection and record it. The CSRF state check
 *  happens in the callback route BEFORE this is called. */
export async function completeQboConnect(input: { code: string; realmId: string }): Promise<{ ok: boolean; companyName?: string; error?: string }> {
  const env = qboEnvironment();
  if (env === "fake" || !qboOAuthConfigured()) return { ok: false, error: "Intuit app keys are not set (INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET, QBO_ENV)." };
  if (!/^\d{1,32}$/.test(input.realmId)) return { ok: false, error: "Intuit did not return a valid company id." };
  const clientId = process.env.INTUIT_CLIENT_ID!.trim();
  const clientSecret = process.env.INTUIT_CLIENT_SECRET!.trim();
  let refreshToken: string;
  try {
    ({ refreshToken } = await exchangeCode({ clientId, clientSecret, code: input.code, redirectUri: qboRedirectUri() }));
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  fileTokenStore(qboTokenFile()).save(refreshToken);
  writeConnectionRecord(qboConnectionFile(), { environment: env, realmId: input.realmId, at: new Date().toISOString() });
  resetQboAdapter();
  const r = await refreshQboConnection();
  return r.ok ? { ok: true, companyName: r.companyName } : { ok: false, error: r.error };
}

/** "Disconnect": revoke the app's access at Intuit, forget the token, and
 *  mark the connection off. Every QuickBooks call then refuses with a
 *  reconnect message until Connect runs again, including the env fallback. */
export async function disconnectQbo(): Promise<{ ok: boolean; revoked: boolean; error?: string }> {
  const env = qboEnvironment();
  if (env === "fake") return { ok: false, revoked: false, error: "QuickBooks is in fake mode; there is nothing to disconnect." };
  const src = qboConnectionSource();
  const store = fileTokenStore(qboTokenFile());
  const clientId = process.env.INTUIT_CLIENT_ID!.trim();
  const clientSecret = process.env.INTUIT_CLIENT_SECRET!.trim();
  let revoked = false;
  for (const token of [...new Set([store.load(), src.refreshSeed].filter((t): t is string => Boolean(t)))]) {
    try {
      if ((await revokeToken({ clientId, clientSecret, token })).ok) revoked = true;
    } catch {
      // Network trouble: the local disconnect below still stops every call.
    }
  }
  store.clear();
  writeConnectionRecord(qboConnectionFile(), { environment: env, realmId: src.realmId, disconnected: true, at: new Date().toISOString() });
  resetQboAdapter();
  if (src.realmId) await withTransaction((run) => ensureConnection(run, { realmId: src.realmId!, environment: env, state: "disconnected", error: null }));
  return { ok: true, revoked };
}

/** The timer pass: import (dry-run unless import_read is on), then mirror
 *  issued invoices / settled payments that have no mapping yet (each
 *  direction only when its switch is on). */
export async function runQboSync(opts: { dryRun?: boolean } = {}): Promise<{ environment: string; import: ImportResult; exported: { invoices: number; payments: number; skipped: string[]; failed: string[] } }> {
  const env = qboEnvironment();
  const realmId = await qboRealmId();
  const principal = await ownerPrincipalForPolicy();
  const adapter = getQboAdapter();
  if (env === "fake") await withTransaction((run) => ensureConnection(run, { realmId, environment: env, state: "connected" }));
  else {
    // Prove the connection first (and record it honestly) instead of marking
    // it connected and failing halfway through the import.
    const conn = await refreshQboConnection();
    if (!conn.ok) throw new Error(conn.error ?? "QuickBooks is not connected");
  }
  const imported = await withTransaction((run) => importPostedEntities(run, adapter, { realmId, dryRun: opts.dryRun, principal }));
  const exported = { invoices: 0, payments: 0, skipped: [] as string[], failed: [] as string[] };
  if (await switchOn(runDirect, "export_invoices")) {
    const todo = await runDirect<{ id: number }>(`SELECT i.id::int AS id FROM invoices i WHERE i.status NOT IN ('draft','void') AND (i.external_ref->'qbo'->>'id') IS NULL ORDER BY i.id LIMIT 50`);
    const r = await exportEach(todo.map((t) => t.id), "invoice", (id) => withTransaction((run) => exportIssuedInvoice(run, adapter, { realmId, invoiceId: id, by: "qbo-sync" })));
    exported.invoices = r.created;
    exported.skipped.push(...r.skipped);
    exported.failed.push(...r.failed);
  }
  if (await switchOn(runDirect, "export_payments")) {
    const todo = await runDirect<{ id: number }>(`SELECT p.id::int AS id FROM invoice_payments p WHERE p.kind = 'payment' AND p.status = 'settled' AND (p.external_sync->'qbo'->>'id') IS NULL ORDER BY p.id LIMIT 50`);
    const r = await exportEach(todo.map((t) => t.id), "payment", (id) => withTransaction((run) => exportConfirmedPayment(run, adapter, { realmId, invoicePaymentId: id, by: "qbo-sync" })));
    exported.payments = r.created;
    exported.skipped.push(...r.skipped);
    exported.failed.push(...r.failed);
  }
  // Keep the latest export failure on the connection row, so Settings ›
  // Accounting shows it (with its intuit_tid) without digging in logs.
  if (exported.failed.length && realmId) {
    const note = `${exported.failed.length} export(s) failed; first: ${exported.failed[0]}`.slice(0, 1000);
    await runDirect(`UPDATE qbo_connection SET last_error = $2 WHERE realm_id = $1`, [realmId, note]);
  }
  return { environment: env, import: imported, exported };
}

export async function getQboSummary(): Promise<QboSummary & { environment: string; secrets: Record<string, boolean>; oauthConfigured: boolean; via: "button" | "env" | "none" | "fake"; redirectUri: string }> {
  const env = qboEnvironment();
  const s = await qboSummary(runDirect, (await qboRealmId()) || null);
  return {
    ...s,
    environment: env,
    secrets: Object.fromEntries(["INTUIT_CLIENT_ID", "INTUIT_CLIENT_SECRET"].map((k) => [k, Boolean((process.env[k] ?? "").trim())])),
    oauthConfigured: qboOAuthConfigured(),
    via: env === "fake" ? "fake" : qboConnectionSource().via,
    redirectUri: qboRedirectUri(),
  };
}
