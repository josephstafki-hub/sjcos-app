// Shared synthetic fixtures for the WS-field DB tests (zz-* slugs only).
// Not a test file (no .test.mjs suffix), so `npm test` does not run it.

import pg from "pg";

export const run = (client) => async (sql, params) => (await client.query(sql, params)).rows;

/** A real-transaction runner (COMMIT/ROLLBACK) over a fresh client per call. */
export function txOver(url) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const r = async (sql, params) => (await c.query(sql, params)).rows;
    try {
      await c.query("BEGIN");
      const out = await fn(r);
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

/** Wipe everything WS-field writes plus the zz-* fixture rows. */
export async function cleanField(client) {
  await client.query(`TRUNCATE field_reports, field_evidence_requests, field_incidents, schedule_plans, schedule_commitments, buyout_obligations,
    weekly_summaries, weekly_summary_settings, milestone_confirmations, closeout_checklists, client_signoffs, post_project_actions, closeout_actuals,
    publication_rights, marketing_draft_media, document_revisions, job_sites, location_events, designer_activity_events, time_intervals, time_events,
    owner_labor_rates RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM marketing_drafts WHERE title LIKE 'zz-%'`);
  await client.query(`DELETE FROM warranty_claims WHERE project LIKE 'zz-%'`);
  await client.query(`DELETE FROM signature_requests WHERE title LIKE 'zz-%'`);
  await client.query(`DELETE FROM work_items WHERE source_kind = 'field' OR title LIKE 'zz-%'`);
  await client.query(`DELETE FROM plan_designs WHERE name LIKE 'zz-%'`);
  await client.query(`DELETE FROM projects WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM users WHERE email LIKE 'zz-%'`);
  await client.query(`DELETE FROM subs WHERE slug LIKE 'zz-%'`);
  await client.query(`DELETE FROM files WHERE id LIKE 'zz-%'`);
  await client.query(`DELETE FROM app_settings WHERE key IN ('company.warranty_terms','company.google_review_url','owner_time.idle_threshold_seconds')`);
}

/** Owner + two subs, two projects (sub A on p1, sub B on p2, sub C on both), photos. */
export async function seedField(client) {
  const q = run(client);
  const [o] = await q(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  await q(`INSERT INTO subs (slug, name, trade) VALUES ('zz-sub-a','Marco','tile'), ('zz-sub-b','Dee','electrical'), ('zz-sub-c','Multi','carpentry')`);
  const [ua] = await q(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('zz-sub-a@example.test','x','Marco','sub','M','zz-sub-a') RETURNING id`);
  const [ub] = await q(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('zz-sub-b@example.test','x','Dee','sub','D','zz-sub-b') RETURNING id`);
  const [uc] = await q(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('zz-sub-c@example.test','x','Multi','sub','X','zz-sub-c') RETURNING id`);
  const [p1] = await q(`INSERT INTO projects (slug, name, status, client_name, client_email) VALUES ('zz-p1','zz Kitchen One','construction','Pat Client','zz-client1@example.test') RETURNING id`);
  const [p2] = await q(`INSERT INTO projects (slug, name, status, client_name, client_email) VALUES ('zz-p2','zz Bath Two','construction','Sam Client','zz-client2@example.test') RETURNING id`);
  await q(`INSERT INTO project_subs (project_id, sub_slug, role_label) VALUES ($1,'zz-sub-a','tile'), ($2,'zz-sub-b','electrical'), ($1,'zz-sub-c','carpentry'), ($2,'zz-sub-c','carpentry')`, [p1.id, p2.id]);
  for (const [id, key, tag] of [
    ["zz-f1", "zz-p1", "SUB LOG"],
    ["zz-f2", "zz-p1", "SUB LOG"],
    ["zz-f3", "zz-p1", "SUB LOG"],
    ["zz-f4", "zz-p1", "SUB LOG"],
    ["zz-priv", "zz-p1", "MONEY · Private"],
    ["zz-p2-f1", "zz-p2", "SUB LOG"],
  ]) {
    await q(`INSERT INTO files (id, project_key, type, name, tag, storage_path, mime_type) VALUES ($1, $2, 'img', $1 || '.jpg', $3, $1 || '.jpg', 'image/jpeg')`, [id, key, tag]);
  }
  const owner = { kind: "user", userId: o.id, role: "owner", name: "Joe", permissions: [] };
  const subA = { kind: "user", userId: ua.id, role: "sub", name: "Marco", permissions: [], linkSlug: "zz-sub-a" };
  const subB = { kind: "user", userId: ub.id, role: "sub", name: "Dee", permissions: [], linkSlug: "zz-sub-b" };
  const subC = { kind: "user", userId: uc.id, role: "sub", name: "Multi", permissions: [], linkSlug: "zz-sub-c" };
  return { owner, subA, subB, subC, p1: p1.id, p2: p2.id };
}

/** Spy hooks: count calls, keep defaults conservative. */
export function spyHooks(overrides = {}) {
  const calls = { followUps: [], alerts: [], milestones: [], signoffs: [], actuals: [] };
  const hooks = {
    fundingAvailable: async () => ({ ok: true, availableCents: 500000, reason: "test funding" }),
    initialPaymentReceived: async () => false,
    onMilestoneConfirmed: async (_run, projectId, key, decisionId) => {
      calls.milestones.push({ projectId, key, decisionId });
    },
    createFollowUp: async (run, req) => {
      calls.followUps.push(req);
      const [row] = await run(`INSERT INTO work_items (title, body, source_kind, source_id, created_by) VALUES ($1, $2, 'field', $3, 'test') RETURNING id`, [`zz-${req.title}`.slice(0, 200), req.body ?? "", req.dedupeKey ?? null]);
      return row.id;
    },
    notifyOwner: async (a) => {
      calls.alerts.push(a);
    },
    onClientSignoff: async (_run, projectId, sigId) => {
      calls.signoffs.push({ projectId, sigId });
    },
    ingestCloseoutActuals: async (_run, input) => {
      calls.actuals.push(input);
    },
    ...overrides,
  };
  return { hooks, calls };
}
