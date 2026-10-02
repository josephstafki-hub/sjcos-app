import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { enqueueIntent, getIntent, sweepExpiredLeases } from "../lib/commands/intents.ts";
import { stageDecision, resolveDecision, revokeDecision, contentHashOf } from "../lib/commands/decisions.ts";
import { revokeDecisionEverywhere } from "../lib/decisions/resolve.ts";
import { pauseLane, resumeLane, proposePolicyVersion, activatePolicy } from "../lib/commands/policies.ts";
import { dispatchOnce, reconcileUnknown, sweepForDispatch } from "../lib/dispatch/core.ts";
import { getIntentAuthority } from "../lib/dispatch/authority.ts";
import { defaultProviders, fakeOutbox, resetFakeOutbox, setFakeOutcome } from "../lib/providers/index.ts";

// The dispatcher against a REAL disposable Postgres with fake providers
// (SJC_OUTBOUND_DISABLED=1 from the harness). V07 ambiguous send, V08 bulk
// sends, V09 approvals at dispatch, V14 kill switch / missing policy.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

const owner = { kind: "user", userId: null, role: "owner", name: "Joe", permissions: [] };
const agent = { kind: "agent", agent: "claude", runId: null, onBehalfOf: null };

async function seed(client) {
  const o = await client.query(`INSERT INTO users (email, password_hash, name, role, initials) VALUES ('zz-owner@example.test','x','Joe','owner','J') RETURNING id`);
  owner.userId = o.rows[0].id;
  await client.query(`TRUNCATE intent_authority, communication_optouts, telegram_updates RESTART IDENTITY CASCADE`);
  await client.query(`DELETE FROM notifications WHERE title LIKE '%ZZ%'`);
  await client.query(`DELETE FROM owner_grants WHERE reason LIKE 'zz-%'`);
  await client.query(`DELETE FROM newsletter_recipients WHERE email LIKE 'zz-%'`);
  await client.query(`DELETE FROM sms_threads WHERE phone LIKE '+1999%'`);
}

function txOver(url) {
  return async (fn) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    const run = async (sql, params) => (await c.query(sql, params)).rows;
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

function depsFor(url, client, worker = "w1") {
  return { tx: txOver(url), run: async (s, p) => (await client.query(s, p)).rows, providers: defaultProviders(), worker };
}

const sends = (op) => fakeOutbox.filter((f) => f.operationKey === op).length;

test("V07: accepted-then-timeout is held (no resend), reconciliation confirms it once, a stale worker cannot double-send, duplicate callbacks are harmless", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seed(client);
    resetFakeOutbox();
    const run = async (s, p) => (await client.query(s, p)).rows;
    const deps = depsFor(url, client);

    // an invoice so the effect (status flip) is observable
    const [proj] = await run(`INSERT INTO projects (slug, name, status, client_name) VALUES ('zz-v07', 'ZZ V07', 'construction', 'ZZ') RETURNING id`);
    const [inv] = await run(`INSERT INTO invoices (project_id, number, milestone, amount, status) VALUES ($1, 'ZZ-INV-1', 'Deposit', 50000, 'draft') RETURNING id`, [proj.id]);
    const payload = { to: "client@example.test", subject: "Invoice ZZ-INV-1", bodyText: "…", number: "ZZ-INV-1", project_name: "ZZ V07", amount_label: "$500.00", milestone: "Deposit", slug: "zz-v07" };
    const { intent } = await enqueueIntent(run, { operationKey: "zz:invoice:1:send", kind: "send_invoice", targetKind: "invoice", targetId: inv.id, recipient: payload.to, payload, policyRef: "owner:click", principal: owner });

    // 1. the provider times out AFTER transmitting → unknown, held
    setFakeOutcome(() => ({ responseClass: "unknown", error: "timeout after transmit", transmitted: true }));
    const [o1] = await dispatchOnce(deps, { intentIds: [intent.id] });
    assert.equal(o1.responseClass, "unknown");
    assert.equal(o1.state, "unknown");
    assert.equal(sends("zz:invoice:1:send"), 1);
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "draft", "unknown never reports sent");
    setFakeOutcome(null);
    // a second pass does NOT resend
    assert.equal((await dispatchOnce(deps, { kinds: ["send_invoice"] })).length, 0);
    assert.equal((await dispatchOnce(deps, { intentIds: [intent.id] })).length, 0);
    assert.equal(sends("zz:invoice:1:send"), 1);

    // 2. reconciliation: the provider's own record says it went out → confirmed, effect runs once
    const providers = { ...deps.providers, email: { ...deps.providers.email, reconcile: async () => ({ state: "confirmed", providerRef: "gm-77", note: "found in Sent" }) } };
    const r1 = await reconcileUnknown({ ...deps, providers }, { minAgeSeconds: 0 });
    assert.equal(r1.confirmed, 1);
    const after = await getIntent(run, intent.id);
    assert.equal(after.state, "confirmed");
    assert.equal(after.provider_ref, "gm-77");
    assert.equal((await run(`SELECT status FROM invoices WHERE id = $1`, [inv.id]))[0].status, "sent");
    // duplicate callback / second reconcile: no second effect, no second notification
    const r2 = await reconcileUnknown({ ...deps, providers }, { minAgeSeconds: 0 });
    assert.equal(r2.checked, 0, "confirmed intents are not reconciled again");
    assert.equal((await run(`SELECT count(*)::int AS n FROM notifications WHERE title LIKE 'Invoice ZZ-INV-1 sent%'`))[0].n, 1);
    assert.equal(sends("zz:invoice:1:send"), 1, "reconciliation never resends");

    // 3. stale worker: its lease expires mid-call; its late write is fenced and the
    //    truthful state is 'unknown'; nobody re-dispatches it
    const { intent: i2 } = await enqueueIntent(run, { operationKey: "zz:email:stale", kind: "send_email", recipient: "a@example.test", payload: { to: "a@example.test", subject: "s", bodyText: "b" }, policyRef: "owner:click", principal: owner });
    const slow = {
      ...deps.providers,
      email: {
        ...deps.providers.email,
        async send(p, ctx) {
          // lease is already expired (leaseSeconds -1); a sweep runs while we are "on the wire"
          await sweepExpiredLeases(run);
          return deps.providers.email.send(p, ctx);
        },
      },
    };
    const [o2] = await dispatchOnce({ ...deps, providers: slow, leaseSeconds: -1 }, { intentIds: [i2.id] });
    assert.equal(o2.state, null, "fenced write");
    assert.equal(sends("zz:email:stale"), 1);
    const stale = await getIntent(run, i2.id);
    assert.equal(stale.state, "unknown");
    assert.match(stale.last_error, /unknown/);
    assert.equal((await dispatchOnce(deps, { kinds: ["send_email"] })).length, 0, "an unknown intent is never claimed again");
    assert.equal(sends("zz:email:stale"), 1);
  });
});

test("V08 bulk: one intent per recipient; two succeed, one fails then succeeds, one opts out after approval — the retry touches only the eligible unresolved one", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seed(client);
    resetFakeOutbox();
    const run = async (s, p) => (await client.query(s, p)).rows;
    const deps = depsFor(url, client);

    const recipients = ["a@sub.test", "b@sub.test", "c@sub.test", "d@sub.test"];
    const pkg = { kind: "bid_package", id: 12, revision: 1, recipients: recipients.map((address) => ({ name: address, address })), inclusions: ["Frame deck"] };
    const { decision } = await stageDecision(run, {
      kind: "package_release", action: "send_bid_package", title: "Bid package 12 → 4 subs",
      summary: { recipients: pkg.recipients }, targetKind: "bid_package", targetId: 12, content: pkg, maxUses: 4, dedupeKey: "zz:bid:12", requestedBy: agent,
    });
    assert.equal((await resolveDecision(run, { id: decision.id, outcome: "approved", principal: owner, via: "app" })).ok, true);
    const ids = [];
    for (const to of recipients) {
      const { intent } = await enqueueIntent(run, {
        operationKey: `zz:bid:12:${to}`, kind: "send_bid_package", targetKind: "bid_package", targetId: 12, recipient: to, decisionId: decision.id,
        payload: { to, subject: "Bid request", bodyText: "…", invite_id: 0, _auth: { action: "send_bid_package", target_kind: "bid_package", target_id: "12", content_hash: decision.content_hash } },
        principal: agent,
      });
      ids.push(intent.id);
    }
    // pass 1: a, b accepted; c and d refused before transmit (retryable)
    setFakeOutcome((_p, payload) => (payload.to === "c@sub.test" || payload.to === "d@sub.test" ? { responseClass: "retryable", error: "connect ECONNREFUSED", transmitted: false, retryInSeconds: 0 } : undefined));
    const p1 = await dispatchOnce(deps, { intentIds: ids });
    assert.deepEqual(p1.map((o) => o.responseClass).sort(), ["accepted", "accepted", "retryable", "retryable"]);
    assert.equal((await run(`SELECT uses, status FROM decisions WHERE id = $1`, [decision.id]))[0].uses, 4, "each recipient spent one use at dispatch");
    // d opts out after the approval
    await run(`INSERT INTO communication_optouts (channel, address, reason, source) VALUES ('email', 'd@sub.test', 'asked to stop', 'reply')`);
    setFakeOutcome(null);
    // pass 2: only c and d are still dispatchable; c goes, d is refused
    const p2 = await dispatchOnce(deps, { kinds: ["send_bid_package"] });
    const byTo = Object.fromEntries(p2.map((o) => [o.operationKey, o]));
    assert.equal(p2.length, 2);
    assert.equal(byTo["zz:bid:12:c@sub.test"].responseClass, "accepted");
    assert.equal(byTo["zz:bid:12:d@sub.test"].responseClass, "refused");
    assert.equal(byTo["zz:bid:12:d@sub.test"].state, "cancelled");
    assert.match(byTo["zz:bid:12:d@sub.test"].error, /opted out/);
    assert.equal(sends("zz:bid:12:a@sub.test"), 1);
    assert.equal(sends("zz:bid:12:b@sub.test"), 1);
    assert.equal(sends("zz:bid:12:c@sub.test"), 2);
    assert.equal(sends("zz:bid:12:d@sub.test"), 1, "the opted-out recipient got no further attempt");
    // d's use was never transmitted → given back; the other three stay spent
    assert.equal((await run(`SELECT uses FROM decisions WHERE id = $1`, [decision.id]))[0].uses, 3);
    assert.ok((await getIntentAuthority(run, byTo["zz:bid:12:d@sub.test"].intentId)).refunded_at);
    // nothing left to do
    assert.equal((await dispatchOnce(deps, { kinds: ["send_bid_package"] })).length, 0);
  });
});

test("V09 at dispatch: changed content / recipient / amount refuse, expiry refuses, revocation bites a held intent, unknown outcome keeps the use spent; grants spend at dispatch and refund only when nothing transmitted", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seed(client);
    resetFakeOutbox();
    const run = async (s, p) => (await client.query(s, p)).rows;
    const deps = depsFor(url, client);
    const approved = async (over = {}) => {
      const { decision } = await stageDecision(run, { kind: "purchase", action: "send_purchase_order", title: "PO", summary: {}, targetKind: "purchase_order", targetId: 7, recipient: "vendor@example.test", amountCents: 12345, content: { po: 7, rev: 1 }, requestedBy: agent, ...over });
      await resolveDecision(run, { id: decision.id, outcome: "approved", principal: owner, via: "telegram" });
      return decision;
    };
    const stage = async (key, d, payloadOver = {}, over = {}) =>
      (await enqueueIntent(run, {
        operationKey: key, kind: "send_purchase_order", targetKind: "purchase_order", targetId: 7, recipient: "vendor@example.test", decisionId: d.id,
        payload: { to: "vendor@example.test", subject: "PO 7", bodyText: "…", _auth: { action: "send_purchase_order", target_kind: "purchase_order", target_id: "7", content_hash: d.content_hash, amount_cents: 12345 }, ...payloadOver },
        principal: agent, ...over,
      })).intent;

    // changed content
    const d1 = await approved();
    const i1 = await stage("zz:po:content", d1, { _auth: { action: "send_purchase_order", target_kind: "purchase_order", target_id: "7", content_hash: contentHashOf({ po: 7, rev: 2 }), amount_cents: 12345 } });
    const [o1] = await dispatchOnce(deps, { intentIds: [i1.id] });
    assert.equal(o1.responseClass, "refused");
    assert.match(o1.error, /content changed/);
    assert.equal(sends("zz:po:content"), 0);
    // changed payee
    const d2 = await approved({ content: { po: 7, rev: 3 } });
    const i2 = await stage("zz:po:payee", d2, {}, { recipient: "other@example.test" });
    const [o2] = await dispatchOnce(deps, { intentIds: [i2.id] });
    assert.match(o2.error, /vendor@example.test/);
    // changed amount
    const d3 = await approved({ content: { po: 7, rev: 4 } });
    const i3 = await stage("zz:po:amount", d3, { _auth: { action: "send_purchase_order", target_kind: "purchase_order", target_id: "7", content_hash: d3.content_hash, amount_cents: 99999 } });
    assert.match((await dispatchOnce(deps, { intentIds: [i3.id] }))[0].error, /amount changed/);
    // expiry
    const d4 = await approved({ content: { po: 7, rev: 5 } });
    await run(`UPDATE decisions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [d4.id]);
    const i4 = await stage("zz:po:expired", d4);
    assert.match((await dispatchOnce(deps, { intentIds: [i4.id] }))[0].error, /expired/);
    // revocation after approval, before dispatch
    const d5 = await approved({ content: { po: 7, rev: 6 } });
    await revokeDecision(run, d5.id, owner, "changed my mind");
    const i5 = await stage("zz:po:revoked", d5);
    const [o5] = await dispatchOnce(deps, { intentIds: [i5.id] });
    assert.equal(o5.responseClass, "refused");
    assert.match(o5.error, /revoked/);
    assert.equal(fakeOutbox.length, 0, "no refusal reached a provider");
    // exact match dispatches once; a second dispatch of the same intent does nothing
    const d6 = await approved({ content: { po: 7, rev: 7 } });
    const i6 = await stage("zz:po:ok", d6);
    assert.equal((await dispatchOnce(deps, { intentIds: [i6.id] }))[0].responseClass, "accepted");
    assert.equal((await dispatchOnce(deps, { intentIds: [i6.id] })).length, 0);
    assert.equal(sends("zz:po:ok"), 1);
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [d6.id]))[0].status, "consumed");
    // unknown outcome: the use stays spent
    const d7 = await approved({ content: { po: 7, rev: 8 } });
    const i7 = await stage("zz:po:unknown", d7);
    setFakeOutcome(() => ({ responseClass: "unknown", error: "timeout", transmitted: true }));
    assert.equal((await dispatchOnce(deps, { intentIds: [i7.id] }))[0].state, "unknown");
    setFakeOutcome(null);
    assert.deepEqual((await run(`SELECT uses, status FROM decisions WHERE id = $1`, [d7.id]))[0], { uses: 1, status: "consumed" });
    assert.equal((await getIntentAuthority(run, i7.id)).refunded_at, null);

    // a retry of the same intent reuses its authority (no second spend), and a
    // revoked decision refuses the retry even though it was consumed earlier
    const d8 = await approved({ content: { po: 7, rev: 9 }, maxUses: 1 });
    const i8 = await stage("zz:po:retry", d8);
    setFakeOutcome(() => ({ responseClass: "retryable", error: "connect ECONNREFUSED", transmitted: false, retryInSeconds: 0 }));
    assert.equal((await dispatchOnce(deps, { intentIds: [i8.id] }))[0].state, "retryable_failure");
    assert.equal((await run(`SELECT uses FROM decisions WHERE id = $1`, [d8.id]))[0].uses, 1);
    setFakeOutcome(null);
    // a single-use decision is already 'consumed' once its intent was leased, so the
    // owner's revoke must reach the intent itself (revokeDecisionEverywhere)
    assert.equal((await revokeDecision(run, d8.id, owner, "stop")), false, "commands.revokeDecision does not cover 'consumed'");
    const rv = await revokeDecisionEverywhere(run, d8.id, owner, "stop");
    assert.deepEqual(rv, { ok: true, cancelledIntents: 1 });
    assert.equal((await dispatchOnce(deps, { intentIds: [i8.id] })).length, 0, "a cancelled intent is never claimed");
    assert.equal((await getIntent(run, i8.id)).state, "cancelled");
    assert.equal(sends("zz:po:retry"), 1, "one refused-before-transmit attempt, nothing after revocation");
    // and a revoke that lands while the intent is merely pending refuses at dispatch too
    const d9 = await approved({ content: { po: 7, rev: 10 }, maxUses: 3 });
    const i9 = await stage("zz:po:retry2", d9);
    setFakeOutcome(() => ({ responseClass: "retryable", error: "connect ECONNREFUSED", transmitted: false, retryInSeconds: 0 }));
    await dispatchOnce(deps, { intentIds: [i9.id] });
    setFakeOutcome(null);
    assert.equal(await revokeDecision(run, d9.id, owner, "stop"), true);
    const [o9b] = await dispatchOnce(deps, { intentIds: [i9.id] });
    assert.equal(o9b.responseClass, "refused");
    assert.match(o9b.error, /revoked/);

    // owner grants: spent at dispatch, audited, refunded only when nothing transmitted
    const [g] = await run(`INSERT INTO owner_grants (status, actions, target_kind, target_id, reason, requested_by, max_uses, expires_at, decided_at) VALUES ('approved', ARRAY['send_email'], 'email', 'x@example.test', 'zz-grant', 'claude', 2, now() + interval '1 hour', now()) RETURNING id`);
    const { intent: ge } = await enqueueIntent(run, { operationKey: "zz:grant:email", kind: "send_email", targetKind: "email", targetId: "x@example.test", recipient: "x@example.test", grantId: g.id, payload: { to: "x@example.test", subject: "s", bodyText: "b", _auth: { action: "send_email", target_kind: "email", target_id: "x@example.test", to: "x@example.test" } }, principal: agent });
    setFakeOutcome(() => ({ responseClass: "permanent", error: "Invalid To header", transmitted: false }));
    assert.equal((await dispatchOnce(deps, { intentIds: [ge.id] }))[0].state, "permanent_failure");
    setFakeOutcome(null);
    let grant = (await run(`SELECT uses, audit FROM owner_grants WHERE id = $1`, [g.id]))[0];
    assert.equal(grant.uses, 0, "provably never called → refunded");
    assert.match(grant.audit[0].result, /permanent_failure/);
    const { intent: ge2 } = await enqueueIntent(run, { operationKey: "zz:grant:email2", kind: "send_email", targetKind: "email", targetId: "x@example.test", recipient: "x@example.test", grantId: g.id, payload: { to: "x@example.test", subject: "s2", bodyText: "b", _auth: { action: "send_email", target_kind: "email", target_id: "x@example.test", to: "x@example.test" } }, principal: agent });
    setFakeOutcome(() => ({ responseClass: "unknown", error: "timeout", transmitted: true }));
    assert.equal((await dispatchOnce(deps, { intentIds: [ge2.id] }))[0].state, "unknown");
    setFakeOutcome(null);
    grant = (await run(`SELECT uses, audit FROM owner_grants WHERE id = $1`, [g.id]))[0];
    assert.equal(grant.uses, 1, "unknown outcome never refunds");
    assert.match(grant.audit.at(-1).result, /unknown/);
    // a grant for another target refuses at dispatch
    const { intent: ge3 } = await enqueueIntent(run, { operationKey: "zz:grant:other", kind: "send_email", targetKind: "email", targetId: "y@example.test", recipient: "y@example.test", grantId: g.id, payload: { to: "y@example.test", subject: "s", bodyText: "b", _auth: { action: "send_email", target_kind: "email", target_id: "y@example.test", to: "y@example.test" } }, principal: agent });
    const [o9] = await dispatchOnce(deps, { intentIds: [ge3.id] });
    assert.equal(o9.responseClass, "refused");
    assert.match(o9.error, /x@example.test only/);
  });
});

test("V14: a missing/draft policy holds the automatic action; a paused lane stops new dispatch but keeps unknown effects; resume wakes held intents; an approval wakes intents parked on a pending decision", { skip }, async () => {
  await withTestDb(async (url, client) => {
    await cleanFoundation(client);
    await seed(client);
    resetFakeOutbox();
    const run = async (s, p) => (await client.query(s, p)).rows;
    const deps = depsFor(url, client);

    // missing policy → held, nothing sent
    const { intent: auto } = await enqueueIntent(run, { operationKey: "zz:auto:1", kind: "send_email", recipient: "c@example.test", payload: { to: "c@example.test", subject: "Quick check", bodyText: "…" }, policyRef: "policy:routine.followup@1", principal: { kind: "service", name: "policy" } });
    const [h1] = await dispatchOnce(deps, { intentIds: [auto.id] });
    assert.equal(h1.state, "held");
    assert.match(h1.error, /not active/);
    assert.equal(fakeOutbox.length, 0);
    // draft is not active either; activation of that version releases it via the sweep + dispatch
    const v1 = await proposePolicyVersion(run, "routine.followup", { lane: "routine_followup" }, "test");
    await run(`UPDATE action_intents SET state = 'pending', hold_reason = NULL WHERE id = $1`, [auto.id]);
    assert.equal((await dispatchOnce(deps, { intentIds: [auto.id] }))[0].state, "held", "draft is a proposal, not permission");
    await activatePolicy(run, "routine.followup", v1.version);
    await run(`UPDATE action_intents SET state = 'pending', hold_reason = NULL WHERE id = $1`, [auto.id]);
    assert.equal((await dispatchOnce(deps, { intentIds: [auto.id] }))[0].responseClass, "accepted");
    assert.equal((await getIntentAuthority(run, auto.id)).ref, "policy:routine.followup@1");

    // kill switch: an unknown stays unknown; new dispatch on the lane is held
    const { intent: unk } = await enqueueIntent(run, { operationKey: "zz:ks:unknown", kind: "send_email", recipient: "u@example.test", payload: { to: "u@example.test", subject: "s", bodyText: "b" }, policyRef: "owner:click", principal: owner });
    setFakeOutcome(() => ({ responseClass: "unknown", error: "timeout", transmitted: true }));
    await dispatchOnce(deps, { intentIds: [unk.id] });
    setFakeOutcome(null);
    await pauseLane(run, "sends", "joe", "incident");
    const { intent: paused } = await enqueueIntent(run, { operationKey: "zz:ks:new", kind: "send_email", recipient: "n@example.test", payload: { to: "n@example.test", subject: "s", bodyText: "b" }, policyRef: "owner:click", principal: owner });
    const [hp] = await dispatchOnce(deps, { intentIds: [paused.id] });
    assert.equal(hp.state, "held");
    assert.match(hp.error, /paused/);
    assert.equal((await getIntent(run, unk.id)).state, "unknown", "pause retains the unknown effect");
    assert.equal((await getIntent(run, paused.id)).attempts, 0, "a hold is not an attempt");
    assert.equal(fakeOutbox.filter((f) => f.operationKey === "zz:ks:new").length, 0);
    // 'all' pause also stops a different lane
    await pauseLane(run, "all", "joe", "everything off");
    const { intent: pub } = await enqueueIntent(run, { operationKey: "zz:ks:news", kind: "release_newsletter", targetId: "1", recipient: "r@example.test", payload: { to: "r@example.test", subject: "s", bodyText: "b" }, policyRef: "owner:click", principal: owner });
    assert.equal((await dispatchOnce(deps, { intentIds: [pub.id] }))[0].state, "held");
    // resume → sweep releases held-for-lane intents → they dispatch
    await resumeLane(run, "all");
    await resumeLane(run, "sends");
    const swept = await sweepForDispatch(run);
    assert.equal(swept.releasedHolds, 2);
    const woke = await dispatchOnce(deps, { kinds: ["send_email", "release_newsletter"] });
    assert.deepEqual(woke.map((o) => o.responseClass), ["accepted", "accepted"]);
    assert.equal((await getIntent(run, unk.id)).state, "unknown", "still held for reconciliation after resume");

    // an intent staged under a PENDING decision holds; approval wakes it through the sweep
    const { decision } = await stageDecision(run, { kind: "proposal", action: "send_email", title: "Estimate → client", summary: {}, recipient: "p@example.test", content: { est: 1 }, requestedBy: agent });
    const { intent: parked } = await enqueueIntent(run, { operationKey: "zz:pending:1", kind: "send_email", recipient: "p@example.test", decisionId: decision.id, payload: { to: "p@example.test", subject: "Estimate", bodyText: "…", _auth: { action: "send_email", content_hash: decision.content_hash } }, principal: agent });
    const [hd] = await dispatchOnce(deps, { intentIds: [parked.id] });
    assert.equal(hd.state, "held");
    assert.match(hd.error, /awaiting decision/);
    await resolveDecision(run, { id: decision.id, outcome: "approved", principal: owner, via: "app" });
    assert.equal((await sweepForDispatch(run)).releasedHolds, 1);
    assert.equal((await dispatchOnce(deps, { intentIds: [parked.id] }))[0].responseClass, "accepted");
    assert.equal((await run(`SELECT status FROM decisions WHERE id = $1`, [decision.id]))[0].status, "consumed");

    // opt-outs: sms STOP and an unsubscribed newsletter recipient refuse at dispatch
    await run(`INSERT INTO sms_threads (phone, opted_out, opted_out_at) VALUES ('+19995550001', true, now())`);
    const { intent: sms } = await enqueueIntent(run, { operationKey: "zz:sms:stop", kind: "send_sms", targetKind: "phone", targetId: "+19995550001", recipient: "+19995550001", payload: { to: "+19995550001", text: "hi", message_id: 0, thread_id: 0 }, policyRef: "owner:click", principal: owner });
    assert.match((await dispatchOnce(deps, { intentIds: [sms.id] }))[0].error, /STOP/);
    await run(`INSERT INTO newsletter_recipients (email, name, active) VALUES ('zz-gone@example.test', 'Gone', false)`);
    const { intent: nl } = await enqueueIntent(run, { operationKey: "zz:nl:unsub", kind: "release_newsletter", targetId: "0", recipient: "zz-gone@example.test", payload: { to: "zz-gone@example.test", subject: "s", bodyText: "b" }, policyRef: "owner:click", principal: owner });
    assert.match((await dispatchOnce(deps, { intentIds: [nl.id] }))[0].error, /unsubscribed/);
    assert.equal(fakeOutbox.filter((f) => f.payload.to === "+19995550001" || f.payload.to === "zz-gone@example.test").length, 0);
  });
});
