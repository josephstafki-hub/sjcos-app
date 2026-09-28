// The per-account rules that came in with staff logins (2026-09-27).
//
// Two pieces of pure logic carry most of the weight and are worth pinning:
//
//   openWorkItemsSql()  — whose to-dos a Today queue is built from. Get this
//                         wrong in the staff direction and a team member reads
//                         Joe's whole board.
//   internalDmKey() /   — which conversation two internal people land in. The
//   teamDmParties()       owner↔person form has to stay byte-identical to the
//                         pre-existing `dm:team:<slug>` keys, or every existing
//                         DM transcript is orphaned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openWorkItemsSql } from "../lib/queue-scope.ts";
import { internalDmKey, teamDmParties, dmTeamKey } from "../lib/dm-keys.ts";

const OWNER = { id: "owner-1", name: "Joseph Stafki", role: "owner" };
const STAFF = { id: "staff-1", name: "Marco Rivas", role: "staff" };

// ─── Whose to-dos ────────────────────────────────────────────────────────────

test("owner's queue is not filtered by assignee — a handed-off to-do stays on it", () => {
  const { sql, params } = openWorkItemsSql(OWNER);
  assert.equal(params.length, 0);
  assert.ok(!/assigned_user_id\s*=/.test(sql), "owner SQL must not filter on assigned_user_id");
});

test("staff queue is strictly their own assigned to-dos", () => {
  const { sql, params } = openWorkItemsSql(STAFF);
  assert.deepEqual(params, [STAFF.id]);
  assert.match(sql, /AND w\.assigned_user_id = \$1/);
  // Unassigned means "Joe's". A staff member must not inherit those, so an
  // `IS NULL` escape hatch would be a bug, not a convenience.
  assert.ok(!/assigned_user_id IS NULL/.test(sql));
});

test("both queues keep the pre-existing filters (open, unsnoozed, human, live lead)", () => {
  for (const viewer of [OWNER, STAFF]) {
    const { sql } = openWorkItemsSql(viewer);
    assert.match(sql, /status NOT IN \('done','cancelled','waiting_on_client'\)/);
    assert.match(sql, /snoozed_until IS NULL OR w\.snoozed_until <= now\(\)/);
    assert.match(sql, /assignee_kind = 'human'/);
    assert.match(sql, /l\.stage <> 'lost'/);
  }
});

// ─── Which DM ────────────────────────────────────────────────────────────────

test("owner↔staff keeps the original single-slug key, from either side", () => {
  const joe = { slug: "joe", isOwner: true };
  const marco = { slug: "marco", isOwner: false };
  assert.equal(internalDmKey(joe, marco), "dm:team:marco");
  assert.equal(internalDmKey(marco, joe), "dm:team:marco");
  // Byte-identical to what the pre-staff code produced — existing transcripts
  // and the rows in chat_dms are addressed by exactly this string.
  assert.equal(internalDmKey(joe, marco), dmTeamKey("marco"));
});

test("staff↔staff gets one sorted pair key whoever opens it first", () => {
  const a = { slug: "marco", isOwner: false };
  const b = { slug: "dana", isOwner: false };
  assert.equal(internalDmKey(a, b), "dm:team:dana+marco");
  assert.equal(internalDmKey(b, a), "dm:team:dana+marco");
});

test("a team DM key reports both of its parties", () => {
  assert.deepEqual(teamDmParties("dm:team:marco", "joe"), ["joe", "marco"]);
  assert.deepEqual(teamDmParties("dm:team:dana+marco", "joe"), ["dana", "marco"]);
  // No owner slug on record (a DB the migration hasn't reached): the single-slug
  // form can only report the half it actually names.
  assert.deepEqual(teamDmParties("dm:team:marco", null), ["marco"]);
  // Not a team DM at all — a sub's portal thread, or a client DM.
  assert.deepEqual(teamDmParties("dm:marco", "joe"), []);
  assert.deepEqual(teamDmParties("dm:client:chen", "joe"), []);
});

test("a slug that merely contains another's is not a party to its DM", () => {
  // "mar" ⊂ "marco": the reason the unread query anchors its LIKE patterns on
  // both sides rather than wrapping the slug in %…%.
  assert.ok(!teamDmParties("dm:team:dana+marco", "joe").includes("mar"));
  assert.ok(!teamDmParties("dm:team:marco", "joe").includes("mar"));
});

test("every internal DM key stays inside the dm:team: namespace", () => {
  // Two invariants the rest of the system leans on: a "dm:" prefix turns the
  // membership UI off, and a ":" in the key means all AI models stay implicit.
  const keys = [
    internalDmKey({ slug: "joe", isOwner: true }, { slug: "marco", isOwner: false }),
    internalDmKey({ slug: "marco", isOwner: false }, { slug: "dana", isOwner: false }),
  ];
  for (const k of keys) {
    assert.ok(k.startsWith("dm:team:"), k);
    assert.ok(k.includes(":"), k);
  }
});
