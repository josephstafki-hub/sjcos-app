import { test } from "node:test";
import assert from "node:assert/strict";
import * as time from "../lib/schedule-time.ts";
const days = () =>
  Array.from({ length: 5 }, (_, i) => ({
    iso: `2026-10-${26 + i}`,
    dow: ["MON", "TUE", "WED", "THU", "FRI"][i],
    date: String(26 + i),
    today: false,
    blocks: [],
  }));
const block = (label, projectId = "job-a", clock = "All day") => ({
  id: Math.random().toString(),
  projectId,
  projectSlug: projectId,
  projectName: projectId,
  label,
  time: clock,
  tone: "accent",
});
test("multi-day schedule bars reflect consecutive recorded all-day work on the same job", () => {
  assert.equal(typeof time.groupScheduleSpans, "function");
  const d = days();
  for (const day of d.slice(0, 3))
    day.blocks.push(block("Cabinet installation"));
  d[3].blocks.push(block("Cabinet installation", "other-job"));
  const spans = time.groupScheduleSpans(d);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].start, 0);
  assert.equal(spans[0].end, 2);
  assert.equal(spans[0].label, "Cabinet installation");
});
test("separate dates, other jobs, milestones and timed meetings do not imply continuous work", () => {
  assert.equal(typeof time.groupScheduleSpans, "function");
  const d = days();
  d[0].blocks.push(block("Tile"));
  d[2].blocks.push(block("Tile"));
  for (const day of d.slice(0, 2)) {
    day.blocks.push(block("Meeting", "job-a", "09:00"));
    day.blocks.push({
      label: "Project start",
      time: "START",
      tone: "accent",
      auto: true,
    });
  }
  assert.deepEqual(time.groupScheduleSpans(d), []);
});
