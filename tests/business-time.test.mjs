import { test } from "node:test";
import assert from "node:assert/strict";
const m = await import("../lib/business-time.ts").catch(() => ({}));
test("F1 Central edits round trip unchanged instants, including seconds and both fall-back hours", () => {
  assert.equal(typeof m.toBusinessInput, "function");
  for (const iso of [
    "2026-10-30T21:00:27.125Z",
    "2026-01-30T21:00:00Z",
    "2026-11-01T06:30:00Z",
    "2026-11-01T07:30:00Z",
  ]) {
    assert.equal(m.fromBusinessInput(m.toBusinessInput(iso), iso), iso);
  }
  assert.equal(m.toBusinessInput("2026-10-30T21:00:00Z"), "2026-10-30T16:00");
  assert.equal(
    m.fromBusinessInput("2026-10-30T17:00"),
    "2026-10-30T22:00:00.000Z",
  );
  assert.equal(
    m.fromBusinessInput("2026-01-30T17:00"),
    "2026-01-30T23:00:00.000Z",
  );
});
test("F1 impossible or ambiguous Central wall times and offset-free instants are rejected", () => {
  assert.equal(typeof m.fromBusinessInput, "function");
  for (const v of [
    "2026-03-08T02:30",
    "2026-11-01T01:30",
    "garbage",
    "2026-02-30T10:00",
  ])
    assert.throws(() => m.fromBusinessInput(v));
  assert.throws(() => m.requireInstant("2026-10-30T10:00"));
  assert.equal(
    m.requireInstant("2026-10-30T10:00:00-05:00"),
    "2026-10-30T10:00:00-05:00",
  );
});
test("F1 dated labor rates split at Central midnight, including 23/25-hour DST days", () => {
  assert.equal(typeof m.splitBusinessDays, "function");
  const pieces = m.splitBusinessDays(
    Date.parse("2026-10-31T04:00:00Z"),
    Date.parse("2026-10-31T07:00:00Z"),
  );
  assert.deepEqual(
    pieces.map((p) => (p.end - p.start) / 3600000),
    [1, 2],
  );
  assert.equal(
    m.splitBusinessDays(
      Date.parse("2026-03-08T06:00:00Z"),
      Date.parse("2026-03-09T05:00:00Z"),
    ).length,
    1,
  );
  assert.equal(
    m.splitBusinessDays(
      Date.parse("2026-11-01T05:00:00Z"),
      Date.parse("2026-11-02T06:00:00Z"),
    ).length,
    1,
  );
});
test("F1 date-only review filters include the whole Central day and reject inverted ranges", () => {
  assert.equal(typeof m.businessReviewRange, "function");
  const r = m.businessReviewRange(
    { from: "2026-03-08", to: "2026-03-08" },
    new Date("2026-03-08T12:00:00Z"),
  );
  assert.equal(r.from, "2026-03-08T06:00:00.000Z");
  assert.equal(r.to, "2026-03-09T05:00:00.000Z");
  assert.ok(
    m.businessReviewRange({ from: "2026-10-31", to: "2026-10-30" }).error,
  );
});
