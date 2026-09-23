import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTIMATE_KIND_LABEL,
  PROJECT_STATUS_LABEL,
  WHERE,
  changeOrderRefusal,
  describeScopeChangePath,
  isEstimateKind,
  preconChangeRefusal,
  scopeChangeContext,
  scopeChangePath,
} from "../lib/estimate-kinds.ts";

// The pure mirror of project_scope_change_path() (db/schema.sql). The SQL is
// what actually decides; tests/estimate-kinds-db.test.mjs checks the two agree
// against a real database. See docs/estimates-and-change-orders.md.

test("scopeChangePath: the contract signature is the dividing line", () => {
  for (const s of ["precon_signed", "floor_plan", "mood_board", "selections", "bidding"]) {
    assert.equal(scopeChangePath(s, false), "precon_estimate", s);
    // A stray signed-contract row does not move a pre-construction job — the
    // status is what the team advanced, and it is what the agent sees.
    assert.equal(scopeChangePath(s, true), "precon_estimate", `${s} with a signed contract row`);
  }
  // The "Construction contract" stage straddles the line: the paperwork decides.
  assert.equal(scopeChangePath("construction_contract", false), "precon_estimate");
  assert.equal(scopeChangePath("construction_contract", true), "change_order");
  for (const s of ["construction", "closeout", "warranty"]) {
    assert.equal(scopeChangePath(s, false), "change_order", s);
    assert.equal(scopeChangePath(s, true), "change_order", s);
  }
});

test("scopeChangeContext carries the human status label", () => {
  const ctx = scopeChangeContext("floor_plan", false);
  assert.deepEqual(ctx, { status: "floor_plan", statusLabel: "Floor plan", hasSignedContract: false, path: "precon_estimate" });
  assert.equal(Object.keys(PROJECT_STATUS_LABEL).length, 9, "one label per project status");
});

test("refusals name the status and the exact tab › section to use instead", () => {
  const precon = scopeChangeContext("selections", false);
  const co = changeOrderRefusal(precon);
  assert.match(co, /pre-construction \(Selections\)/);
  assert.ok(co.includes(WHERE.worksheets), "points at Money › Estimate");
  assert.ok(co.includes("Pre-con change"), "names the worksheet kind");

  const site = scopeChangeContext("construction", false);
  const pc = preconChangeRefusal(site);
  assert.match(pc, /under contract \(Construction\)/);
  assert.ok(pc.includes(WHERE.changeOrders), "points at Money › Change orders");
});

test("the Money-tab banner says which record a client change becomes", () => {
  const precon = describeScopeChangePath(scopeChangeContext("bidding", false));
  assert.equal(precon.headline, "Pre-construction · Bidding");
  assert.match(precon.detail, /Pre-con change worksheet/);
  assert.match(precon.detail, /once the contract is signed/);

  const site = describeScopeChangePath(scopeChangeContext("closeout", true));
  assert.equal(site.headline, "Under contract · Closeout");
  assert.ok(site.detail.includes(WHERE.changeOrders));
});

test("estimate kinds", () => {
  assert.equal(ESTIMATE_KIND_LABEL.formal, "Formal estimate");
  assert.equal(ESTIMATE_KIND_LABEL.precon_change, "Pre-con change");
  assert.ok(isEstimateKind("formal") && isEstimateKind("precon_change"));
  assert.ok(!isEstimateKind("revision") && !isEstimateKind(undefined));
});
