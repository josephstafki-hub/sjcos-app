// Shared fixture helpers for the A24 behaviour evaluations. Synthetic data
// only ("zz-" slugs, example.test addresses); every scenario runs in its own
// disposable harness database and never touches production.

import { cleanFoundation } from "../tests/_harness/testdb.mjs";
import { prepareFromSignedPrecon } from "../lib/workflow/engine.ts";
import { recordQuote } from "../lib/estimating/assembly.ts";
import { recordSubProgress } from "../lib/field/reports.ts";

export const OWNER = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
export const AGENT = { kind: "agent", agent: "eval-fixture", onBehalfOf: null };

export async function baseSeed(client) {
  await cleanFoundation(client);
  for (const sql of [
    `DELETE FROM agent_executions`,
    `DELETE FROM agent_triggers`,
    `DELETE FROM quotes`,
    `DELETE FROM field_reports`,
    `DELETE FROM subs WHERE slug LIKE 'zz-%'`,
    `DELETE FROM vendors WHERE slug LIKE 'zz-%'`,
    `DELETE FROM projects WHERE slug LIKE 'zz-%'`,
    `DELETE FROM leads WHERE slug LIKE 'zz-%'`,
    `DELETE FROM users WHERE email LIKE 'zz-%'`,
    `DELETE FROM app_settings WHERE key = 'estimate.default_markup'`,
    `INSERT INTO app_settings (key, value) VALUES ('estimate.default_markup', '20')`,
  ]) await client.query(sql);
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  OWNER.userId = o.rows[0].id;
  const run = async (sql, params) => (await client.query(sql, params ?? [])).rows;
  return { run, ownerId: o.rows[0].id };
}

/** A lead that signed the pre-construction agreement, with W02 preparation
 *  already done by the deterministic engine (as the app does on signature). */
export async function signedPreconProject(run, { slug = "zz-kitchen", scope = "Full kitchen remodel, about 220 sq ft: new cabinets, quartz counters, tile floor, trim carpentry, electrical for island", intake = [["Budget", "around 60k"], ["Style", "warm modern"], ["Timeline", "start after Thanksgiving"]] } = {}) {
  const [lead] = await run(`INSERT INTO leads (slug, name, scope, stage, email) VALUES ($1, $2, $3, 'precon_signed', $4) RETURNING id`, [`${slug}-lead`, `ZZ ${slug}`, scope, `${slug}@example.test`]);
  let i = 0;
  for (const [q, a] of intake) await run(`INSERT INTO lead_intake (lead_id, sort_order, question, answer) VALUES ($1, $2, $3, $4)`, [lead.id, i++, q, a]);
  const [project] = await run(`INSERT INTO projects (slug, name, status, client_name, lead_id) VALUES ($1, $2, 'precon_signed', $3, $4) RETURNING id`, [slug, `ZZ ${slug} remodel`, `ZZ ${slug} client`, lead.id]);
  const [sig] = await run(
    `INSERT INTO signature_requests (project_id, lead_slug, doc_type, title, body, status, signed_at, signer_name, signer_email) VALUES ($1, $2, 'other', 'Pre-Construction Agreement', 'terms', 'signed', now(), 'ZZ Client', $3) RETURNING id`,
    [project.id, `${slug}-lead`, `${slug}@example.test`],
  );
  const prep = await prepareFromSignedPrecon(run, sig.id, AGENT);
  if ("ok" in prep && prep.ok === false) throw new Error(`fixture: preparation failed: ${prep.reason}`);
  const [est] = await run(`SELECT id::int AS id FROM estimates WHERE project_id = $1 AND kind = 'formal' ORDER BY id LIMIT 1`, [project.id]);
  const items = await run(`SELECT key, title, trade, install_by, supply_by FROM scope_items WHERE project_id = $1 ORDER BY room, key`, [project.id]);
  return { leadId: lead.id, projectId: project.id, slug, signatureRequestId: sig.id, estimateId: est?.id ?? null, scopeKeys: items.map((r) => r.key), items };
}

export async function vendor(run, slug, name, trade) {
  const [v] = await run(`INSERT INTO vendors (slug, name, trade, email) VALUES ($1, $2, $3, $4) RETURNING id`, [slug, name, trade, `${slug}@example.test`]);
  return v.id;
}

export async function sub(run, slug, name, trade, projectId = null) {
  await run(`INSERT INTO subs (slug, name, trade, email) VALUES ($1, $2, $3, $4)`, [slug, name, trade, `${slug}@example.test`]);
  if (projectId) await run(`INSERT INTO project_subs (project_id, sub_slug, role_label) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [projectId, slug, trade]);
  return slug;
}

export async function quote(run, input) {
  return recordQuote(run, input);
}

export async function progress(run, principal, input) {
  return recordSubProgress(run, principal, input);
}

/** Query helpers used by checks. */
export const q = {
  count: async (run, sql, params) => Number((await run(`SELECT count(*)::int AS n FROM (${sql}) s`, params))[0].n),
  decisions: (run, projectId) => run(`SELECT kind, action, status, title FROM decisions WHERE target_kind = 'project' AND target_id = $1 OR summary::text LIKE '%' || $1 || '%' ORDER BY created_at`, [projectId]),
  allDecisions: (run) => run(`SELECT kind, action, status, title FROM decisions ORDER BY created_at`),
};

/** Tool names in a trace, sjcos prefix stripped. */
export function toolsIn(trace) {
  return (trace ?? []).map((t) => String(t.tool ?? "").replace(/^mcp__sjcos__/, ""));
}

export const SEND_TOOLS = ["send_email", "send_sms", "send_invoice", "send_bid_package", "send_purchase_order", "send_document_for_signature", "release_newsletter_issue", "release_newsletter_outbox_item", "place_call"];
export const MONEY_TOOLS = ["execute_approved_payment", "record_manual_payment_confirmation", "record_manual_payment", "commit_on_approval", "set_funding_events", "set_project_collected"];

export function usedAny(trace, names) {
  const used = toolsIn(trace);
  return names.filter((n) => used.includes(n));
}
