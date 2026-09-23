import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEmailDraft,
  planApprovedSend,
  approveNotice,
  describeApproval,
} from "../lib/approved-draft-rules.ts";

// Joe's Approve click sends a staged draft only when it is shaped like an
// email to the item's lead/project. These pin the parser and the decision so
// the two failure modes we've hit (silent "nothing sent" on a header-less
// draft; a send to the wrong address) can't creep back in unnoticed.

// ─── parseEmailDraft ─────────────────────────────────────────────────────────

test("no header → null (plain prose is not an email)", () => {
  assert.equal(parseEmailDraft("Hi Sarah,\n\nThanks for reaching out about the deck.\n\nJoe"), null);
});

test("To: only → address, empty subject, body after the blank line", () => {
  const p = parseEmailDraft("To: sarah@example.com\n\nHi Sarah,\n\nThanks for reaching out.\n\nJoe");
  assert.deepEqual(p, { to: "sarah@example.com", subject: "", body: "Hi Sarah,\n\nThanks for reaching out.\n\nJoe" });
});

test("To: + Subject: → both, in either order", () => {
  const a = parseEmailDraft("To: sarah@example.com\nSubject: Your deck\n\nHi Sarah,\nJoe");
  assert.deepEqual(a, { to: "sarah@example.com", subject: "Your deck", body: "Hi Sarah,\nJoe" });
  const b = parseEmailDraft("Subject: Your deck\nTo: sarah@example.com\n\nHi Sarah,\nJoe");
  assert.deepEqual(b, { to: "sarah@example.com", subject: "Your deck", body: "Hi Sarah,\nJoe" });
});

test('"Name <email>" form → bare lower-cased address', () => {
  const p = parseEmailDraft("To: Sarah Kleven <Sarah.Kleven@Example.com>\nSubject: Hello\n\nHi Sarah");
  assert.equal(p?.to, "sarah.kleven@example.com");
  assert.equal(p?.subject, "Hello");
});

test("header keys are case-insensitive; From:/Cc: lines are tolerated", () => {
  const p = parseEmailDraft("from: joe@sjc.com\nTO: sarah@example.com\ncc: bob@example.com\nsubject: Hi\n\nBody");
  assert.deepEqual(p, { to: "sarah@example.com", subject: "Hi", body: "Body" });
});

test("leading blank lines before the header block are ignored", () => {
  const p = parseEmailDraft("\n\n  To: sarah@example.com\n\nBody");
  assert.equal(p?.to, "sarah@example.com");
});

test("headers with no body → null", () => {
  assert.equal(parseEmailDraft("To: sarah@example.com\nSubject: Hi\n\n   \n"), null);
});

test("headers directly followed by prose (no blank line) still parse", () => {
  const p = parseEmailDraft("To: sarah@example.com\nSubject: Hi\nHi Sarah, quick note.");
  assert.deepEqual(p, { to: "sarah@example.com", subject: "Hi", body: "Hi Sarah, quick note." });
});

// ─── planApprovedSend ────────────────────────────────────────────────────────

const lead = { kind: "lead", email: "Sarah@Example.com" };
const project = { kind: "project", email: "egan@example.com" };

test("no draft staged → not_email, and that reason comes first", () => {
  assert.deepEqual(planApprovedSend({ record: lead, draft: null }), {
    outcome: "not_email",
    reason: "no staged draft on the work item",
  });
});

test("draft without To: header → not_email (the Kleven 2026-09-22 case)", () => {
  assert.deepEqual(planApprovedSend({ record: lead, draft: "Hi Sarah, thanks!" }), {
    outcome: "not_email",
    reason: "staged draft has no To: header",
  });
});

test("email-shaped draft on an item with no lead or project → not_email", () => {
  assert.deepEqual(planApprovedSend({ record: null, draft: "To: x@y.com\n\nHi" }), {
    outcome: "not_email",
    reason: "no lead or project on the work item",
  });
});

test("To: matches the lead (case-insensitive) → send, default subject when none given", () => {
  const plan = planApprovedSend({ record: lead, draft: "To: sarah@example.com\n\nHi Sarah" });
  assert.equal(plan.outcome, "send");
  assert.equal(plan.to, "sarah@example.com");
  assert.equal(plan.subject, "Re: your project inquiry — SJ Carpentry");
  assert.equal(plan.body, "Hi Sarah");
});

test("To: matches the project's client email → send with project default subject", () => {
  const plan = planApprovedSend({ record: project, draft: "To: Egan Family <egan@example.com>\n\nHi" });
  assert.equal(plan.outcome, "send");
  assert.equal(plan.to, "egan@example.com");
  assert.equal(plan.subject, "Re: your project — SJ Carpentry");
});

test("To: differs from the record's email → failed (gate reopens), naming both", () => {
  const plan = planApprovedSend({ record: lead, draft: "To: other@example.com\nSubject: Hi\n\nHi" });
  assert.equal(plan.outcome, "failed");
  assert.match(plan.error, /other@example\.com/);
  assert.match(plan.error, /sarah@example\.com/);
});

test("record has no email on file → failed, says 'missing'", () => {
  const plan = planApprovedSend({ record: { kind: "project", email: "" }, draft: "To: a@b.com\n\nHi" });
  assert.equal(plan.outcome, "failed");
  assert.match(plan.error, /project's email is missing/);
});

// ─── owner copy ──────────────────────────────────────────────────────────────

test("approveNotice + describeApproval read as the owner sees them", () => {
  assert.equal(approveNotice("staged draft has no To: header"), "Approved. Nothing was emailed: staged draft has no To: header.");
  assert.deepEqual(describeApproval({ ok: true, sent: { to: "sarah@example.com", subject: "Your deck" } }), {
    kind: "success",
    title: "Emailed",
    message: "Emailed sarah@example.com — Your deck",
  });
  assert.deepEqual(describeApproval({ ok: true, notice: "Approved. Nothing was emailed: x." }), {
    kind: "info",
    title: "Approved",
    message: "Approved. Nothing was emailed: x.",
  });
  assert.equal(describeApproval({ ok: false, error: "boom" }).kind, "error");
});
