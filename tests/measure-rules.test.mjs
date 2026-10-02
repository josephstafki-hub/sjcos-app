import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCases, deriveOwnerSeconds, deriveMode, rate } from "../lib/measure/math.ts";
import { classifyMemory, isUnapprovedAuthorityChange } from "../lib/measure/learning.ts";
import { extractToolRefs, extractFieldRefs, findContradictions, CONTRADICTION_RULES } from "../lib/measure/procedures.ts";
import { summarizeOverhead, monthlyEquivalentCents, activeInMonth } from "../lib/overhead/overhead.ts";

// Pure A18 rules — no database.

const W = { from: "2026-09-01", to: "2026-10-01" };
const row = (o) => ({ kind: "lead_followup", eligible: true, outcome: "pending", mode: "unknown", owner_seconds: null, agent_seconds: null, latency_ms: null, cost_usd: null, created_at: "2026-09-02", closed_at: null, ...o });

test("summary math: failures stay in the denominator, zero denominator is null, unknowns counted", () => {
  const s = summarizeCases(
    [
      row({ outcome: "verified_success", mode: "unattended", owner_seconds: 0, cost_usd: "0.10", latency_ms: "1000" }),
      row({ outcome: "failed", latency_ms: "3000" }),
      row({ outcome: "corrected", mode: "assisted", owner_seconds: 300, cost_usd: 0.2 }),
      row({ outcome: "unknown_effect" }),
      row({ outcome: "missed_commitment", mode: "one_tap" }),
      row({ outcome: "pending" }),
      row({ kind: "invoice", eligible: false, outcome: "verified_success" }),
      row({ kind: "invoice", outcome: "pending" }),
    ],
    W,
  );
  const lead = s.kinds.find((k) => k.kind === "lead_followup");
  assert.equal(lead.eligible, 6);
  assert.deepEqual(lead.verified_rate, { numerator: 1, denominator: 5, value: 0.2 });
  assert.equal(lead.pending, 1);
  assert.equal(lead.unattended, 1);
  assert.equal(lead.one_tap, 1, "one-tap is its own bucket, never unattended");
  assert.equal(lead.assisted, 1);
  assert.equal(lead.owner_minutes, 5);
  assert.equal(lead.owner_minutes_unknown, 4);
  assert.equal(lead.cost_usd, 0.3);
  assert.equal(lead.cost_unknown, 4);
  assert.deepEqual(lead.latency, { n: 2, median_ms: 2000, mean_ms: 2000 });
  const inv = s.kinds.find((k) => k.kind === "invoice");
  assert.equal(inv.excluded, 1);
  assert.equal(inv.eligible, 1);
  assert.deepEqual(inv.verified_rate, { numerator: 0, denominator: 0, value: null }, "no terminal cases → null, not 0 or 100");
  assert.equal(s.totals.eligible, 7);
  assert.deepEqual(s.window, W);
  assert.ok(s.caveats.some((c) => c.includes("2026-09-01") && c.includes("2026-10-01")), "window is stated with the rate");
  assert.deepEqual(rate(0, 0), { numerator: 0, denominator: 0, value: null });
});

test("owner seconds + mode derivation", () => {
  assert.deepEqual(deriveOwnerSeconds(undefined, []), { seconds: null, touches: 0, touches_unknown_seconds: 0 });
  assert.deepEqual(deriveOwnerSeconds(undefined, [{ seconds: null }]), { seconds: null, touches: 1, touches_unknown_seconds: 1 }, "an untimed touch is unknown time, not zero");
  assert.deepEqual(deriveOwnerSeconds(undefined, [{ seconds: 120 }, { seconds: null }, { seconds: 30 }]), { seconds: 150, touches: 3, touches_unknown_seconds: 1 });
  assert.deepEqual(deriveOwnerSeconds(90.4, [{ seconds: 5 }]), { seconds: 90, touches: 1, touches_unknown_seconds: 0 }, "explicit wins");
  assert.equal(deriveMode(undefined, []), "unknown");
  assert.equal(deriveMode("unattended", []), "unattended");
  assert.equal(deriveMode(undefined, [{ kind: "approve" }]), "one_tap");
  assert.equal(deriveMode(undefined, [{ kind: "approve" }, { kind: "approve" }]), "assisted");
  assert.equal(deriveMode(undefined, [{ kind: "correction" }]), "assisted");
  assert.equal(deriveMode("unattended", [{ kind: "edit" }]), "unattended", "an explicit mode from the caller is kept; callers must not claim unattended when touches exist");
});

test("memory classifier: one-job preference vs factual correction vs proposed company rule", () => {
  const c = (m) => classifyMemory(m);
  assert.equal(c({ memory_type: "preference", content: "The Larsons prefer texts instead of email.", lead_id: "x" }), "one_job_preference");
  assert.equal(c({ memory_type: "preference", content: "Kleven wants the invoice mailed.", project_id: "p" }), "one_job_preference");
  assert.equal(c({ memory_type: "fact", content: "The deck is actually 14x20 ft, not 12x20." }), "factual_correction");
  assert.equal(c({ memory_type: "observation", content: "Correction: the client email is jane@example.test, not john@." }), "factual_correction");
  assert.equal(c({ memory_type: "instruction", content: "From now on always send invoices the same day without approval." }), "proposed_company_rule");
  assert.equal(c({ memory_type: "preference", content: "Never text clients after 6pm." }), "proposed_company_rule", "company-wide phrasing outranks the preference label");
  assert.equal(c({ memory_type: "instruction", content: "Send the Larson estimate by Friday.", lead_id: "x" }), "one_job_preference", "a job-scoped instruction is not a company rule");
  assert.equal(c({ memory_type: "instruction", content: "Apply a 25% markup to all subs going forward." }), "proposed_company_rule");
  assert.equal(c({ memory_type: "observation", content: "Joe replied to the Kleven thread himself." }), "observation");
  assert.equal(c({ memory_type: "observation", content: "Always pay vendor invoices without asking." }), "proposed_company_rule");
});

test("unapproved authority change: pending + company rule + send/pay/price language only", () => {
  assert.equal(isUnapprovedAuthorityChange({ memory_type: "instruction", content: "Always send invoices without approval.", review_status: "pending" }), true);
  assert.equal(isUnapprovedAuthorityChange({ memory_type: "instruction", content: "Always send invoices without approval.", review_status: "approved" }), false, "approved is authority, not a proposal");
  assert.equal(isUnapprovedAuthorityChange({ memory_type: "instruction", content: "Always send invoices without approval.", review_status: "rejected" }), false);
  assert.equal(isUnapprovedAuthorityChange({ memory_type: "instruction", content: "Always file site photos under the project.", review_status: "pending" }), false, "a rule with no send/pay/price authority is not flagged");
  assert.equal(isUnapprovedAuthorityChange({ memory_type: "preference", content: "The Larsons want texts.", lead_id: "x", review_status: "pending" }), false);
});

test("procedure refs: tools and fields extracted, contradictions gated by active policy", () => {
  const body = "Call get_project, then send_invoice_magic. Read work_item.due_at and retainer_status. Keep the ToDo.";
  assert.deepEqual(extractToolRefs(body, ["get_project"]), ["get_project", "send_invoice_magic"]);
  assert.deepEqual(extractToolRefs("nothing tool-like here, just due_at"), []);
  assert.deepEqual(extractFieldRefs(body, ["due_at"]), ["due_at", "retainer_status"]);
  const skill = "Invoices always need Joe's send. Follow-ups must have Joe's approval. Markup can be changed without approval.";
  const none = findContradictions(skill, new Set());
  assert.deepEqual(none.map((r) => r.id), ["profit_policy"], "DECISIONS.md rules fire without a policy; policy rules do not");
  const both = findContradictions(skill, new Set(["invoice.initial_on_acceptance", "routine.followup"]));
  assert.deepEqual(both.map((r) => r.id).sort(), ["invoice.initial_on_acceptance", "profit_policy", "routine.followup"]);
  assert.deepEqual(findContradictions("Tell Joe first when a delay shows up, then the client.", new Set(CONTRADICTION_RULES.map((r) => r.policyKey).filter(Boolean))), []);
  assert.deepEqual(findContradictions("If there is a delay, email the client directly.", new Set()).map((r) => r.id), ["urgent_issues"]);
});

test("overhead math: fixed vs metered, yearly normalised, unknown providers, threshold", () => {
  assert.equal(monthlyEquivalentCents(12000, "yearly"), 1000);
  assert.equal(monthlyEquivalentCents(500, "monthly"), 500);
  assert.equal(activeInMonth({ started_on: "2026-09-01", ended_on: null }, "2026-09"), true);
  assert.equal(activeInMonth({ started_on: "2026-10-01", ended_on: null }, "2026-09"), false);
  assert.equal(activeInMonth({ started_on: "2026-01-01", ended_on: "2026-08-31" }, "2026-09"), false);
  const sub = (o) => ({ id: "1", name: "n", vendor: "Anthropic", amount_cents: 20000, cadence: "monthly", source: "owner_reported", started_on: "2026-09-01", ended_on: null, external_ref: null, notes: "", created_at: "", updated_at: "", ...o });
  const s = summarizeOverhead(
    [sub({}), sub({ id: "2", vendor: "OpenAI", amount_cents: 1000, source: "bill", external_ref: "b1" }), sub({ id: "3", vendor: "Registrar", amount_cents: 12000, cadence: "yearly" }), sub({ id: "4", vendor: "Gone", ended_on: "2026-08-01" })],
    [
      { id: "c1", provider: "anthropic", period: "2026-09", amount_cents: 3450, source: "bill", external_ref: "x", notes: "", created_at: "" },
      { id: "c2", provider: "Anthropic", period: "2026-09", amount_cents: 50, source: "estimate", external_ref: null, notes: "", created_at: "" },
      { id: "c3", provider: "anthropic", period: "2026-08", amount_cents: 9999, source: "bill", external_ref: "y", notes: "", created_at: "" },
    ],
    "2026-09",
    25000,
  );
  assert.equal(s.fixed.monthly_cents, 22000);
  assert.equal(s.fixed.lines.length, 3);
  assert.equal(s.metered.cents, 3500, "only this month's charges; provider matched case-insensitively");
  assert.deepEqual(s.metered.by_provider, [{ provider: "anthropic", cents: 3500, source: ["bill", "estimate"] }]);
  assert.deepEqual(s.metered.unknown_providers, ["openai", "registrar"]);
  assert.equal(s.total_known_cents, 25500);
  assert.deepEqual(s.alert, { threshold_cents: 25000, exceeded: true });
  assert.ok(s.caveats.some((c) => /estimate, not a bill/.test(c)));
  assert.ok(s.caveats.some((c) => /does not include API credits/.test(c)));
  assert.equal(summarizeOverhead([], [], "2026-09", null).alert.exceeded, false);
});
