// The narrow logins can actually do their jobs (deploy/db-roles.md).
//
//   • sjcos_agent: the REAL MCP server (mcp/sjcos-mcp.mjs over stdio) connected
//     with DATABASE_URL_AGENT = a harness URL that runs every connection as
//     sjcos_agent, driving a representative set of read and write tools.
//   • sjcos_worker: the worker's own code paths (heartbeat + sweeps, Telnyx
//     inbound SMS, a Square payment completing → invoice paid → job money
//     ledger trigger, the receipt it queues) on a connection that runs as
//     sjcos_worker.
//
// A new tool or worker step that writes a table its login can't reach fails
// HERE with "permission denied for table X": add the table's privilege to
// deploy/db-roles.manifest.json and the sjcos_grant(...) line to your
// migration (node scripts/db-roles-sql.mjs X), or stage the write for Joe.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { withTestDb, harnessAvailable, urlAsRole, REPO } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
const DENIED = /permission denied|may not do this|insufficient_privilege|row-level security/i;
const parse = (r) => {
  const text = (r.content ?? []).map((c) => c.text ?? "").join("\n");
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
};

async function seed(client) {
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];
  await one(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-roles-owner@example.test', 'x', 'Joe', 'owner', 'J') ON CONFLICT DO NOTHING RETURNING id`);
  const lead = await one(`INSERT INTO leads (slug, name, email, scope, stage) VALUES ('zz-roles-lead', 'Pat Roles', 'pat@example.test', 'Kitchen remodel', 'intake') RETURNING id`);
  await one(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('lead-zz-roles-lead@client-portal.invalid', 'x', 'Pat Roles', 'client', 'P', 'lead:zz-roles-lead') RETURNING id`);
  const proj = await one(`INSERT INTO projects (slug, name, status, client_name, client_email) VALUES ('zz-roles-job', 'ZZ Roles Job', 'construction', 'Sam Roles', 'sam@example.test') RETURNING id`);
  const est = await one(`INSERT INTO estimates (project_id, kind, status, title) VALUES ($1, 'formal', 'draft', 'Formal') RETURNING id`, [proj.id]);
  const wi = await one(`INSERT INTO work_items (title, status, project_id) VALUES ('ZZ roles to-do', 'queued', $1) RETURNING id`, [proj.id]);
  const draftWi = await one(`INSERT INTO work_items (title, status, project_id) VALUES ('ZZ roles draft', 'queued', $1) RETURNING id`, [proj.id]);
  return { leadId: lead.id, projectId: proj.id, estimateId: Number(est.id), workItemId: wi.id, draftWorkItemId: draftWi.id };
}

test("sjcos_agent: the real MCP server reads and writes what agents need, and nothing refuses it", { skip }, async () => {
  await withTestDb(
    async (url, client) => {
      const ids = await seed(client);
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(REPO, "mcp", "sjcos-mcp.mjs")],
        cwd: REPO,
        // A bare env, as Hermes / sjcos-mcp.service give it: no SJC_DB_LOGIN →
        // the narrow login. DATABASE_URL points at a dead port so a fall-through
        // to the master URL fails loudly instead of passing.
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          MCP_HTTP_PORT: "0",
          SJC_OUTBOUND_DISABLED: "1",
          APP_INTERNAL_URL: "http://127.0.0.1:9",
          CRON_SECRET: "zz-dead",
          SJC_ASK_DEFAULT_TIMEOUT_S: "1",
          SJC_ASK_MAX_TIMEOUT_S: "1",
          SJCOS_ENV: "/dev/null",
          DATABASE_URL: "postgresql://nobody@127.0.0.1:9/none?application_name=sjc_test_harness",
          DATABASE_URL_AGENT: urlAsRole(url, "sjcos_agent"),
        },
        stderr: "pipe",
      });
      const mcp = new Client({ name: "db-roles-paths", version: "1" });
      await mcp.connect(transport);
      const failures = [];
      const call = async (name, args = {}, { mustSucceed = true } = {}) => {
        const r = parse(await mcp.callTool({ name, arguments: args }));
        if (DENIED.test(r.text)) failures.push(`${name}: ${r.text.replace(/\s+/g, " ").slice(0, 240)}`);
        else if (mustSucceed && (r.json === null || r.json.ok === false || r.json.error)) failures.push(`${name} did not succeed: ${r.text.replace(/\s+/g, " ").slice(0, 240)}`);
        return r.json;
      };
      try {
        // reads across the business
        for (const [name, args] of [
          ["business_snapshot", {}],
          ["get_today_queue", {}],
          ["list_projects", {}],
          ["get_project", { slug: "zz-roles-job" }],
          ["get_operating_context", { project_slug: "zz-roles-job" }],
          ["list_leads", {}],
          ["get_lead", { slug: "zz-roles-lead" }],
          ["list_work_items", {}],
          ["get_work_item", { id: ids.workItemId }],
          ["list_users", {}],
          ["list_owner_permissions", {}],
          ["list_pending_decisions", {}],
          ["get_project_financials", { project_slug: "zz-roles-job" }],
          ["company_financials", {}],
          ["list_project_estimates", { project_slug: "zz-roles-job" }],
          ["list_project_files", { project_slug: "zz-roles-job" }],
          ["search_knowledge", { query: "kitchen" }],
          ["list_skills", {}],
          ["list_runbooks", {}],
          ["list_agent_memories", {}],
          ["measurement_summary", {}],
        ]) {
          await call(name, args, { mustSucceed: false });
        }
        // writes agents make every day
        const wi = await call("create_work_item", { title: "ZZ agent-made to-do", project_slug: "zz-roles-job" });
        await call("update_work_item_status", { id: ids.workItemId, status: "in_progress" });
        await call("snooze_work_item", { id: ids.workItemId, until: "2026-12-01", reason: "zz" }, { mustSucceed: false });
        await call("assign_work_item", { id: wi?.id ?? ids.workItemId });
        await call("capture_knowledge", { content: "ZZ roles: the client prefers mornings.", project_slug: "zz-roles-job" });
        await call("record_agent_run", { runtime_name: "zz-roles", status: "succeeded", summary: "zz" });
        await call("record_receipt", { receipt_kind: "note", summary: "zz roles receipt" });
        await call("submit_draft_for_approval", { work_item_id: ids.draftWorkItemId, draft: "To: sam@example.test\nSubject: ZZ\n\nHello Sam." });
        await call("stage_decision", { kind: "other", decision_action: "zz_roles", title: "ZZ roles decision", project_slug: "zz-roles-job" }, { mustSucceed: false });
        await call("add_estimate_lines", { estimate_id: ids.estimateId, lines: [{ description: "ZZ framing", qty: 2, unit_cost_cents: 15000 }] });
        await call("add_expense", { project_slug: "zz-roles-job", vendor: "ZZ Lumber", kind: "material", amount_cents: 4200, date: "2026-10-30" });
        await call("save_lead_rough_estimate", { slug: "zz-roles-lead", lines: [{ label: "Cabinets", value: "$12,000" }], total: "$12,000" });
        await call("create_skill_proposal", { slug: "zz-roles-skill", title: "ZZ roles skill", body_markdown: "Do the thing." }, { mustSucceed: false });
        await call("remember_agent_instruction", { content: "ZZ roles: always confirm the address." });
        await call("record_workflow_event", { project_slug: "zz-roles-job", kind: "site_notes", ref: "zz-roles" }, { mustSucceed: false });
        await call("save_project_file", { project_slug: "zz-roles-job", filename: "zz-roles.md", content: "notes" });
        await call("create_invoice_draft", { project_slug: "zz-roles-job", kind: "other", milestone: "ZZ", lines: [{ label: "ZZ", amount_cents: 1000 }] }, { mustSucceed: false });
        await call("create_purchase_order", { project_slug: "zz-roles-job", title: "ZZ PO", vendor_name: "ZZ Lumber" }, { mustSucceed: false });
        await call("prepare_tentative_schedule", { project_slug: "zz-roles-job", phases: [{ key: "demo", label: "Demo", durationDays: 2 }] }, { mustSucceed: false });
        await call("procedure_checks", {}, { mustSucceed: false });
        // converting a lead moves its client portal login (owner-run helper)
        const created = await call("create_project", { lead_slug: "zz-roles-lead" });
        if (created?.slug) {
          const [moved] = (await client.query(`SELECT link_slug FROM users WHERE email = $1`, [`${created.slug}@client-portal.invalid`])).rows;
          if (moved?.link_slug !== created.slug) failures.push(`create_project: the client login did not follow the lead (link_slug ${moved?.link_slug ?? "missing"})`);
        }
        // and the refusals still refuse
        const denied = parse(await mcp.callTool({ name: "create_user", arguments: { name: "ZZ", email: "zz-roles-new@example.test" } }));
        assert.match(denied.text, /Only Joe/);
      } finally {
        await mcp.close();
      }
      assert.deepEqual(failures, [], `\n${failures.join("\n")}\n`);
      // the writes really landed, as sjcos_agent
      const n = async (sql, p) => Number((await client.query(sql, p)).rows[0].n);
      assert.equal(await n(`SELECT count(*) AS n FROM work_items WHERE title = 'ZZ agent-made to-do'`), 1);
      assert.equal(await n(`SELECT count(*) AS n FROM estimate_lines WHERE estimate_id = $1`, [ids.estimateId]), 1);
      assert.equal(await n(`SELECT count(*) AS n FROM app_settings WHERE key = 'measure.known_tools'`), 1, "procedure_checks recorded its tool list through the helper");
    },
    { fresh: true },
  );
});

test("sjcos_worker: heartbeat, Telnyx inbound SMS and a Square payment completing all work as the worker login", { skip }, async () => {
  await withTestDb(
    async (url, client) => {
      const workerUrl = urlAsRole(url, "sjcos_worker");
      // The worker's app modules (lib/db.ts) read DATABASE_URL, as in scripts/sjcos-worker.mjs.
      process.env.DATABASE_URL = workerUrl;
      process.env.SJC_OUTBOUND_DISABLED = "1";
      const { importApp } = await import("../lib/worker/load-app.mjs");
      const { runOnce, WORKER_NAME } = await importApp("lib/worker/loop.ts");
      const { registerWorker } = await importApp("lib/worker/registry.ts");
      const { telnyxProcessor } = await importApp("lib/worker/telnyx-processor.ts");
      const { squareProcessor } = await importApp("lib/worker/square-processor.ts");
      const { recordSourceEvent } = await importApp("lib/commands/source-events.ts");
      const billing = await importApp("lib/billing/core.ts");
      const payments = await importApp("lib/payments/service.ts");
      const { fakeSquare } = await importApp("lib/payments/square/fake.ts");
      const { getSquareAdapter } = await importApp("lib/payments/square/index.ts");

      // Setup as the owner (this superuser): a job, its client, an issued invoice
      // and a pending bank-transfer payment, as the portal would leave them.
      const ownerRun = async (sql, params) => (await client.query(sql, params)).rows;
      const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
      const [o] = await ownerRun(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-w-owner@example.test','x','Joe','owner','J') RETURNING id`);
      owner.userId = o.id;
      const [p] = await ownerRun(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-w-job', 'ZZ W Job', 'construction', 'ZZ') RETURNING id`);
      await ownerRun(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('zz-w-client@example.test','x','ZZ Client','client','Z','zz-w-job')`);
      const ownerTx = async (fn) => {
        await client.query("BEGIN");
        try {
          const out = await fn(ownerRun);
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      };
      fakeSquare.reset();
      const { invoice } = await ownerTx((r) => billing.issueMilestoneInvoice(r, { projectId: p.id, economicKey: "draw:1:zz", milestone: "Deposit", amountCents: 50000, source: "draw", principal: owner }));
      await ownerTx((r) => billing.recordDeliveryOutcome(r, { invoiceId: invoice.id, ok: true, principal: owner }));
      const adapter = getSquareAdapter();
      const prep = await ownerTx((r) => payments.prepareAttempt(r, { invoiceId: invoice.id, method: "ach", nonce: "zz-w-nonce-0001", actor: "portal:client" }));
      const outcome = await payments.chargeAttempt(adapter, prep.attempt, { sourceId: "bauth:ok", locationId: "L1" });
      await ownerTx((r) => payments.applyProviderPayment(r, { attemptId: prep.attempt.id, payment: outcome.payment, actor: "portal:client" }));
      fakeSquare.setStatus(outcome.payment.id, "COMPLETED");
      const evt = JSON.parse(fakeSquare.webhookEvent("payment.updated", outcome.payment.id).body);
      await recordSourceEvent(ownerRun, { provider: "square", account: "zz", eventId: evt.event_id, eventType: evt.type, payload: evt, verified: true });
      const sms = { data: { event_type: "message.received", id: "zz-w-sms-1", payload: { id: "zz-w-msg-1", direction: "inbound", from: { phone_number: "+19995550123" }, to: [{ phone_number: "+19995550100" }], text: "Running 10 min late" } } };
      await recordSourceEvent(ownerRun, { provider: "telnyx", account: "zz", eventId: "zz-w-sms-1", eventType: "message.received", payload: sms, verified: true });

      // Everything below runs as sjcos_worker.
      const pool = new pg.Pool({ connectionString: workerUrl, max: 2 });
      try {
        const run = async (sql, params) => (await pool.query(sql, params)).rows;
        const [who] = await run(`SELECT current_user AS u`);
        assert.equal(who.u, "sjcos_worker");
        const instanceId = "zz-roles-worker";
        await registerWorker(run, { name: WORKER_NAME, instanceId, version: "test" });
        const r = await runOnce({ run, name: WORKER_NAME, instanceId, version: "test", processors: [telnyxProcessor, squareProcessor], dispatcher: null, wakeupDrainer: null, stopFile: "/nonexistent/zz", log: () => {}, limits: { idleSleepMs: 0 } });
        assert.equal(r.error ?? null, null, `worker iteration failed: ${r.error}`);
        const events = await run(`SELECT provider, state, last_error FROM source_events WHERE account = 'zz' ORDER BY provider`);
        assert.equal(events.length, 2);
        for (const e of events) assert.equal(e.state, "done", `${e.provider} event: ${e.state} ${e.last_error ?? ""}`);
        const [inv] = await run(`SELECT status FROM invoices WHERE id = $1`, [invoice.id]);
        assert.equal(inv.status, "paid", "the Square completion paid the invoice");
        const [msg] = await run(`SELECT count(*)::int AS n FROM sms_messages WHERE provider_sid = 'zz-w-msg-1'`);
        assert.equal(msg.n, 1, "the inbound text was recorded");
        // the ledger trigger (SECURITY DEFINER) moved the job's paid amount
        const [job] = (await client.query(`SELECT collected_to_date FROM projects WHERE id = $1`, [p.id])).rows;
        assert.ok(Number(job.collected_to_date) > 0, "job money ledger followed the payment");
      } finally {
        await pool.end();
      }
    },
    { fresh: true },
  );
});
