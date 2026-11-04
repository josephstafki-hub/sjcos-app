import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeDesignLabel } from "../lib/scope-labels.ts";
test("the undefined direction state explains what the owner needs to decide", () => {
  assert.equal(
    scopeDesignLabel({
      direction_sufficiency: "undefined",
      path: "mood_board",
      status: "open",
    }),
    "Direction needed → Mood board (Open)",
  );
});
test("partial or missing design data never prints missing values", () => {
  assert.equal(scopeDesignLabel(null), "—");
  assert.equal(scopeDesignLabel({ path: "selections" }), "Selections");
  assert.equal(
    scopeDesignLabel({
      direction_sufficiency: "exact",
      path: "direct_estimate",
      status: "approved",
    }),
    "Exact specification → Direct estimate (Approved)",
  );
});
