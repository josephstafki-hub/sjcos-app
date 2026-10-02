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
//   resolveMailbox()    — whose email. Wrong one way it hands Joe's mail to a
//                         team member; wrong the other it breaks every
//                         background send, which runs on the env token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openWorkItemsSql, describeAssignment } from "../lib/queue-scope.ts";
import { idsToStore, sameAssignees, joinNames, assignedNotice } from "../lib/work-item-assignees.mjs";
import { internalDmKey, teamDmParties, dmTeamKey } from "../lib/dm-keys.ts";
import { resolveMailbox } from "../lib/mailbox-rule.ts";

const OWNER = { id: "owner-1", name: "Joseph Stafki", role: "owner" };
const STAFF = { id: "staff-1", name: "Marco Rivas", role: "staff" };

// ─── Whose to-dos ────────────────────────────────────────────────────────────

test("owner's queue is not filtered by assignee — a handed-off to-do stays on it", () => {
  const { sql, params } = openWorkItemsSql(OWNER);
  assert.equal(params.length, 0);
  assert.ok(!/wa\.user_id = \$/.test(sql), "owner SQL must not filter on who is on the to-do");
  // …but it does carry everyone on each to-do, for the card's line.
  assert.match(sql, /asg\.assigned/);
});

test("staff queue is strictly the to-dos they are on", () => {
  const { sql, params } = openWorkItemsSql(STAFF);
  assert.deepEqual(params, [STAFF.id]);
  assert.match(sql, /AND EXISTS \(SELECT 1 FROM work_item_assignees wa\s+WHERE wa\.work_item_id = w\.id AND wa\.user_id = \$1\)/);
  // Nobody on it means "Joe's". A staff member must not inherit those, so a
  // NOT EXISTS / IS NULL escape hatch would be a bug, not a convenience.
  assert.ok(!/NOT EXISTS/.test(sql));
  assert.ok(!/assigned_user_id/.test(sql), "the legacy single-person column is not read");
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

// ─── Several people on one to-do (Joe, 2026-09-30) ───────────────────────────

const JOE = { userId: "owner-1", name: "Joe Stafki", initials: "JS" };
const ABIGAIL = { userId: "staff-1", name: "Abigail Stafki", initials: "AS" };
const MARCO = { userId: "staff-2", name: "Marco Rivas", initials: "MR" };

test("just the owner is stored as nobody — one spelling of his own to-do", () => {
  assert.deepEqual(idsToStore([]), []);
  assert.deepEqual(idsToStore([{ id: "owner-1", role: "owner" }]), []);
  assert.deepEqual(idsToStore([{ id: "owner-1", role: "owner" }, { id: "owner-1", role: "owner" }]), []);
});

test("the owner is stored when he's on it alongside someone", () => {
  assert.deepEqual(
    idsToStore([{ id: "owner-1", role: "owner" }, { id: "staff-1", role: "staff" }]),
    ["owner-1", "staff-1"],
  );
  assert.deepEqual(idsToStore([{ id: "staff-1", role: "staff" }]), ["staff-1"]);
  assert.deepEqual(
    idsToStore([{ id: "staff-1", role: "staff" }, { id: "staff-1", role: "staff" }, { id: "staff-2", role: "staff" }]),
    ["staff-1", "staff-2"],
  );
});

test("an unchanged set of people is recognised in any order", () => {
  assert.ok(sameAssignees([], []));
  assert.ok(sameAssignees(["a", "b"], ["b", "a"]));
  assert.ok(!sameAssignees(["a"], ["a", "b"]));
  assert.ok(!sameAssignees(["a", "b"], ["a", "c"]));
});

test("the card line names everyone but the viewer", () => {
  // Joe's own to-do on Joe's Today: no line.
  assert.equal(describeAssignment([], JOE.userId), null);
  // Handed to Abigail alone.
  assert.equal(describeAssignment([ABIGAIL], JOE.userId)?.label, "Assigned to Abigail Stafki");
  // Shared: each of them sees the other.
  assert.equal(describeAssignment([JOE, ABIGAIL], JOE.userId)?.label, "Assigned to you & Abigail Stafki");
  assert.equal(describeAssignment([JOE, ABIGAIL], ABIGAIL.userId)?.label, "Assigned to you & Joe Stafki");
  assert.deepEqual(describeAssignment([JOE, ABIGAIL], ABIGAIL.userId)?.others, [JOE]);
  // Only hers, on her Today: no line — every card there is hers.
  assert.equal(describeAssignment([ABIGAIL], ABIGAIL.userId), null);
  // Three people, seen by the owner who isn't on it.
  assert.equal(
    describeAssignment([JOE, ABIGAIL, MARCO], "someone-else")?.label,
    "Assigned to Joe Stafki, Abigail Stafki & Marco Rivas",
  );
});

test("names join as a sentence and the notice says who it's shared with", () => {
  assert.equal(joinNames([]), "");
  assert.equal(joinNames(["Abigail"]), "Abigail");
  assert.equal(joinNames(["Joe", "Abigail"]), "Joe & Abigail");
  assert.equal(joinNames(["Joe", "Abigail", "Marco"]), "Joe, Abigail & Marco");
  assert.deepEqual(assignedNotice("Order trim", []), {
    title: "Joe assigned you: Order trim",
    subline: "It's on your Today now.",
  });
  assert.equal(assignedNotice("Order trim", ["Joe Stafki"]).subline, "With Joe Stafki. It's on your Today now.");
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

// ─── Whose mailbox ───────────────────────────────────────────────────────────

const ENV = { refreshToken: "env-token", accountEmail: "joe@sjcarpentryllc.com" };

test("a linked mailbox wins for anyone, owner included", () => {
  const linked = { email: "marco@sjcarpentryllc.com", refresh_token: "marco-token" };
  for (const viewer of [OWNER, STAFF]) {
    const mb = resolveMailbox(viewer, linked, ENV);
    assert.equal(mb.refreshToken, "marco-token");
    assert.equal(mb.email, "marco@sjcarpentryllc.com");
    assert.equal(mb.linked, true, "linked = they may disconnect it");
  }
});

test("owner with nothing linked falls back to the env token", () => {
  // The account live prod is already wired to, and the same token the
  // background jobs and MCP sends use. An existing owner must not have to
  // re-authorize anything for this change.
  const mb = resolveMailbox(OWNER, null, ENV);
  assert.equal(mb.refreshToken, "env-token");
  assert.equal(mb.linked, false, "not linked — so no Disconnect is offered");
});

test("staff with nothing linked get NOTHING — never the owner's mailbox", () => {
  const mb = resolveMailbox(STAFF, null, ENV);
  assert.equal(mb.refreshToken, null);
  assert.equal(mb.email, null);
  assert.equal(mb.userId, STAFF.id);
});

test("owner with no env token and no row also gets nothing", () => {
  // Fresh dev box: the blank state, not a crash and not the demo mock standing
  // in for a real mailbox.
  assert.equal(resolveMailbox(OWNER, null, {}).refreshToken, null);
});

test("the mailbox always records whose it is", () => {
  // lib/mailbox.ts's re-entrancy check compares userId; a null here would make
  // an inner scope silently re-resolve.
  for (const v of [OWNER, STAFF]) {
    assert.equal(resolveMailbox(v, null, ENV).userId, v.id);
    assert.equal(resolveMailbox(v, { email: "x@y.z", refresh_token: "t" }, ENV).userId, v.id);
  }
});
