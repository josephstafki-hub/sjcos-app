import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboxBucket,
  matchesInboxTab,
  tabCounts,
  shortcutFor,
  reminderDueAt,
  messageWorkItem,
  draftKey,
  readDraft,
  writeDraft,
  relatedConversations,
} from "../lib/inbox-experience.ts";
const thread = {
  id: "t1",
  channel: "email",
  fromName: "Tom",
  subject: "Re: Kitchen plans",
  preview: "Please send the plans",
  view: "needs_reply",
  audience: "client",
  projectSlug: "kitchen",
  fromEmail: "tom@example.test",
};
test("split buckets distinguish jobs, leads, subs/vendors and automated mail; Needs me overlaps", () => {
  assert.equal(inboxBucket(thread), "clients");
  assert.equal(
    inboxBucket({ ...thread, projectSlug: undefined, contactRole: "lead" }),
    "leads",
  );
  assert.equal(inboxBucket({ ...thread, audience: "sub" }), "subs");
  assert.equal(inboxBucket({ ...thread, audience: "money" }), "subs");
  assert.equal(inboxBucket({ ...thread, automated: true }), "other");
  assert.equal(matchesInboxTab({ ...thread, automated: true }, "needs"), false);
  assert.equal(
    matchesInboxTab({ ...thread, view: "done" }, "needs", true),
    true,
  );
  assert.deepEqual(
    tabCounts([thread, { ...thread, id: "t2", automated: true }]),
    { needs: 1, clients: 1, leads: 0, subs: 0, new: 0, other: 1 },
  );
});
test("keyboard map never steals typing, modifiers or keys from dialogs and controls", () => {
  for (const [key, action] of Object.entries({
    j: "next",
    k: "previous",
    Enter: "open",
    r: "reply",
    a: "approve",
    e: "done",
    h: "remind",
    l: "link",
    "/": "search",
    "?": "help",
  }))
    assert.equal(shortcutFor({ key }), action);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"])
    assert.equal(shortcutFor({ key: "e", tagName }), null);
  assert.equal(shortcutFor({ key: "e", editable: true }), null);
  assert.equal(shortcutFor({ key: "e", inDialog: true }), null);
  assert.equal(shortcutFor({ key: "e", ctrlKey: true }), null);
  assert.equal(shortcutFor({ key: "E", shiftKey: true }), "done");
});
test("reminders are 8am Central, including DST and Monday from Monday; invalid/past picks rejected", () => {
  assert.equal(
    reminderDueAt("tomorrow", new Date("2026-10-31T23:00:00Z")),
    "2026-11-01T14:00:00.000Z",
  );
  assert.equal(
    reminderDueAt("tomorrow", new Date("2026-03-07T15:00:00Z")),
    "2026-03-08T13:00:00.000Z",
  );
  assert.equal(
    reminderDueAt("monday", new Date("2026-11-02T15:00:00Z")),
    "2026-11-09T14:00:00.000Z",
  );
  assert.equal(
    reminderDueAt("pick", new Date("2026-07-01T05:00:00Z"), "2026-07-06"),
    "2026-07-06T13:00:00.000Z",
  );
  assert.throws(
    () => reminderDueAt("pick", new Date("2026-07-01T15:00:00Z"), "2026-02-30"),
    /valid/,
  );
  assert.throws(
    () => reminderDueAt("pick", new Date("2026-07-01T15:00:00Z"), "2026-06-30"),
    /future/,
  );
});
test("message to-do includes exact email source, job, due and assignees in existing create form", () => {
  const fd = messageWorkItem(
    thread,
    {
      messages: [
        {
          id: "m1",
          fromEmail: "tom@example.test",
          body: ["Please send the plans"],
          date: 1000,
        },
      ],
    },
    {
      title: "Send plans",
      dueAt: "2026-11-02",
      job: "project:kitchen",
      assignees: ["u1"],
    },
  );
  assert.equal(fd.get("title"), "Send plans");
  assert.equal(fd.get("job"), "project:kitchen");
  assert.equal(fd.get("due_at"), "2026-11-02");
  assert.deepEqual(fd.getAll("assigned_user_ids"), ["u1"]);
  assert.deepEqual(JSON.parse(fd.get("email")), {
    message_id: "m1",
    thread_id: "t1",
    from: "tom@example.test",
    received_at: new Date(1000).toISOString(),
  });
  const sms = messageWorkItem(
    { ...thread, id: "sms:1", channel: "sms" },
    { messages: [{ id: "9", body: ["Hi"] }] },
    {},
  );
  assert.equal(sms.get("email"), null);
  assert.equal(sms.get("source_id"), "sms:1");
  assert.throws(
    () => messageWorkItem(thread, { messages: [{ body: ["Hi"] }] }, {}),
    /message/,
  );
});
test("draft persists edited body, recipient and provenance per mailbox/thread; discard removes; unavailable storage is safe", () => {
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
  const key = draftKey("joe@example.test", "t1"),
    draft = {
      body: "Edited reply",
      toEmail: "tom@example.test",
      model: "Hermes",
      ai: true,
    };
  writeDraft(storage, key, draft);
  assert.deepEqual(readDraft(storage, key), draft);
  assert.equal(readDraft(storage, draftKey("staff@example.test", "t1")), null);
  assert.equal(readDraft(storage, draftKey("joe@example.test", "t2")), null);
  writeDraft(storage, key, null);
  assert.equal(readDraft(storage, key), null);
  storage.setItem(key, "broken");
  assert.equal(readDraft(storage, key), null);
  assert.doesNotThrow(() =>
    writeDraft(
      {
        setItem() {
          throw Error("quota");
        },
      },
      key,
      draft,
    ),
  );
});
test("context conversations match person across channels without subject/name false positives", () => {
  const threads = [
    thread,
    {
      ...thread,
      id: "sms:1",
      channel: "sms",
      fromEmail: undefined,
      contactKey: "lead:tom",
    },
    { ...thread, id: "t3", fromEmail: "other@example.test" },
  ];
  assert.deepEqual(
    relatedConversations(threads, {
      threadId: "t1",
      email: "tom@example.test",
      contactKey: "lead:tom",
    }).map((t) => t.id),
    ["sms:1"],
  );
  assert.equal(
    relatedConversations(threads, {
      threadId: "unknown",
      email: "",
      contactKey: undefined,
    }).length,
    0,
  );
});

test("a focused conversation row keeps inbox shortcuts after a mouse click", () => {
  assert.equal(
    shortcutFor({ key: "j", tagName: "BUTTON", listRow: true }),
    "next",
  );
  assert.equal(
    shortcutFor({ key: "Enter", tagName: "BUTTON", listRow: true }),
    "open",
  );
  assert.equal(
    shortcutFor({
      key: "e",
      tagName: "TEXTAREA",
      editable: true,
      listRow: true,
    }),
    null,
  );
});
