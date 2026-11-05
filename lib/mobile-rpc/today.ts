import { isAskFailure } from "@/lib/ask-result-codes";
import { withAskLaunchSource } from "@/lib/ask-run-admission";
import { z } from "zod";
import { defineAction, MobileInputError } from "./dispatch";
import { completeTodayItem, snoozeTodayItem, promoteTodayItem, sendBackTodayItem, assignTodayItem, restoreTodayItem } from "@/lib/actions/today";
import { approveWaiting, declineWaiting } from "@/lib/actions/approvals";
import { approveGrant, denyGrant } from "@/lib/actions/owner-grants";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/actions/notifications";
import { createWorkItem } from "@/lib/actions/engine";

import { newConversationAction, sendMessageAction } from "@/lib/actions/ai-chat";
import { pollAgentRun } from "@/lib/actions/dev-agents";
import { getQueueSnapshot } from "@/lib/today";
import { doItDirective, prepDirective } from "@/lib/today-directives";

const id = z.uuid();
const item = z.object({ id }).strict();
const approval = z.object({
  key: z.string().regex(/^(decision|work_item):[0-9a-f-]{36}$/i),
  contentHash: z.string().min(1).nullable(),
}).strict();
export const todayActions = {
  // New to-do from the phone's "+" menu: the same server action as the web's
  // Engine "New to-do" form (engine area; due date and optional job link).
  "today.create": defineAction({
    input: z.object({
      title: z.string().trim().min(1, "Title is required.").max(500),
      notes: z.string().max(20000).optional(),
      dueDate: z.iso.date().optional(),
      projectSlug: z.string().min(1).max(200).optional(),
    }).strict(),
    run: async ({ title, notes, dueDate, projectSlug }, user) => {
      const fd = new FormData();
      fd.set("title", title);
      if (notes) fd.set("body", notes);
      if (dueDate) fd.set("due_at", dueDate);
      if (projectSlug) fd.set("job", `project:${projectSlug}`);
      const res = await createWorkItem(fd);
      if (!res.ok) throw new MobileInputError(res.error);
      return getQueueSnapshot(user);
    },
  }),
  "today.handoff": defineAction({
    input: z.object({ id: z.string().min(1).max(200), kind: z.enum(["do", "prep"]) }).strict(),
    ownerOnly: true,
    run: async ({ id, kind }, user) => {
      const queue = await getQueueSnapshot(user);
      const card = [...queue.priorities, ...queue.waiting.items].find(p => p.id === id && p.id !== "all-clear");
      if (!card) throw new MobileInputError("This item is no longer on Today.");
      if (kind === "do" ? !card.checkable || card.lane !== "chat" : card.lane !== "deep") {
        throw new MobileInputError("That handoff isn't available for this item.");
      }
      const created = await newConversationAction(kind === "do" ? "hermes" : "qwen");
      if(isAskFailure(created))return created;
      const conversationId=created.id;
      const turn = await withAskLaunchSource("panel_mobile", () => sendMessageAction(conversationId, kind === "do" ? doItDirective(card) : prepDirective(card),
        undefined, undefined, undefined, card.checkable ? card.id : undefined, false));
      return turn.ok ? { conversationId, turn } : turn;
    },
  }),
  "today.pollHandoff": defineAction({ input: z.object({ runId: id }).strict(), ownerOnly: true, run: ({ runId }) => pollAgentRun(runId) }),
  "today.complete": defineAction({ input: item, run: ({ id }) => completeTodayItem(id) }),
  "today.snooze": defineAction({ input: z.object({ id, until: z.iso.datetime({ offset: true }).refine(v => Date.parse(v) > Date.now(), "Choose a future snooze date.").optional() }).strict(), run: ({ id, until }) => snoozeTodayItem(id, until ?? 3) }),
  "today.promote": defineAction({ input: item, ownerOnly: true, run: ({ id }) => promoteTodayItem(id) }),
  "today.sendBack": defineAction({ input: item, ownerOnly: true, run: ({ id }) => sendBackTodayItem(id) }),
  "today.assign": defineAction({ input: z.object({ id, userIds: z.array(z.uuid()).max(100) }).strict(), ownerOnly: true, run: ({ id, userIds }) => assignTodayItem(id, userIds) }),
  "today.restore": defineAction({ input: z.object({ id, view: z.enum(["done", "snoozed"]) }).strict(), run: ({ id, view }) => restoreTodayItem(id, view) }),
  "approvals.approve": defineAction({ input: approval, ownerOnly: true, run: ({ key, contentHash }) => approveWaiting(key, contentHash) }),
  "approvals.decline": defineAction({ input: approval.extend({ note: z.string().max(4000).optional() }), ownerOnly: true, run: ({ key, contentHash, note }) => declineWaiting(key, contentHash, note) }),
  "permissions.approve": defineAction({ input: item, ownerOnly: true, run: ({ id }) => approveGrant(id) }),
  "permissions.deny": defineAction({ input: item.extend({ note: z.string().max(4000).optional() }), ownerOnly: true, run: ({ id, note }) => denyGrant(id, note) }),
  "notifications.read": defineAction({ input: item, run: ({ id }) => markNotificationRead(id) }),
  "notifications.readAll": defineAction({ input: z.object({}).strict(), run: () => markAllNotificationsRead() }),
};
