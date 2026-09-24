// Shared synthetic fixtures for the WS-procurement DB tests (A11/A12/A13).
// Everything is zz-* and gets wiped by cleanProcurement(); no production data.
import pg from "pg";
import { cleanFoundation } from "./_harness/testdb.mjs";

export const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
export const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: owner };
export const unattended = { kind: "agent", agent: "hermes", runId: null, onBehalfOf: null };

export const runOver = (client) => async (sql, params) => (await client.query(sql, params)).rows;

/** Real BEGIN/COMMIT per call on a fresh client (mirrors lib/commands/db.ts). */
export function txOver(url) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const run = runOver(c);
    try {
      await c.query("BEGIN");
      const out = await fn(run);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      await c.end();
    }
  };
}

export async function cleanProcurement(client) {
  await cleanFoundation(client);
  await client.query(`TRUNCATE commitments, deliveries, bills, cash_reservations, company_funding_approvals, payee_validations,
    sub_document_requests, lead_facts, lead_followups, estimate_input_packages, lead_intake_reviews, communication_optouts RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM sub_documents WHERE sub_slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM subs WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM vendors WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM files WHERE id LIKE 'zz-%'`);
  await client.query(`DELETE FROM newsletter_recipients WHERE email LIKE 'zz-%'`);
  await client.query(`DELETE FROM communication_optouts WHERE address LIKE 'zz-%'`).catch(() => {});
  await client.query(`DELETE FROM work_items WHERE source_id LIKE 'bill:%' OR title LIKE 'zz-%'`);
}

export async function seedOwner(client) {
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  owner.userId = o.rows[0].id;
  return owner;
}

export async function seedProject(client, slug = "zz-proj", opts = {}) {
  const p = await client.query(
    `INSERT INTO projects (slug, name, client_name, contract_value, collected_to_date, status) VALUES ($1, $2, 'ZZ Client', 5000000, $3, 'construction') RETURNING id`,
    [slug, opts.name ?? "ZZ Test House", opts.collectedToDate ?? 0],
  );
  const id = p.rows[0].id;
  if (opts.signed !== false) {
    await client.query(`INSERT INTO signature_requests (project_id, doc_type, title, status, signed_at) VALUES ($1, 'contract', 'Construction agreement', 'signed', now())`, [id]);
  }
  if (opts.collectedCents != null) {
    const inv = await client.query(`INSERT INTO invoices (project_id, number, milestone, amount, status, sent_at, paid_at) VALUES ($1, 'INV-001', 'Initial', $2, 'paid', now(), now()) RETURNING id`, [id, opts.collectedCents]);
    await client.query(`INSERT INTO invoice_payments (invoice_id, kind, amount_cents, method, status) VALUES ($1, 'payment', $2, 'check', 'settled')`, [inv.rows[0].id, opts.collectedCents]);
  }
  return id;
}

export async function seedVendor(client, slug = "zz-siweck", opts = {}) {
  const v = await client.query(`INSERT INTO vendors (slug, name, trade, email, notes) VALUES ($1, $2, 'Lumber', $3, $4) RETURNING id`, [
    slug,
    opts.name ?? "ZZ Siweck Lumber",
    opts.email ?? `${slug}@example.test`,
    opts.notes ?? "",
  ]);
  return v.rows[0].id;
}

export async function seedSub(client, slug = "zz-sub-a", opts = {}) {
  await client.query(`INSERT INTO subs (slug, name, trade, email, coi_status, coi_expires_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    slug,
    opts.name ?? `ZZ Sub ${slug.slice(-1).toUpperCase()}`,
    opts.trade ?? "Electrical",
    opts.email ?? `${slug}@example.test`,
    opts.coiStatus ?? "missing",
    opts.coiExpiresAt ?? null,
  ]);
  return slug;
}

export async function seedPO(client, projectId, vendorId, lines, opts = {}) {
  const po = await client.query(
    `INSERT INTO purchase_orders (project_id, po_number, vendor_kind, vendor_id, vendor_name, title, status, tax_cents, shipping_cents, terms, need_by)
     VALUES ($1, $2, 'vendor', $3, 'snapshot name', $4, 'draft', $5, $6, $7, $8) RETURNING id`,
    [projectId, opts.number ?? "PO-001", vendorId, opts.title ?? "Framing package", opts.taxCents ?? 0, opts.shippingCents ?? 0, opts.terms ?? "Net 30", opts.needBy ?? null],
  );
  const id = Number(po.rows[0].id);
  let sort = 0;
  for (const l of lines) {
    await client.query(
      `INSERT INTO purchase_order_lines (purchase_order_id, description, unit, qty_ordered, unit_cost, extended, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, l.description, l.unit ?? "ea", l.qty, l.unitCents, Math.round(l.qty * l.unitCents), sort++],
    );
  }
  await client.query(`UPDATE purchase_orders SET subtotal = (SELECT COALESCE(sum(extended),0) FROM purchase_order_lines WHERE purchase_order_id = $1) WHERE id = $1`, [id]);
  return id;
}

export async function seedFile(client, id, opts = {}) {
  await client.query(`INSERT INTO files (id, project_key, type, name, storage_path, mime_type, lead_slug) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`, [
    id,
    opts.projectKey ?? "",
    opts.type ?? "doc",
    opts.name ?? `${id}.pdf`,
    opts.storagePath === null ? null : (opts.storagePath ?? `${id}.pdf`),
    opts.mime ?? "application/pdf",
    opts.leadSlug ?? null,
  ]);
  return id;
}

export async function activateRoutinePolicy(client) {
  await client.query(
    `INSERT INTO policies (key, version, config, state, created_by, notes, effective_from) VALUES ('routine.followup', 1,
      '{"lane":"routine_followup","tz":"America/Chicago","window":{"days":[1,2,3,4,5],"start":"09:00","end":"17:00"},
        "cadence":{"minHoursBetween":48,"maxPerRecipientPerWeek":2},"stop":["reply","decline","opt_out","pending_owner_decision"]}'::jsonb,
      'active', 'test', '', now() - interval '1 day')
     ON CONFLICT (key, version) DO UPDATE SET state = 'active', effective_from = now() - interval '1 day'`,
  );
}

/** Wednesday 2026-09-23 10:00 America/Chicago (inside the seeded window). */
export const IN_WINDOW = new Date("2026-09-23T15:00:00Z");
/** Sunday 2026-09-27 10:00 America/Chicago (outside). */
export const OUT_OF_WINDOW = new Date("2026-09-27T15:00:00Z");
