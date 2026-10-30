import { test } from "node:test";
import assert from "node:assert/strict";
import { withTestDb, harnessAvailable, cleanFoundation } from "./_harness/testdb.mjs";
import { compactEstimateValue } from "../lib/lead-estimate-value.mjs";
import { checkRoughEstimateEmail, dollarFigures, mailboxKey, markRoughEstimateSent } from "../lib/leads/rough-estimate-email.ts";

// Dessonville, 2026-10-30: the lead read "?" though an agent had emailed him a
// $13,500 – $19,500 rough estimate with send_email; nothing was saved on the
// lead. A lead's value now follows its saved rough estimate in Postgres
// (migration 0040), and an email that reads as a rough estimate goes to an open
// lead only from the estimate saved on it.

const skip = !harnessAvailable() && "postgresql-16 binaries not installed";

test("mailbox keys and dollar figures", () => {
  assert.equal(mailboxKey("Timothy.Dessonville+jobs@Gmail.com"), "timothydessonville@gmail.com");
  assert.equal(mailboxKey("t.d@googlemail.com"), "td@gmail.com");
  assert.equal(mailboxKey("first.last@fastmail.com"), "first.last@fastmail.com", "dots only fold on Gmail");
  assert.deepEqual(dollarFigures("Rough total: $13,500 – $19,500 (about $15k)"), [13500, 19500, 15000]);
});

test("rough-estimate value: dollar amounts only, never a +$ difference, lowest to highest", () => {
  assert.deepEqual(compactEstimateValue("Option A $110,000–$146,000  ·  Option B (incl. 2nd floor) $196,000–$259,000"), { display: "$110–259k", value: 177750 });
  assert.deepEqual(compactEstimateValue("15x15: $44,000 / 18x15: $50,200 (+$6,200)"), { display: "$44–50k", value: 47100 });
  assert.deepEqual(compactEstimateValue("$51,000 – $64,500"), { display: "$51–65k", value: 57750 });
  assert.deepEqual(compactEstimateValue("13500-19500"), { display: "$14–20k", value: 16500 }, "no $ at all: every number counts");
  assert.equal(compactEstimateValue("TBD"), null);
});

test("a lead's value follows its saved rough estimate, the same as the app's parser", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanFoundation(client);
    const q = async (sql, p) => (await client.query(sql, p)).rows;
    const [{ id }] = await q(`INSERT INTO leads (slug, name, email, value_display, estimate_value) VALUES ('zz-lv', 'ZZ Lead', 'zz@example.test', '$40k budget', 40000) RETURNING id`);
    const value = async () => (await q(`SELECT value_display AS d, estimate_value AS v FROM leads WHERE id = $1`, [id]))[0];

    // No rough estimate: the intake value stays.
    assert.deepEqual(await value(), { d: "$40k budget", v: 40000 });

    for (const total of [
      "$13,500 – $19,500",
      "$125,000–$175,000",
      "$15,000",
      "Option A $110,000–$146,000  ·  Option B (incl. 2nd floor) $196,000–$259,000",
      "15x15: $44,000 / 18x15: $50,200 (+$6,200)",
      "13500-19500",
      "$1,499.50 - $2,500",
    ]) {
      await q(`INSERT INTO lead_estimates (lead_id, total) VALUES ($1, $2) ON CONFLICT (lead_id) DO UPDATE SET total = EXCLUDED.total`, [id, total]);
      const js = compactEstimateValue(total);
      assert.deepEqual(await value(), { d: js.display, v: js.value }, total);
    }

    // A typed figure doesn't stick while an estimate with a figure is saved.
    await q(`UPDATE leads SET value_display = '?', estimate_value = NULL WHERE id = $1`, [id]);
    assert.deepEqual(await value(), { d: "$1–3k", v: 2000 });

    // A total with no figure leaves the value alone.
    await q(`UPDATE lead_estimates SET total = 'TBD' WHERE lead_id = $1`, [id]);
    await q(`UPDATE leads SET value_display = '$9k', estimate_value = 9000 WHERE id = $1`, [id]);
    assert.deepEqual(await value(), { d: "$9k", v: 9000 });
  });
});

test("a rough-estimate email to an open lead goes only from the estimate saved on it", { skip }, async () => {
  await withTestDb(async (_url, client) => {
    await cleanFoundation(client);
    const run = async (sql, p) => (await client.query(sql, p)).rows;
    const [{ id }] = await run(`INSERT INTO leads (slug, name, email, stage) VALUES ('zz-td', 'ZZ Timothy', 'zz.timothy@gmail.com', 'rough_estimate') RETURNING id`);
    const body = "Hi,\n\nHere's a Phase 1 rough estimate.\n\nRough total: $13,500 – $19,500\n\nJoe";
    const check = (to, text = body, subject = "Phase 1 rough estimate — SJ Carpentry") => checkRoughEstimateEmail(run, { to, subject, body: text });

    // Nothing saved: refused (Gmail dot-folding still finds the lead).
    const r1 = await check("zztimothy@gmail.com");
    assert.equal(r1.kind, "refuse");
    assert.match(r1.error, /no rough estimate is saved/);

    // Saved, but the email carries other figures: refused.
    await run(`INSERT INTO lead_estimates (lead_id, total) VALUES ($1, '$12,000 – $18,000')`, [id]);
    assert.match((await check("zz.timothy@gmail.com")).error, /don't match/);

    // Saved and matching: passes, and marks it sent once it goes out.
    await run(`UPDATE lead_estimates SET total = '$13,500 – $19,500' WHERE lead_id = $1`, [id]);
    const ok = await check("zz.timothy@gmail.com");
    assert.deepEqual(ok, { kind: "mark", leadId: id, leadName: "ZZ Timothy" });
    await markRoughEstimateSent(run, id, "claude");
    const [est] = await run(`SELECT status, sent_at IS NOT NULL AS sent FROM lead_estimates WHERE lead_id = $1`, [id]);
    assert.deepEqual(est, { status: "sent", sent: true });

    // Not a rough estimate, someone who isn't a lead, or a lead already a project: untouched.
    assert.deepEqual(await check("zz.timothy@gmail.com", "Can we meet Tuesday?", "Site visit"), { kind: "pass" });
    assert.deepEqual(await check("nobody@example.test"), { kind: "pass" });
    await run(`INSERT INTO projects (slug, name, lead_id) VALUES ('zz-td-p', 'ZZ TD', $1)`, [id]);
    assert.deepEqual(await check("zz.timothy@gmail.com", "rough estimate $1"), { kind: "pass" });
  });
});
