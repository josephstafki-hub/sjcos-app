// Shared conversation summaries (lib/comms-summaries.ts): a record's "Calls &
// texts" card lists every line's calls and texts, opening only the ones the
// viewer may read, and never quoting another member's line without a summary.
// Own file: lib/db's pool is per process, and this one runs as the website login.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const MAIN = "+19995550100";
const ABBY_LINE = "+19995550200";
const CLIENT = "+19995550123";

test("a lead's Calls & texts card shows every line's conversations, opening only the ones the viewer may read", { skip }, async () => {
  await withTestDb(
    async (url, client) => {
      process.env.DATABASE_URL = url; // the website login (listPhoneLines joins users.name)
      const own = async (sql, params) => (await client.query(sql, params)).rows;
      const [joe] = await own(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-pl2-joe@example.test','x','Joe Stafki','owner','JS') RETURNING id`);
      const [abby] = await own(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-pl2-abby@example.test','x','Abigail Stafki','staff','AS','{comms,leads}') RETURNING id`);
      const [ben] = await own(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-pl2-ben@example.test','x','Ben Crew','staff','BC','{comms,leads}') RETURNING id`);
      await own(`DELETE FROM phone_lines`);
      await own(`INSERT INTO phone_lines (number, label, is_company_default) VALUES ($1, 'SJC main line', true)`, [MAIN]);
      await own(`INSERT INTO phone_lines (number, label, assigned_user_id) VALUES ($1, '', $2)`, [ABBY_LINE, abby.id]);
      const [lead] = await own(`INSERT INTO leads (slug, name, phone, scope, stage) VALUES ('zz-pl2-lead', 'Kim Lead', $1, 'Deck', 'intake') RETURNING id`, [CLIENT]);
      const [t] = await own(
        `INSERT INTO sms_threads (phone, contact_name, business_number, link_type, link_slug, last_message_at, summary)
         VALUES ($1, 'Kim Lead', $2, 'lead', 'zz-pl2-lead', now() - interval '1 hour', 'Kim wants the deck started in May; Abby will send dates.') RETURNING id`,
        [CLIENT, ABBY_LINE],
      );
      await own(`INSERT INTO sms_messages (thread_id, direction, body, created_at) VALUES ($1, 'in', 'Can we start in May?', now() - interval '1 hour')`, [t.id]);
      await own(
        `INSERT INTO calls (direction, counterparty_number, business_number, contact_name, lead_id, status, outcome, duration_s, notes, started_at)
         VALUES ('inbound', $1, $2, 'Kim Lead', $3, 'completed', 'answered', 240, '{"summary":"Talked budget and railing options."}'::jsonb, now() - interval '2 hours')`,
        [CLIENT, MAIN, lead.id],
      );

      const { importApp } = await import("../lib/worker/load-app.mjs");
      const { getRecordConversations } = await importApp("lib/comms-summaries.ts");

      const forJoe = await getRecordConversations("lead", "zz-pl2-lead", { id: joe.id, role: "owner" });
      assert.equal(forJoe.length, 2);
      assert.equal(forJoe[0].kind, "text", "newest first");
      assert.equal(forJoe[0].line, "Abigail's line");
      assert.equal(forJoe[0].summary, "Kim wants the deck started in May; Abby will send dates.");
      assert.match(forJoe[0].href ?? "", /^\/messages\?thread=/);
      assert.equal(forJoe[1].kind, "call");
      assert.equal(forJoe[1].line, "SJC main line");
      assert.equal(forJoe[1].summary, "Talked budget and railing options.");
      assert.match(forJoe[1].title, /talked 4 min/);

      const forBen = await getRecordConversations("lead", "zz-pl2-lead", { id: ben.id, role: "staff" });
      assert.equal(forBen.length, 2, "Ben still sees that the conversation happened");
      assert.equal(forBen[0].href, null, "but can't open Abby's line");
      assert.equal(forBen[0].summary, "Kim wants the deck started in May; Abby will send dates.");
      assert.ok(forBen[1].href, "the main line's call opens for everyone");

      // No AI summary yet: Ben gets counts, never the words from Abby's line.
      await own(`UPDATE sms_threads SET summary = NULL WHERE id = $1`, [t.id]);
      const [benText] = await getRecordConversations("lead", "zz-pl2-lead", { id: ben.id, role: "staff" });
      assert.doesNotMatch(benText.summary, /May/);
      const [abbyText] = await getRecordConversations("lead", "zz-pl2-lead", { id: abby.id, role: "staff" });
      assert.match(abbyText.summary, /Can we start in May/);
    },
    { fresh: true },
  );
});
