// Grounded marketing drafts (Joe, 2026-11-03): the model may say only what the
// job's record says. Replays the Louiselle drafts that claimed a bathroom
// remodel and room additions on a kitchen refresh and printed the client's
// name and street address.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraftPrompt, cityFromAddress, draftHeadline, draftProblems, fallbackDraft } from "../lib/marketing-copy.ts";

const louiselle = {
  work: "Kitchen Refresh",
  city: "Minneapolis",
  scope: [],
  lines: [
    { section: "Demolition", text: "Demo island and countertops on all cabinets (cabinet and countertop demo)" },
    { section: "Cabinets", text: "Supply island and pantry cabinets and hardware (maple)" },
    { section: "Countertops", text: "Install quartz counters — Cambria Beaumont" },
    { section: "Electrical", text: "Remove two track lights and install two pendant lights (labor)" },
    { section: "Backsplash", text: "Install tile backsplash — layout, cutting, setting, grouting, caulking, cleanup" },
    { section: "Closets", text: "Supply and install PAX wall-mounted storage frame" },
  ],
  changes: [],
  privateWords: ["Elaine Louiselle", "Elaine Louiselle", "13186 Crane Street Northwest, Minneapolis, Minnesota, 55448"],
};

test("city only, never the street", () => {
  assert.equal(cityFromAddress("13186 Crane Street Northwest, Minneapolis, Minnesota, 55448"), "Minneapolis");
  assert.equal(cityFromAddress("9426 Dunkirk Ln N, Maple Grove, MN 55311"), "Maple Grove");
  assert.equal(cityFromAddress("3315 Yukon Avenue South, St. Louis Park, Minnesota 55426"), "St. Louis Park");
  assert.equal(cityFromAddress("1016 Ashland Ave"), "");
  assert.equal(cityFromAddress(null), "");
});

test("the real Louiselle drafts fail the check: invented rooms, the client's name, the street", () => {
  const blog =
    "Recently, we completed a remarkable project for Elaine Louiselle at her home located at 13186 Crane Street Northwest, Minneapolis, Minnesota. " +
    "The project involved extensive renovations and updates, including kitchen upgrades, bathroom remodeling, and room additions.";
  const problems = draftProblems(blog, louiselle).join(" ");
  assert.match(problems, /a bathroom, which isn't part of this job/);
  assert.match(problems, /an addition, which isn't part of this job/);
  assert.match(problems, /names the client or their address \(.*Elaine.*Louiselle.*13186.*Crane/);
  assert.doesNotMatch(problems, /kitchen/, "the kitchen is on the estimate");
  const social = "🎉 We're thrilled to have completed the renovation at Elaine Louiselle's home in Minneapolis!";
  assert.match(draftProblems(social, louiselle).join(" "), /names the client/);
});

test("a draft built from the record passes", () => {
  const ok =
    "A kitchen refresh in Minneapolis: new maple island and pantry cabinets, Cambria Beaumont quartz counters, two pendant lights and a fresh tile backsplash. " +
    "In addition, we added PAX storage. Contact our office to talk about your project. #kitchen #carpentry #Minneapolis";
  assert.deepEqual(draftProblems(ok, louiselle), []);
  assert.match(draftProblems("New cabinets for $12,000.", louiselle).join(" "), /price/);
});

test("the prompt carries the record and the rules, never the client or street", () => {
  const p = buildDraftPrompt("blog", louiselle);
  assert.match(p, /Work: Kitchen Refresh/);
  assert.match(p, /City: Minneapolis/);
  assert.match(p, /- Countertops: Install quartz counters — Cambria Beaumont/);
  assert.match(p, /Describe only work listed in JOB FACTS/);
  assert.doesNotMatch(p, /Louiselle|Elaine|Crane|13186/);
  assert.equal(draftHeadline(louiselle), "Kitchen Refresh in Minneapolis");
});

test("a job with no record: the prompt forbids naming any room, and paperwork titles aren't work", () => {
  const bare = { work: "Houzz estimate ES-10161", city: "", scope: ["2808 Townview Ave NE, Minneapolis, MN 55418"], lines: [], changes: [], privateWords: ["Bordeau"] };
  const p = buildDraftPrompt("social", bare);
  assert.doesNotMatch(p, /Houzz|ES-10161|Townview/);
  assert.match(p, /don't name a room or a kind of work at all/);
  assert.match(draftProblems("A beautiful new kitchen!", bare).join(" "), /kitchen/);
  assert.equal(draftHeadline(bare), "A recent project");
  const fb = fallbackDraft("social", bare);
  assert.match(fb.body, /^We just wrapped up another home project, and/);
  assert.deepEqual(draftProblems(fb.body, bare), []);
});

test("the fallback says only what the record says", () => {
  const blog = fallbackDraft("blog", louiselle);
  assert.equal(blog.title, "Kitchen Refresh in Minneapolis");
  assert.match(blog.body, /^We recently finished a kitchen refresh in Minneapolis\./);
  assert.match(blog.body, /- Install quartz counters — Cambria Beaumont/);
  assert.deepEqual(draftProblems(blog.body, louiselle), []);
  assert.deepEqual(draftProblems(fallbackDraft("social", louiselle).body, louiselle), []);
});
