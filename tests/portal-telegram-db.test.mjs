// Portal messages on Telegram + portal reply drafts (2026-10-31, migration
// 0062). Before this a client's portal message only made a bell card, and an
// agent answering Tom Tierney's portal message could only stage an EMAIL.
// Disposable harness DB.
//
// Checked:
//   1. A reply to a portal message push posts Joe's text into that portal
//      thread as Joe (+ client activity), and a reply to his own message
//      keeps going to the same thread.
//   2. A loose message (no reply) never posts anything to a client.
//   3. A lead thread that moved onto its project on conversion is followed.
//   4. Approve on a "To: client portal" draft posts it in the portal thread
//      (no email), closes the item, and leaves it alone if Joe already
//      answered in the portal after the draft was staged.
//   5. No portal login → Approve refuses (the email path is never used).
//   6. The push carries the message, is remembered as a reply target, and is
//      not held back by the hourly cap.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { withTestDb, harnessAvailable } from "./_harness/testdb.mjs";
import { handleTelegramUpdate } from "../lib/decisions/telegram.ts";
import { rememberReplyTarget } from "../lib/decisions/owner-replies.ts";

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";
// lib/db's pool is one module instance shared by the tests below: close it once.
let sharedPool = null;
after(async () => {
  await sharedPool?.end();
});
const root = new URL("../", import.meta.url);

// approved-draft-send imports Gmail / dispatch plumbing the portal path never
// touches: stub them (they throw if called) so nothing can email.
const STUBS = {
  "server-only": [],
  "@/lib/gmail": ["gmailConfigured"],
  "@/lib/dispatch/db": ["dispatchIntentsNow"],
  "@/lib/lead-activity": ["logLeadActivity"],
  "@/lib/commands/intents": ["enqueueIntent"],
  // lib/commands/db (runDirect) pulls in the session helpers; no session here.
  "@/lib/dal": ["getCurrentUser"],
  "@/lib/api-auth": ["getUserFromRequest"],
};
registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    const relative = specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier);
    if (specifier.startsWith("@/") || relative) {
      const base = relative ? new URL(specifier, context.parentURL).href : new URL(specifier.slice(2), root).href;
      for (const ext of ["", ".ts", ".mjs"]) {
        try {
          if (statSync(new URL(base + ext)).isFile()) return { url: base + ext, shortCircuit: true };
        } catch {
          /* try the next extension */
        }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("stub:")) return next(url, context);
    const names = STUBS[url.slice("stub:".length)];
    const source = names.map((n) => `export const ${n} = () => { throw new Error("stub ${n} must not be called on the portal path"); };`).join("\n");
    return { format: "module", source, shortCircuit: true };
  },
});

test("telegram replies to portal pushes post in the portal", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    await client.query("BEGIN");
    try {
      const [owner] = await run(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-portal-owner@example.test','x','Joe Stafki','owner','JS') RETURNING id, name`);
      const principal = { kind: "user", userId: owner.id, role: "owner", name: owner.name, permissions: [] };
      const chat = "999000444";
      const deps = { ownerChatId: chat, ownerPrincipal: async () => principal, answer: async () => {} };
      let uid = 930000000;
      const msg = (message_id, text, replyTo) => ({
        update_id: ++uid,
        message: { message_id, chat: { id: chat, type: "private" }, from: { id: chat }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
      });
      const [project] = await run(`INSERT INTO projects (slug, name) VALUES ('zz-tierney', 'ZZ Tierney · Kitchen') RETURNING id`);
      const [inbound] = await run(
        `INSERT INTO chat_messages (channel_key, author_kind, author_name, body) VALUES ('portal:zz-tierney', 'user', 'Tom Tierney', 'Can the lights go in before the cabinets?') RETURNING id`,
      );
      // The push went out as Telegram message 500.
      await rememberReplyTarget(run, { chatId: chat, messageId: 500, portalChannelKey: "portal:zz-tierney", portalMessageId: inbound.id, kind: "portal" });

      // ── 1. reply to the push → posted as Joe ─────────────────────────────
      const r1 = await handleTelegramUpdate(run, msg(501, "Yes, lights first. I'll confirm the day with the electrician.", 500), deps);
      assert.ok(r1.portalReply, r1.outcome);
      assert.equal(r1.ownerReply, undefined, "not a card reply");
      assert.equal(r1.portalReply.channelKey, "portal:zz-tierney");
      assert.equal(r1.portalReply.recipient, "Tom Tierney");
      assert.deepEqual(r1.portalReply.scope, { kind: "project", slug: "zz-tierney" });
      const [posted] = await run(`SELECT channel_key, author_kind, author_name, author_user_id, body FROM chat_messages WHERE id = $1`, [r1.portalReply.messageId]);
      assert.deepEqual(posted, {
        channel_key: "portal:zz-tierney",
        author_kind: "owner",
        author_name: "Joe Stafki",
        author_user_id: owner.id,
        body: "Yes, lights first. I'll confirm the day with the electrician.",
      });
      const [act] = await run(`SELECT kind, entity_kind, entity_id FROM client_activity WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`, [project.id]);
      assert.deepEqual(act, { kind: "message", entity_kind: "message", entity_id: r1.portalReply.messageId });

      // Replying to his own message keeps going to Tom.
      const r1b = await handleTelegramUpdate(run, msg(502, "Probably Tuesday.", 501), deps);
      assert.ok(r1b.portalReply, r1b.outcome);
      assert.equal(r1b.portalReply.channelKey, "portal:zz-tierney");

      // ── 2. a loose message never reaches the client ───────────────────────
      const before = (await run(`SELECT count(*)::int AS n FROM chat_messages WHERE channel_key = 'portal:zz-tierney'`))[0].n;
      const r2 = await handleTelegramUpdate(run, msg(503, "note to self: call 10 Electric"), deps);
      assert.equal(r2.portalReply, undefined);
      assert.ok(r2.help, r2.outcome);
      assert.equal((await run(`SELECT count(*)::int AS n FROM chat_messages WHERE channel_key = 'portal:zz-tierney'`))[0].n, before);

      // ── 3. lead thread moved onto its project ──────────────────────────────
      const [lead] = await run(`INSERT INTO leads (slug, name, email) VALUES ('zz-kleven', 'ZZ Kleven', 'zz-k@example.test') RETURNING id`);
      await run(`INSERT INTO projects (slug, name, lead_id) VALUES ('zz-kleven-bath', 'ZZ Kleven · Bath', $1)`, [lead.id]);
      await run(`INSERT INTO chat_messages (channel_key, author_kind, author_name, body) VALUES ('portal:zz-kleven-bath', 'user', 'Ann Kleven', 'hello')`);
      await rememberReplyTarget(run, { chatId: chat, messageId: 600, portalChannelKey: "portal:lead:zz-kleven", portalMessageId: null, kind: "portal" });
      const r3 = await handleTelegramUpdate(run, msg(601, "Hi Ann", 600), deps);
      assert.equal(r3.portalReply.channelKey, "portal:zz-kleven-bath");
      assert.equal(r3.portalReply.recipient, "Ann Kleven");
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

test("Approve on a portal reply draft posts it in the portal", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    sharedPool = (await import("../lib/db.ts")).pool;
    const { sendApprovedClientDraft } = await import("../lib/approved-draft-send.ts");
    const { workItemDraftPreviews } = await import("../lib/work-item-draft.ts");
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    // The real pool commits, so clear this test's rows before and after.
    const clean = async () => {
      await run(`DELETE FROM chat_messages WHERE channel_key = 'portal:zz-tierney2'`);
      await run(`DELETE FROM work_items WHERE project_id IN (SELECT id FROM projects WHERE slug = 'zz-tierney2')`);
      await run(`DELETE FROM knowledge_items WHERE project_id IN (SELECT id FROM projects WHERE slug = 'zz-tierney2')`);
      await run(`DELETE FROM client_activity WHERE project_id IN (SELECT id FROM projects WHERE slug = 'zz-tierney2')`);
      await run(`DELETE FROM projects WHERE slug = 'zz-tierney2'`);
      await run(`DELETE FROM users WHERE email IN ('zz-appr-owner@example.test', 'zz-tierney2@client-portal.invalid')`);
    };
    await clean();
    try {
      await run(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-appr-owner@example.test','x','Joe Stafki','owner','JS')`);
      const [p] = await run(`INSERT INTO projects (slug, name, client_name, client_email) VALUES ('zz-tierney2', 'ZZ Tierney · Kitchen', 'Tom Tierney', 'zz-tom@example.test') RETURNING id`);
      await run(`INSERT INTO users (email, password_hash, name, role, initials, link_slug) VALUES ('zz-tierney2@client-portal.invalid','x','Tom Tierney','client','TT','zz-tierney2')`);
      const staged = async (title, content) => {
        const [w] = await run(
          `INSERT INTO work_items (title, status, approval_status, requires_approval, project_id, source_kind, created_by)
           VALUES ($1, 'approval_needed', 'requested', true, $2, 'agent', 'zz-agent') RETURNING id`,
          [title, p.id],
        );
        const [k] = await run(`INSERT INTO knowledge_items (content, kind, source, project_id, created_by) VALUES ($1, 'portal_reply', 'agent', $2, 'agent') RETURNING id`, [content, p.id]);
        await run(`INSERT INTO agent_receipts (work_item_id, receipt_kind, uri, label) VALUES ($1, 'draft', $2, 'draft ready')`, [w.id, `knowledge_items/${k.id}`]);
        return w;
      };

      // ── 4. posted, closed, previewed as a portal post ─────────────────────
      const a = await staged("zz reply to Tom", "To: client portal\n\nHi Tom, lights first makes sense. I'll confirm the day.");
      const [preview] = await workItemDraftPreviews({ ids: [a.id] });
      assert.equal(preview.channel, "portal");
      assert.equal(preview.sends, true);
      assert.equal(preview.to, "Tom Tierney (client portal)");
      assert.equal(preview.subject, null);
      assert.match(preview.body, /^Hi Tom/);

      const out = await sendApprovedClientDraft(a.id);
      assert.equal(out.outcome, "posted", JSON.stringify(out));
      assert.equal(out.to, "Tom Tierney");
      const [msg] = await run(`SELECT author_kind, author_name, body FROM chat_messages WHERE channel_key = 'portal:zz-tierney2' ORDER BY id DESC LIMIT 1`);
      assert.deepEqual(msg, { author_kind: "owner", author_name: "Joe Stafki", body: "Hi Tom, lights first makes sense. I'll confirm the day." });
      const [wa] = await run(`SELECT status FROM work_items WHERE id = $1`, [a.id]);
      assert.equal(wa.status, "done");
      const [rc] = await run(`SELECT receipt_kind, uri FROM agent_receipts WHERE work_item_id = $1 AND receipt_kind = 'portal_message'`, [a.id]);
      assert.match(rc.uri, /^chat_messages\/\d+$/);

      // Joe already answered in the portal after this draft → left alone.
      const b = await staged("zz second reply", "To: client portal\n\nHi Tom, one more thing.");
      await run(`UPDATE knowledge_items SET created_at = now() - interval '1 minute' WHERE id = (SELECT substring(uri from 17)::uuid FROM agent_receipts WHERE work_item_id = $1 AND receipt_kind = 'draft')`, [b.id]);
      await run(`INSERT INTO chat_messages (channel_key, author_kind, author_name, body) VALUES ('portal:zz-tierney2', 'owner', 'Joe', 'answered by hand')`);
      const skipped = await sendApprovedClientDraft(b.id);
      assert.equal(skipped.outcome, "not_email");
      assert.match(skipped.reason, /already replied in the portal/);

      // ── 5. no portal login → refused ──────────────────────────────────────
      await run(`UPDATE users SET active = false WHERE link_slug = 'zz-tierney2'`);
      const c = await staged("zz third reply", "To: client portal\n\nHi Tom, third.");
      const refused = await sendApprovedClientDraft(c.id);
      assert.equal(refused.outcome, "failed");
      assert.match(refused.error, /no portal login/);
    } finally {
      await clean().catch(() => undefined);
    }
  });
});

test("a portal message push carries the text and takes a reply", { skip }, async () => {
  await withTestDb(async (url, client) => {
    process.env.DATABASE_URL = url;
    process.env.SJC_OUTBOUND_DISABLED = "1";
    process.env.TELEGRAM_BOT_TOKEN = "zz-token";
    process.env.TELEGRAM_OWNER_CHAT_ID = "999000555";
    sharedPool = (await import("../lib/db.ts")).pool;
    const types = await import("../lib/providers/types.ts");
    const { notifyPortalMessage } = await import("../lib/notify-owner.ts");
    const run = async (sql, params) => (await client.query(sql, params)).rows;
    const sent = [];
    let next = 7000;
    types.setFakeOutcome((provider, payload) => {
      if (provider !== "telegram") return null;
      sent.push(payload);
      return { responseClass: "confirmed", providerRef: String(++next), transmitted: true };
    });
    const noon = new Date("2026-10-31T17:00:00Z"); // 12:00 Chicago, awake
    try {
      await run(`DELETE FROM telegram_reply_targets WHERE chat_id = '999000555'`);
      await run(`DELETE FROM push_outbox WHERE kind = 'portal_message'`);
      // Fill the hourly cap first: a portal message must still go out.
      for (let i = 0; i < 4; i++) {
        await run(`INSERT INTO push_outbox (kind, title, send_after, sent_at) VALUES ('comms', 'zz cap filler', $1, $1)`, [noon]);
      }
      await notifyPortalMessage(
        { surface: "client", channelKey: "portal:zz-tierney3", messageId: "53", name: "Tom Tierney", body: "Can all 7 recessed lights go in before the cabinets?", href: "/projects/zz-tierney3?tab=Client+portal", context: "Tierney · Kitchen" },
        noon,
      );
      assert.equal(sent.length, 1, "pushed despite the full hourly cap");
      assert.match(sent[0].text, /Tom Tierney wrote in the client portal \(Tierney · Kitchen\)/);
      assert.match(sent[0].text, /Can all 7 recessed lights go in before the cabinets\?/);
      assert.match(sent[0].text, /Reply to this message to answer Tom in the portal/);
      const [t] = await run(`SELECT portal_channel_key, portal_message_id::text AS mid, kind FROM telegram_reply_targets WHERE chat_id = '999000555' AND message_id = $1`, [next]);
      assert.deepEqual(t, { portal_channel_key: "portal:zz-tierney3", mid: "53", kind: "portal" });
    } finally {
      types.resetFakeOutbox();
      await run(`DELETE FROM push_outbox WHERE title = 'zz cap filler' OR kind = 'portal_message'`).catch(() => undefined);
      await run(`DELETE FROM telegram_reply_targets WHERE chat_id = '999000555'`).catch(() => undefined);
    }
  });
});
