import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const root = new URL("../", import.meta.url);
let queries = [];
let handler = () => [];
const lib = (p) => new URL(`lib/${p}.ts`, root).href;
const stubs = {
  "server-only": "export {};",
  "next/cache": "export const revalidatePath = () => {};",
  [lib("db")]:
    "export const query = async (s,p=[]) => { globalThis.__l4queries.push({s,p}); return {rows: await globalThis.__l4handler(s,p)}; }; export const queryOne = async (s,p) => (await query(s,p)).rows[0] ?? null;",
  [lib("ai")]:
    'export const ai = {summarize: async () => ({summary:""})}; export const askOllamaJson = async () => null;',
  [lib("dal")]:
    "export const requireAccess = async () => ({}); export const requireRole = async () => ({});",
  [lib("rooms")]: "export const closeEntityRoom = async () => {};",
  [lib("chat")]: "export const warrantyRoomKey = s => s;",
  [lib("notify")]: "export const emit = async () => {};",
  [lib("commands/db")]:
    'export const withTransaction = async fn => fn(async()=>[]); export const ownerPrincipalForPolicy = async () => ({kind:"service",name:"test"}); export const command = async () => {};',
  [lib("notify-owner")]: "export const notifyOwner = async () => {};",
  [lib("estimating/learning")]:
    "export const ingestCloseoutActuals = async () => {};",
  [lib("closeout/hooks")]: "export const defaultCloseoutHooks = () => ({});",
  [lib("closeout/checklist")]:
    "export const recordWrittenSignoff=async()=>{}; export const confirmCorrectionsBeforeWalkthrough=async()=>{}; export const prepareInternalInspection=async()=>{}; export const scheduleClientWalkthrough=async()=>{};",
  [lib("closeout/postproject")]:
    "export const runDuePostProjectActions=async(run,p,opts)=>{globalThis.__l4postopts=opts;return[];}; export const checkInReplyReceived=async()=>{}; export const recordCloseoutActuals=async()=>{};",
  [lib("client-activity")]: "export const logClientActivity = async () => {};",
};
registerHooks({
  resolve(s, c, next) {
    let url = s.startsWith("@/")
      ? new URL(`${s.slice(2)}.ts`, root).href
      : /^\.\.?\//.test(s) &&
          !/\.[cm]?[jt]s$/.test(s) &&
          c.parentURL?.endsWith(".ts")
        ? new URL(`${s}.ts`, c.parentURL).href
        : s;
    return Object.hasOwn(stubs, url)
      ? { url: `stub:${url}`, shortCircuit: true }
      : next(url, c);
  },
  load(url, c, next) {
    return url.startsWith("stub:")
      ? { format: "module", source: stubs[url.slice(5)], shortCircuit: true }
      : next(url, c);
  },
});
function reset(fn = () => []) {
  queries = [];
  globalThis.__l4queries = queries;
  globalThis.__l4handler = fn;
}
const warranty = await import("../lib/warranty.ts");
const compliance = await import("../lib/compliance.ts");
const renewals = await import("../lib/actions/compliance.ts");
const schedule = await import("../lib/actions/schedule.ts");

test("F2 warranty never uses record modification as closeout or invents statutory terms", async () => {
  reset((s) =>
    s.includes("FROM projects")
      ? [
          {
            project: "Historical import",
            slug: "historical",
            client: null,
            closed: null,
            closed_iso: null,
          },
        ]
      : s.includes("AS today")
        ? [{ today: "2026-10-30" }]
        : [],
  );
  const data = await warranty.getWarrantyData();
  assert.ok(
    queries.every((q) => !/updated_at/.test(q.s)),
    "routine updates cannot start coverage",
  );
  assert.equal(data.underWarrantyTotal, 0);
  assert.ok(data.projects.every((p) => !p.items?.length));
});

test("F5 insurance participates in the same compliance read and renewal queue", async () => {
  const policy = {
    id: "insurance:7",
    title: "General liability · ZZ QA carrier",
    due_label: "Nov 1",
    timeline_date: "Nov 1",
    days_until: 2,
    who: "SJ Carpentry",
    step: "Renew policy",
    dot: "flag",
    kind: "insurance",
    notes: "",
    due: "Nov 1",
  };
  reset((s) =>
    /FROM compliance_items/.test(s) && /insurance_policies/.test(s)
      ? [policy]
      : [],
  );
  const data = await compliance.getComplianceData();
  assert.equal(data.windows[0].items.length, 1);
  assert.equal(data.timeline[0].kind, "insurance");
  const result = await renewals.queueRenewalRequests();
  assert.equal(result.queued, 1);
});

test("F7 malformed schedule time is refused before writing; valid meridiem normalizes", async () => {
  reset();
  const fd = new FormData();
  fd.set("label", "ZZ QA block");
  fd.set("date", "2026-10-30");
  fd.set("time", "garbage");
  const bad = await schedule.createScheduleBlock(fd);
  assert.equal(bad?.ok, false);
  assert.equal(queries.length, 0);
  fd.set("time", "5pm");
  await schedule.createScheduleBlock(fd);
  const ins = queries.find((q) => /INSERT INTO schedule_blocks/.test(q.s));
  assert.equal(ins.p[1], "17:00");
  assert.equal(ins.p[2], 1020);
});

test("F14 resolved warranty claims remain available and can reopen", async () => {
  reset();
  await warranty.getWarrantyData();
  assert.ok(
    queries.some(
      (q) =>
        /FROM warranty_claims/.test(q.s) && !/WHERE resolved = false/.test(q.s),
    ),
  );
  const actions = await import("../lib/actions/warranty.ts");
  assert.equal(typeof actions.reopenWarrantyClaim, "function");
  await actions.reopenWarrantyClaim("claim");
  assert.ok(queries.some((q) => /resolved = false/.test(q.s)));
});

test("F1 correcting design time survives the next read and concurrent session rebuilds", async () => {
  const { materializeDesignerIntervals } = await import(
    "../lib/owner-time/designer.ts"
  );
  const run = async (s) => {
    if (s.includes("FROM designer_activity_events"))
      return [
        { seq: 1, kind: "focus", at: "2026-10-30T15:00:00Z", project_id: null },
        { seq: 2, kind: "end", at: "2026-10-30T16:00:00Z", project_id: null },
      ];
    if (s.includes("INSERT INTO time_intervals") && !s.includes("ON CONFLICT"))
      throw new Error(
        "duplicate key value violates unique constraint uq_time_intervals_event",
      );
    return [];
  };
  await assert.doesNotReject(() =>
    materializeDesignerIntervals(run, "owner", "session", {
      idleThresholdSec: 7200,
    }),
  );
});

test("F6 Undo only restores an authentic removed snapshot, including a legacy time needing correction", async () => {
  reset();
  const forged = {
    id: "00000000-0000-4000-8000-000000000001",
    date: "2026-10-30",
    time: "15:00",
    label: "ZZ QA forged",
    tone: "ghost",
    project_id: null,
  };
  const rejected = await schedule.restoreScheduleBlock(forged);
  assert.equal(rejected.ok, false);
  assert.equal(queries.length, 0);
});

test("F6 authentic Undo preserves even legacy invalid labels, with no invented schedule time", async () => {
  const original = {
    id: "00000000-0000-4000-8000-000000000001",
    date: "2026-10-30",
    time: "garbage",
    label: "ZZ QA legacy",
    tone: "ghost",
    project_id: null,
    sort_min: 0,
  };
  reset((s) => (s.includes("DELETE FROM schedule_blocks") ? [original] : []));
  const deleted = await schedule.deleteScheduleBlock(original.id);
  assert.ok(deleted.removed.signature);
  assert.equal((await schedule.restoreScheduleBlock(deleted.removed)).ok, true);
  const ins = queries.find((q) => q.s.includes("INSERT INTO schedule_blocks"));
  assert.equal(ins.p[2], "garbage");
  reset();
  assert.equal(
    (await schedule.restoreScheduleBlock({ ...deleted.removed, time: "09:00" }))
      .ok,
    false,
  );
  assert.equal(queries.length, 0);
});

test("F7 legacy clock labels sort by time and unknown text is called out", async () => {
  const data = await import("../lib/schedule.ts");
  reset((s) =>
    s.includes("generate_series")
      ? [{ iso: "2026-10-30", dow: "FRI", date: "30", today: true }]
      : s.includes("FROM schedule_blocks b")
        ? ["garbage", "5pm", "8:30 AM"].map((time_label, n) => ({
            id: String(n),
            project_id: null,
            iso: "2026-10-30",
            time_label,
            label: "ZZ QA " + n,
            tone: "ghost",
            project_slug: null,
            project_name: null,
          }))
        : [],
  );
  const result = await data.getScheduleData();
  assert.deepEqual(
    result.days[0].blocks.map((b) => b.time),
    ["08:30", "17:00", "Time needs review"],
  );
});
test("compliance resolution has a recoverable history and reopen path", async () => {
  reset();
  const data = await compliance.getComplianceData();
  assert.ok(Array.isArray(data.history));
  assert.equal(typeof renewals.reopenComplianceItem, "function");
  await renewals.reopenComplianceItem("item");
  assert.ok(queries.some((q) => q.s.includes("SET resolved = false")));
});
test("F2 configured sign-off coverage and explicit expired dates stay distinct from unknown imports", async () => {
  reset((s) =>
    s.includes("FROM warranty_projects")
      ? [
          {
            project: "ZZ QA old terms",
            client: "Client",
            closed: "Oct 30 2010",
            closed_iso: "2010-10-30",
            warranty: "Configured one-year term",
            ends_iso: "2011-10-30",
            flag: null,
          },
        ]
      : s.includes("FROM projects")
        ? [
            {
              project: "ZZ QA signed",
              slug: "signed",
              client: "Client",
              closed: "Oct 1 2026",
              closed_iso: "2026-10-01",
              terms: "Configured carpentry warranty",
            },
            {
              project: "ZZ QA missing terms",
              slug: "missing",
              client: "Client",
              closed: "Oct 1 2026",
              closed_iso: "2026-10-01",
              terms: null,
            },
          ]
        : s.includes("AS today")
          ? [{ today: "2026-10-30" }]
          : [],
  );
  const data = await warranty.getWarrantyData();
  assert.equal(data.underWarrantyTotal, 1);
  assert.equal(
    data.projects.find((p) => p.project === "ZZ QA old terms").status,
    "expired",
  );
  assert.equal(
    data.projects.find((p) => p.project === "ZZ QA missing terms").status,
    "unconfirmed",
  );
  assert.ok(
    data.projects.every((p) => !p.items?.length),
    "no automatic statutory tiers or invented expiration dates",
  );
});
test("F18 flags identify the conflicting job and Central time without exposing IDs or source keys", async () => {
  const { flagLabel } = await import("../lib/owner-time/labels.ts");
  const detail = flagLabel(
    {
      flag: "overlap",
      intervalId: "secret-uuid",
      relatedIntervalId: "other-uuid",
      detail: "designer_activity overlaps other-uuid",
    },
    [
      {
        id: "other-uuid",
        project_id: "project-uuid",
        source: "designer_activity",
        start_at: "2026-10-30T15:00:00Z",
      },
    ],
    [{ id: "project-uuid", name: "ZZ QA Kitchen" }],
  );
  assert.match(detail, /ZZ QA Kitchen/);
  assert.match(detail, /10:00 AM/);
  assert.ok(!/uuid|designer_activity/.test(detail));
});

test("F2 V45 runtime follow-through does not append unconfigured statutory coverage", async () => {
  const { runPostProjectTick } = await import("../lib/closeout/server.ts");
  await runPostProjectTick(new Date("2026-10-30T12:00:00Z"));
  assert.deepEqual(
    globalThis.__l4postopts.mnTiers,
    [],
    "only configured warranty terms may populate the document",
  );
});
