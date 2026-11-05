// Phone lines (0110): one main line + lines assigned to team members.
//
//   • An inbound text lands in a thread per (person, our number); a text to a
//     team member's own line goes to THEIR bell, not Joe's push.
//   • STOP on one line opts the person out on every line.
//   • The owner reads every line; a team member reads the company lines and
//     their own, never another member's.
//   • The worker (narrow login) can route a number to the line's person and
//     their cell through phone_line_route() without reading users.phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, urlAsRole } from "./_harness/testdb.mjs";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const MAIN = "+19995550100";
const ABBY_LINE = "+19995550200";
const ABBY_CELL = "+19995550111";
const CLIENT = "+19995550123";

const inbound = (id, to, text) => ({
  data: { event_type: "message.received", id: `ev-${id}`, payload: { id: `msg-${id}`, direction: "inbound", from: { phone_number: CLIENT }, to: [{ phone_number: to }], text } },
});

test("texts follow the line they came in on, notify the line's person, and stay visible only to the right logins", { skip }, async () => {
  await withTestDb(
    async (url, client) => {
      process.env.DATABASE_URL = urlAsRole(url, "sjcos_worker");
      process.env.SJC_OUTBOUND_DISABLED = "1";
      process.env.SMS_HELP_AUTOREPLY = "off";
      const own = async (sql, params) => (await client.query(sql, params)).rows;
      const [joe] = await own(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-pl-joe@example.test','x','Joe Stafki','owner','JS') RETURNING id`);
      const [abby] = await own(`INSERT INTO users (email, password_hash, name, role, initials, phone, permissions) VALUES ('zz-pl-abby@example.test','x','Abigail Stafki','staff','AS',$1,'{comms}') RETURNING id`, [ABBY_CELL]);
      const [ben] = await own(`INSERT INTO users (email, password_hash, name, role, initials, permissions) VALUES ('zz-pl-ben@example.test','x','Ben Crew','staff','BC','{comms}') RETURNING id`);
      await own(`DELETE FROM phone_lines`);
      await own(`INSERT INTO phone_lines (number, label, is_company_default) VALUES ($1, 'SJC main line', true)`, [MAIN]);
      await own(`INSERT INTO phone_lines (number, label, assigned_user_id) VALUES ($1, 'Abby', $2)`, [ABBY_LINE, abby.id]);

      const { importApp } = await import("../lib/worker/load-app.mjs");
      const { parseMessagingEvent } = await importApp("lib/comms/sms-inbound.ts");
      const sms = await importApp("lib/sms.ts");
      const lines = await importApp("lib/phone-lines.ts");

      // Routing as the worker: Abby's line rings Abby's cell.
      const route = await lines.routeForNumber(ABBY_LINE);
      assert.equal(route?.assignedUserId, abby.id);
      assert.equal(route?.forwardTo, ABBY_CELL);
      assert.equal(await lines.companyLineNumber(), MAIN);
      assert.equal(await lines.outboundNumberFor(abby.id, "sms"), ABBY_LINE);
      assert.equal(await lines.outboundNumberFor(ben.id, "sms"), MAIN);
      assert.equal(await lines.outboundNumberFor(null, "voice"), MAIN);

      const a = await sms.recordInboundSms(parseMessagingEvent(inbound("1", ABBY_LINE, "Can Abby come Tuesday?")));
      const m = await sms.recordInboundSms(parseMessagingEvent(inbound("2", MAIN, "Also, invoice question")));
      assert.notEqual(a.threadId, m.threadId, "one conversation per line");
      const threads = await own(`SELECT id, business_number FROM sms_threads WHERE phone = $1 ORDER BY id`, [CLIENT]);
      assert.deepEqual(threads.map((t) => t.business_number).sort(), [ABBY_LINE, MAIN].sort());

      // (notifications.ref comes from db/apply-notifications-v2.mjs, not the
      // migrations, so match on the link.)
      const bell = await own(`SELECT audience_user_id FROM notifications WHERE href = $1`, [`/messages?thread=${a.threadId}`]);
      assert.equal(bell.length, 1, "Abby's line text goes to her bell");
      assert.equal(bell[0].audience_user_id, abby.id);

      // Visibility: Joe all, Abby company + hers, Ben company only.
      const ids = async (viewer) => (await sms.getSmsThreads(viewer)).filter((t) => t.phone === CLIENT).map((t) => t.businessNumber).sort();
      assert.deepEqual(await ids({ id: joe.id, role: "owner" }), [ABBY_LINE, MAIN].sort());
      assert.deepEqual(await ids({ id: abby.id, role: "staff" }), [ABBY_LINE, MAIN].sort());
      assert.deepEqual(await ids({ id: ben.id, role: "staff" }), [MAIN]);
      assert.equal(await sms.smsThreadVisibleTo({ id: ben.id, role: "staff" }, a.threadId), false);
      assert.equal(await sms.getSmsThread(a.threadId, { id: ben.id, role: "staff" }), null);
      assert.ok(await sms.getSmsThread(a.threadId, { id: abby.id, role: "staff" }));
      assert.equal(await sms.getUnreadSmsCount({ id: ben.id, role: "staff" }), 1);
      assert.equal(await sms.getUnreadSmsCount({ id: joe.id, role: "owner" }), 2);

      // STOP on the main line opts them out on Abby's line too.
      await sms.recordInboundSms(parseMessagingEvent(inbound("3", MAIN, "STOP")));
      const opted = await own(`SELECT bool_and(opted_out) AS all_out FROM sms_threads WHERE phone = $1`, [CLIENT]);
      assert.equal(opted[0].all_out, true);

      // A new thread for the same person on another line inherits the opt-out.
      await own(`INSERT INTO phone_lines (number, label) VALUES ('+19995550300', 'Spare')`);
      const t3 = await sms.upsertSmsThread(CLIENT, null, "+19995550300");
      const [n3] = await own(`SELECT opted_out FROM sms_threads WHERE id = $1`, [t3]);
      assert.equal(n3.opted_out, true);
    },
    { fresh: true },
  );
});
