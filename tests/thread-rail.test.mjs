import { test } from "node:test";
import assert from "node:assert/strict";
import {
  entityFromRoute,
  groupThreads,
  orderedFolders,
  sortKeysFor,
  partitionThreads,
  resolveThreadStatus,
  rollupStatus,
} from "../lib/thread-rail.ts";

function thread(over = {}) {
  return {
    id: "t",
    agent: "auto",
    title: "x",
    folderId: null,
    createdAt: "2026-09-01 10:00:00+00",
    updatedAt: "2026-09-01 10:00:00+00",
    lastActivityAt: "2026-09-01 10:00:00+00",
    unsettledAt: null,
    settledOverride: null,
    settledAt: null,
    archivedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    needsApproval: false,
    needsInput: false,
    working: false,
    workingSince: null,
    lastRunId: null,
    lastRunStatus: null,
    lastRunEndedAt: "2026-09-01 10:00:00+00",
    suggestedFolder: null,
    ...over,
  };
}

const seenNone = { seen: () => false, currentId: null };

test("status priority: approval > input > working > failed > completed > idle", () => {
  assert.equal(resolveThreadStatus(thread({ needsApproval: true, needsInput: true, working: true }), seenNone), "approval");
  assert.equal(resolveThreadStatus(thread({ needsInput: true, working: true }), seenNone), "input");
  assert.equal(resolveThreadStatus(thread({ working: true, lastRunId: "r", lastRunStatus: "error" }), seenNone), "working");
  assert.equal(resolveThreadStatus(thread({ lastRunId: "r", lastRunStatus: "error" }), seenNone), "failed");
  assert.equal(resolveThreadStatus(thread({ lastRunId: "r", lastRunStatus: "done" }), seenNone), "completed");
  assert.equal(resolveThreadStatus(thread(), seenNone), "idle");
});

test("a seen, currently-open, or pre-tab run's completion is not a pill", () => {
  const t = thread({ id: "a", lastRunId: "r", lastRunStatus: "done" });
  assert.equal(resolveThreadStatus(t, { seen: (id) => id === "r", currentId: null }), "idle");
  assert.equal(resolveThreadStatus(t, { seen: () => false, currentId: "a" }), "idle");
  const tabStart = Date.parse("2026-09-01T12:00:00Z");
  assert.equal(resolveThreadStatus(t, { ...seenNone, sinceMs: tabStart }), "idle");
  const later = thread({ id: "a", lastRunId: "r", lastRunStatus: "done", lastRunEndedAt: "2026-09-01 13:00:00+00" });
  assert.equal(resolveThreadStatus(later, { ...seenNone, sinceMs: tabStart }), "completed");
});

test("rollup picks the most urgent", () => {
  assert.equal(rollupStatus(["idle", "completed", "working"]), "working");
  assert.equal(rollupStatus(["working", "approval"]), "approval");
  assert.equal(rollupStatus([]), "idle");
});

test("partition: pinned / active / settled, archived dropped, activity never reorders", () => {
  const old = thread({ id: "old", createdAt: "2026-08-01 00:00:00+00", updatedAt: "2026-09-10 00:00:00+00" });
  const newer = thread({ id: "new", createdAt: "2026-08-05 00:00:00+00" });
  const reentered = thread({ id: "re", createdAt: "2026-07-01 00:00:00+00", unsettledAt: "2026-09-12 00:00:00+00" });
  const pinned = thread({ id: "pin", pinnedAt: "2026-09-01 00:00:00+00" });
  const settled = thread({ id: "set", settledOverride: "settled", settledAt: "2026-08-20 00:00:00+00" });
  const archived = thread({ id: "arc", archivedAt: "2026-08-20 00:00:00+00" });
  const p = partitionThreads([old, newer, reentered, pinned, settled, archived]);
  assert.deepEqual(p.pinned.map((t) => t.id), ["pin"]);
  // `old` has the newest updated_at but that must not move it up.
  assert.deepEqual(p.active.map((t) => t.id), ["re", "new", "old"]);
  assert.deepEqual(p.settled.map((t) => t.id), ["set"]);
});

test("grouping: unfiled first, folders in manual order, archived folder hides its threads", () => {
  const folders = [
    { id: "f1", name: "Larson kitchen", entityKind: "project", entityId: "larson", entityHref: "/projects/larson", collapsed: false, archivedAt: null, sortKey: null },
    { id: "f2", name: "Old job", entityKind: null, entityId: null, entityHref: null, collapsed: false, archivedAt: "2026-08-01 00:00:00+00", sortKey: null },
    { id: "f3", name: "Empty", entityKind: null, entityId: null, entityHref: null, collapsed: false, archivedAt: null, sortKey: null },
  ];
  const threads = [
    thread({ id: "a", folderId: "f1", lastActivityAt: "2026-09-10 00:00:00+00" }),
    thread({ id: "b", folderId: "f2" }),
    thread({ id: "c", folderId: null, lastActivityAt: "2026-09-12 00:00:00+00" }),
    thread({ id: "d", folderId: "gone", lastActivityAt: "2026-09-01 00:00:00+00" }),
  ];
  const groups = groupThreads(folders, threads);
  assert.deepEqual(groups.map((g) => g.key), ["__unfiled", "f1", "f3"]);
  assert.deepEqual(groups[0].threads.active.map((t) => t.id), ["c", "d"]);
  assert.equal(groups.find((g) => g.key === "f2"), undefined);
  // A quiet folder does not sink below a busy one; a sortKey moves it.
  const busy = [...threads, thread({ id: "e", folderId: "f3", lastActivityAt: "2026-09-15 00:00:00+00" })];
  assert.deepEqual(groupThreads(folders, busy).map((g) => g.key), ["__unfiled", "f1", "f3"]);
  const keyed = folders.map((f) => (f.id === "f3" ? { ...f, sortKey: "000001" } : f));
  assert.deepEqual(groupThreads(keyed, busy).map((g) => g.key), ["__unfiled", "f3", "f1"]);
  assert.deepEqual(orderedFolders(keyed).map((f) => f.id), ["f3", "f1"]);
  assert.deepEqual(sortKeysFor(["b", "a"]), [{ id: "b", sortKey: "000001" }, { id: "a", sortKey: "000002" }]);
});

test("entityFromRoute", () => {
  assert.deepEqual(entityFromRoute("/projects/larson-kitchen"), { kind: "project", id: "larson-kitchen" });
  assert.deepEqual(entityFromRoute("/leads/smith?tab=x"), { kind: "lead", id: "smith" });
  assert.equal(entityFromRoute("/projects"), null);
  assert.equal(entityFromRoute("/today"), null);
  assert.equal(entityFromRoute(null), null);
});
