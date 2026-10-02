// /engine queue folders + filters (2026-10-02) — lib/engine-views.ts.
//
// The rule worth pinning is WHO a folder holds. Two different "who"s live on a
// to-do: the PEOPLE on it (work_item_assignees; nobody = the owner's own) and
// the bot RUNTIME that runs it (assignee_kind 'agent' + assignee_key). Mix them
// up and Joe's folder fills with Hermes's runs, or Abigail's folder shows
// Joe's whole board. tests/work-item-archive-db.test.mjs checks the SQL twin of
// these rules against a real Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_FILTER,
  agentLabel,
  matchesQueueFilter,
  queueFilterSql,
  queueFolders,
  splitWho,
} from "../lib/engine-views.ts";

const OWNER = "owner-1";
const ABBY = "staff-1";

const item = (over = {}) => ({
  title: "Call the tile sub",
  body: "",
  status: "queued",
  assigneeKind: "human",
  assigneeKey: "human-joe",
  assignedTo: [],
  projectSlug: null,
  projectName: null,
  leadSlug: null,
  leadName: null,
  createdBy: "user",
  ...over,
});

const mine = item();
const abbys = item({ assignedTo: [{ userId: ABBY }] });
const shared = item({ assignedTo: [{ userId: OWNER }, { userId: ABBY }] });
const hermes = item({ assigneeKind: "agent", assigneeKey: "hermes-telegram", createdBy: "hermes-cron" });
const hermesWithAbby = item({ assigneeKind: "agent", assigneeKey: "hermes-telegram", assignedTo: [{ userId: ABBY }] });
const unnamedAgent = item({ assigneeKind: "agent", assigneeKey: null });
const ALL = [mine, abbys, shared, hermes, hermesWithAbby, unnamedAgent];

const pick = (who) => ALL.filter((i) => matchesQueueFilter(i, { ...NO_FILTER, who }, OWNER));

test("the owner's folder: nobody-on-it human to-dos plus any he shares — not a handed-off one, not an agent's run", () => {
  assert.deepEqual(pick(`person:${OWNER}`), [mine, shared]);
});

test("a staff folder is strictly what they're on — never the owner's unassigned to-dos", () => {
  assert.deepEqual(pick(`person:${ABBY}`), [abbys, shared, hermesWithAbby]);
});

test("an agent folder is that runtime's work, whoever is on it", () => {
  assert.deepEqual(pick("agent:hermes-telegram"), [hermes, hermesWithAbby]);
  assert.deepEqual(pick("agent:"), [unnamedAgent], "an agent item with no runtime named has its own folder");
  assert.deepEqual(pick("agent:human-joe"), [], "a person's to-do is never an agent's");
});

test("everything is everything", () => {
  assert.deepEqual(pick("all"), ALL);
});

test("job, filed-by and search narrow within the folder", () => {
  const larson = item({ projectSlug: "larson", projectName: "Larson Kitchen", createdBy: "inbox-cron" });
  const kleven = item({ leadSlug: "kleven", leadName: "Kleven Deck", body: "Wants composite decking" });
  const both = [larson, kleven, mine];
  const f = (over) => both.filter((i) => matchesQueueFilter(i, { ...NO_FILTER, ...over }, OWNER));
  assert.deepEqual(f({ job: "project:larson" }), [larson]);
  assert.deepEqual(f({ job: "lead:kleven" }), [kleven]);
  assert.deepEqual(f({ job: "lead:larson" }), [], "a project slug is not a lead slug");
  assert.deepEqual(f({ by: "inbox-cron" }), [larson]);
  assert.deepEqual(f({ q: "  KITCHEN " }), [larson], "search is trimmed, case-blind, and reads the job name");
  assert.deepEqual(f({ q: "composite" }), [kleven], "search reads the details");
});

test("folders: everyone first, people in roster order, every known agent even when empty, plus strays", () => {
  const items = [
    ...ALL,
    item({ status: "done" }),
    item({ assigneeKind: "agent", assigneeKey: "some-new-bot" }),
  ];
  const people = [{ userId: OWNER, name: "Joe Stafki" }, { userId: ABBY, name: "Abigail Stafki" }];
  const f = queueFolders(items, people, OWNER);
  assert.equal(f.all.open, ALL.length + 1, "counts are open work — the done item is left out");
  assert.deepEqual(f.people.map((p) => [p.label, p.open]), [["Joe Stafki", 2], ["Abigail Stafki", 3]]);
  assert.deepEqual(
    f.agents.map((a) => [a.who, a.label, a.open]),
    [
      ["agent:hermes-telegram", "Hermes", 2],
      ["agent:claude-code-server", "Claude Code", 0],
      ["agent:claude-in-app", "Claude (in app)", 0],
      ["agent:codex-server", "Codex", 0],
      ["agent:", "Agent (none named)", 1],
      ["agent:some-new-bot", "some-new-bot", 1],
    ],
  );
});

test("agentLabel and splitWho", () => {
  assert.equal(agentLabel("claude-code-server"), "Claude Code");
  assert.equal(agentLabel("mystery"), "mystery");
  assert.deepEqual(splitWho("all"), ["all", ""]);
  assert.deepEqual(splitWho("agent:"), ["agent", ""]);
  assert.deepEqual(splitWho("lead:a:b"), ["lead", "a:b"]);
});

test("SQL twin: binds every value, never interpolates one", () => {
  const params = ["already-there"];
  const conds = queueFilterSql(
    { who: `person:${ABBY}`, job: "project:larson", by: "inbox-cron", q: "50%_off\\" },
    OWNER,
    params,
  );
  assert.deepEqual(params, ["already-there", ABBY, "larson", "inbox-cron", "%50\\%\\_off\\\\%"]);
  const sql = conds.join(" AND ");
  assert.match(sql, /wa\.user_id = \$2/, "numbering continues after existing params");
  assert.ok(!/NOT EXISTS/.test(sql), "a staff folder has no nobody-on-it escape hatch");
  assert.match(sql, /p\.slug = \$3/);
  assert.match(sql, /w\.created_by = \$4/);
  assert.match(sql, /w\.title ILIKE \$5/);
  for (const v of [ABBY, "larson", "inbox-cron", "50%"]) assert.ok(!sql.includes(v), `${v} must be bound, not inlined`);
});

test("SQL twin: the owner's folder includes nobody-on-it human work; no filter = no conditions", () => {
  const params = [];
  const sql = queueFilterSql({ ...NO_FILTER, who: `person:${OWNER}` }, OWNER, params).join(" AND ");
  assert.match(sql, /w\.assignee_kind = 'human' AND NOT EXISTS/);
  assert.deepEqual(queueFilterSql(NO_FILTER, OWNER, []), []);
});
