// Archiving work items + the queue folders, against a REAL Postgres
// (db/apply-work-item-archive.mjs, lib/engine-views.ts). Same harness as
// estimate-kinds-db.test.mjs:
//
//   FIN_TEST_DATABASE_URL=postgresql://… node --test tests/work-item-archive-db.test.mjs
//
// Skipped without that variable. Everything happens inside ONE transaction that
// is rolled back — the archive migration is applied inside it too (it's
// idempotent), so this runs the same before and after the real migration and
// leaves nothing behind either way.
//
// Two things are checked:
//   1. The table's rule: only a done/cancelled item can be archived, and
//      reopening one by any writer brings it back to the board.
//   2. The folder/filter rules agree in both places they're written — the
//      browser predicate (board) and the SQL twin (Archived view) pick exactly
//      the same rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { STATEMENTS } from "../db/apply-work-item-archive.mjs";
import { ASSIGNEES_JOIN_SQL } from "../lib/work-item-assignees.mjs";
import { NO_FILTER, matchesQueueFilter, queueFilterSql } from "../lib/engine-views.ts";

const url = process.env.FIN_TEST_DATABASE_URL;

test("archive rule + folder filters agree with the database", { skip: !url && "set FIN_TEST_DATABASE_URL to run" }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const run = async (sql, params) => (await client.query(sql, params)).rows;
  try {
    await client.query("BEGIN");
    // The migration takes a brief lock on work_items; never queue a live site
    // behind it.
    await client.query("SET LOCAL lock_timeout = '3s'");
    for (const sql of STATEMENTS) await client.query(sql);

    const [owner] = await run(`SELECT id FROM users WHERE active AND role = 'owner' ORDER BY created_at LIMIT 1`);
    assert.ok(owner, "needs an active owner login");
    const [staff] = await run(
      `INSERT INTO users (email, password_hash, name, role, initials)
       VALUES ('zz-archive-staff@example.com', 'x', 'ZZ Archive Staff', 'staff', 'ZZ') RETURNING id`,
    );
    const [proj] = await run(
      `INSERT INTO projects (slug, name, status, client_name, contract_value, collected_to_date)
       VALUES ('zz-archive-proj', 'ZZ Archive Kitchen', 'construction', 'ZZ Test', 0, 0) RETURNING id`,
    );
    const [lead] = await run(`INSERT INTO leads (slug, name) VALUES ('zz-archive-lead', 'ZZ Archive Deck') RETURNING id`);

    const mk = async (title, over = {}) => {
      const o = { status: "done", kind: "human", key: "human-joe", by: "user", project: null, lead: null, body: "", ...over };
      const [r] = await run(
        `INSERT INTO work_items (title, body, status, assignee_kind, assignee_key, created_by, project_id, lead_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [`ZZ archive ${title}`, o.body, o.status, o.kind, o.key, o.by, o.project, o.lead],
      );
      for (const u of o.people ?? []) {
        await run(`INSERT INTO work_item_assignees (work_item_id, user_id) VALUES ($1,$2)`, [r.id, u]);
      }
      return r.id;
    };
    const archivedAt = async (id) => (await run(`SELECT archived_at FROM work_items WHERE id = $1`, [id]))[0].archived_at;

    // ---- 1. the table's rule
    const open = await mk("open item", { status: "queued" });
    await run(`UPDATE work_items SET archived_at = now() WHERE id = $1`, [open]);
    assert.equal(await archivedAt(open), null, "an open item can't be archived");

    const inserted = await run(
      `INSERT INTO work_items (title, status, archived_at) VALUES ('ZZ archive born open', 'queued', now()) RETURNING archived_at`,
    );
    assert.equal(inserted[0].archived_at, null, "…not even on insert");

    const done = await mk("done item");
    await run(`UPDATE work_items SET archived_at = now() WHERE id = $1`, [done]);
    assert.ok(await archivedAt(done), "a done item archives");
    await run(`UPDATE work_items SET body = 'edited' WHERE id = $1`, [done]);
    assert.ok(await archivedAt(done), "editing an archived item leaves it archived");
    await run(`UPDATE work_items SET status = 'cancelled' WHERE id = $1`, [done]);
    assert.ok(await archivedAt(done), "done → cancelled is still closed, still archived");
    await run(`UPDATE work_items SET status = 'queued' WHERE id = $1`, [done]);
    assert.equal(await archivedAt(done), null, "reopening brings it back to the board");

    // ---- 2. the two filter twins agree
    const ids = [
      await mk("joe own", { by: "inbox-cron", project: proj.id }),
      await mk("abby only", { people: [staff.id], lead: lead.id }),
      await mk("joe and abby", { people: [owner.id, staff.id], body: "50% deposit_due" }),
      await mk("hermes run", { kind: "agent", key: "hermes-telegram", by: "hermes-cron" }),
      await mk("hermes with abby", { kind: "agent", key: "hermes-telegram", people: [staff.id], project: proj.id }),
      await mk("unnamed agent", { kind: "agent", key: null, status: "cancelled" }),
      await mk("claude run", { kind: "agent", key: "claude-code-server", by: "claude-in-app", lead: lead.id }),
    ];
    await run(`UPDATE work_items SET archived_at = now() WHERE id = ANY($1::uuid[])`, [ids]);

    const SELECT = `
      SELECT w.id, w.title, w.body, w.assignee_kind, w.assignee_key, w.created_by,
             p.slug AS project_slug, p.name AS project_name, l.slug AS lead_slug, l.name AS lead_name,
             COALESCE(asg.assigned, '[]'::json) AS assigned
        FROM work_items w
        LEFT JOIN projects p ON p.id = w.project_id
        LEFT JOIN leads l ON l.id = w.lead_id${ASSIGNEES_JOIN_SQL}`;
    const rows = await run(`${SELECT} WHERE w.id = ANY($1::uuid[])`, [ids]);
    assert.equal(rows.length, ids.length);
    const asItem = (r) => ({
      title: r.title,
      body: r.body,
      assigneeKind: r.assignee_kind,
      assigneeKey: r.assignee_key,
      assignedTo: r.assigned.map((a) => ({ userId: a.userId })),
      projectSlug: r.project_slug,
      projectName: r.project_name,
      leadSlug: r.lead_slug,
      leadName: r.lead_name,
      createdBy: r.created_by,
    });

    const filters = [
      NO_FILTER,
      { ...NO_FILTER, who: `person:${owner.id}` },
      { ...NO_FILTER, who: `person:${staff.id}` },
      { ...NO_FILTER, who: "agent:hermes-telegram" },
      { ...NO_FILTER, who: "agent:claude-code-server" },
      { ...NO_FILTER, who: "agent:" },
      { ...NO_FILTER, job: "project:zz-archive-proj" },
      { ...NO_FILTER, job: "lead:zz-archive-lead" },
      { ...NO_FILTER, by: "inbox-cron" },
      { ...NO_FILTER, q: "zz ARCHIVE kitchen" },
      { ...NO_FILTER, q: "50% deposit_" },
      { ...NO_FILTER, q: "5_%" },
      { ...NO_FILTER, who: `person:${staff.id}`, job: "project:zz-archive-proj" },
    ];
    const titlesOf = (rs) => rs.map((r) => r.title).sort();
    for (const f of filters) {
      const params = [ids];
      const conds = ["w.id = ANY($1::uuid[])", "w.archived_at IS NOT NULL", ...queueFilterSql(f, owner.id, params)];
      const fromSql = titlesOf(await run(`${SELECT} WHERE ${conds.join(" AND ")}`, params));
      const fromBrowser = titlesOf(rows.filter((r) => matchesQueueFilter(asItem(r), f, owner.id)));
      assert.deepEqual(fromSql, fromBrowser, `SQL and browser disagree on ${JSON.stringify(f)}`);
    }

    // And the folders hold what they should (not just "both are equally wrong").
    const sqlTitles = async (f) => {
      const params = [ids];
      const conds = ["w.id = ANY($1::uuid[])", ...queueFilterSql(f, owner.id, params)];
      return titlesOf(await run(`${SELECT} WHERE ${conds.join(" AND ")}`, params)).map((t) => t.replace("ZZ archive ", ""));
    };
    assert.deepEqual(await sqlTitles({ ...NO_FILTER, who: `person:${owner.id}` }), ["joe and abby", "joe own"]);
    assert.deepEqual(await sqlTitles({ ...NO_FILTER, who: `person:${staff.id}` }), ["abby only", "hermes with abby", "joe and abby"]);
    assert.deepEqual(await sqlTitles({ ...NO_FILTER, who: "agent:" }), ["unnamed agent"]);
    assert.deepEqual(await sqlTitles({ ...NO_FILTER, q: "5_%" }), [], "% and _ in a search are literal");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
