import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAutomatedSender,
  latestInboundIndex,
  composerExpanded,
} from "../lib/inbox-rules.ts";
import {
  inboxBucket,
  matchesInboxTab,
  triageRank,
  senderPreferenceKey,
  applySenderPreference,
} from "../lib/inbox-experience.ts";
import { approvalPlacement } from "../lib/notification-placement.ts";

test("real-mail automated cases use existing categories, headers, sender and body cues", () => {
  for (const category of [
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
    "CATEGORY_SOCIAL",
    "updates",
  ])
    assert.equal(
      isAutomatedSender("person@example.test", category),
      true,
      category,
    );
  for (const headers of [
    { "List-Unsubscribe": "<mailto:remove@example.test>" },
    { "list-id": "news.example.test" },
    { Precedence: "bulk" },
    { Precedence: "list" },
    { Precedence: "junk" },
    { "Auto-Submitted": "auto-generated" },
  ])
    assert.equal(
      isAutomatedSender("frank.v@easternfinancialpartners.test", "primary", {
        headers,
      }),
      true,
      JSON.stringify(headers),
    );
  for (const email of [
    "eStatements@villagebankonline.com",
    "alerts@bank.test",
    "notify@service.test",
    "billing@service.test",
    "marketing@service.test",
    "news@service.test",
    "info@villagebankonline.com",
  ])
    assert.equal(isAutomatedSender(email), true, email);
  for (const body of [
    "Please do not reply to this email.",
    "This mailbox is not monitored.",
  ])
    assert.equal(
      isAutomatedSender("person@example.test", "primary", { body }),
      true,
      body,
    );
  assert.equal(
    isAutomatedSender("human@example.test", "primary", {
      body: "This mailbox is monitored.",
    }),
    false,
  );
  assert.equal(
    isAutomatedSender("michelle@example.test", "primary", {
      headers: { "Auto-Submitted": "no" },
      body: "Can you update the closet estimate?",
    }),
    false,
  );
});
const base = {
  id: "1",
  channel: "email",
  view: "needs_reply",
  fromEmail: "new@example.test",
};
test("unknown humans and cold pitches are visible in New senders, below linked inbound replies", () => {
  const client = {
    ...base,
    id: "client",
    contactRole: "client",
    projectSlug: "closet",
  };
  const lead = { ...base, id: "lead", contactRole: "lead" };
  const cold = { ...base, subject: "Partnership Opportunity", newSender: true };
  assert.equal(inboxBucket(cold), "new");
  assert.equal(matchesInboxTab(cold, "needs"), false);
  assert.equal(matchesInboxTab(cold, "new"), true);
  assert.equal(
    matchesInboxTab({ ...base, automated: true }, "needs", true),
    false,
  );
  assert.ok(triageRank(client) < triageRank(cold));
  assert.ok(triageRank(lead) < triageRank(cold));
  const key = senderPreferenceKey("Joe@example.test", base.fromEmail);
  assert.notEqual(
    key,
    senderPreferenceKey("staff@example.test", base.fromEmail),
  );
  const other = applySenderPreference(cold, true);
  assert.equal(inboxBucket(other), "other");
  assert.equal(matchesInboxTab(other, "needs", true), false);
  assert.equal(
    inboxBucket(applySenderPreference(cold, false)),
    "new",
    "undo restores review",
  );
  assert.equal(other.view, "needs_reply", "filing never archives");
});
test("inbox approvals start compact at the upper corner and stay below inbox dialogs", () => {
  assert.deepEqual(approvalPlacement("/projects", false, false), {
    compact: false,
    expanded: true,
    corner: "bottom",
    layer: 60,
  });
  for (const [path, active] of [
    ["/inbox", false],
    ["/inbox/thread", false],
    ["/projects", true],
  ]) {
    const p = approvalPlacement(path, active, false);
    assert.deepEqual(p, {
      compact: true,
      expanded: false,
      corner: "top",
      layer: 35,
    });
    assert.equal(approvalPlacement(path, active, true).expanded, true);
  }
});
test("empty composer collapses, saved drafts remain expanded; latest inbound wins outbound-last chains", () => {
  assert.equal(composerExpanded(false, ""), false);
  assert.equal(composerExpanded(true, ""), true);
  assert.equal(composerExpanded(false, "Saved reply"), true);
  assert.equal(composerExpanded(false, "  "), false);
  assert.equal(
    latestInboundIndex([
      { outbound: false },
      { outbound: false },
      { outbound: true },
    ]),
    1,
  );
  assert.equal(latestInboundIndex([{ outbound: true }]), 0);
});
