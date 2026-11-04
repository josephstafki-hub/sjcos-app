import { z } from "zod";
import { defineAction, MobileInputError } from "./dispatch";
import * as chat from "@/lib/actions/ai-chat";
import * as runs from "@/lib/actions/dev-agents";
import * as grants from "@/lib/actions/owner-grants";
import { operatorPageContext } from "./operator-reads";
import { CLAUDE_MODEL_VALUES, CLAUDE_CONTEXT_VALUES, CLAUDE_MODE_VALUES, CLAUDE_EFFORT_OPTIONS } from "@/lib/dev-agents-meta";

const id = z.uuid();
const thread = z.object({ id }).strict();
export const operatorContextSchema = z.object({ type: z.enum(["project", "lead", "vendor", "sub"]), slug: z.string().min(1).max(120).regex(/^[\w-]+$/) }).strict();
const entity = z.object({ kind: z.enum(["project", "lead", "vendor", "sub"]), id: z.string().min(1).max(120) }).strict();
const options = z.object({
  model: z.enum(CLAUDE_MODEL_VALUES).optional(), context: z.enum(CLAUDE_CONTEXT_VALUES).optional(),
  mode: z.enum(CLAUDE_MODE_VALUES).optional(), effort: z.enum(CLAUDE_EFFORT_OPTIONS.map(o => o.value)).optional(), withMcp: z.boolean().optional(),
}).strict();
const interactionResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("question"), answers: z.array(z.object({ question: z.string().max(8000), choices: z.array(z.string().max(8000)).max(100), other: z.string().max(8000).optional() }).strict()).max(100) }).strict(),
  z.object({ kind: z.literal("permission"), decision: z.enum(["allow", "deny"]), note: z.string().max(4000).optional() }).strict(),
]);

/** Dependency seam exercises the actual whitelist and schemas without starting an AI run. */
export function createOperatorActions(c = chat, r = runs, g = grants, pageContext = operatorPageContext) {
  return {
    "operator.new": defineAction({ area: "ai", input: z.object({ agent: z.enum(["auto", "claude", "qwen", "hermes"]), folderId: id.nullable().optional(), entity: entity.optional(), context: operatorContextSchema.optional(), options: options.optional() }).strict(), run: async ({ agent, folderId, entity, context, options }, user) => {
      if (user.role !== "owner" && (agent === "hermes" || agent === "qwen")) throw new MobileInputError("Hermes and Qwen act as Joe. Pick Auto or Claude.");
      await pageContext(context, user);
      return { conversationId: await c.newConversationAction(agent, { folderId, entity }), context: context ?? null, options: options ?? null };
    } }),
    "operator.send": defineAction({ area: "ai", input: z.object({ id, prompt: z.string().max(100000), context: operatorContextSchema.optional(), options: options.optional(), attachments: z.array(z.object({ name: z.string().min(1).max(500), path: z.string().min(1).max(2000) }).strict()).max(20).optional(), subjectWorkItemId: id.optional(), allowSends: z.boolean().optional() }).strict(), run: async ({ id, prompt, context, options, attachments, subjectWorkItemId, allowSends }, user) => {
      if (allowSends && user.role !== "owner") throw new MobileInputError("Only Joe can give express send permission.");
      return c.sendMessageAction(id, prompt, await pageContext(context, user), options, attachments, subjectWorkItemId, allowSends);
    } }),
    // Preserve PollResult's error/nextRunId envelope: the generic dispatcher would
    // otherwise reduce an error result to {error} and lose a follow-on run.
    "operator.poll": defineAction({ area: "ai", input: z.object({ runId: id }).strict(), run: async ({ runId }) => ({ poll: await r.pollAgentRun(runId) }) }),
    "operator.stop": defineAction({ area: "ai", input: z.object({ runId: id }).strict(), run: ({ runId }) => r.stopAgentRun(runId) }),
    "operator.steer": defineAction({ area: "ai", input: z.object({ runId: id, text: z.string().trim().min(1).max(8000) }).strict(), run: ({ runId, text }) => r.steerAgentRun(runId, text) }),
    "operator.answer": defineAction({ area: "ai", input: z.object({ id, response: interactionResponse }).strict(), run: ({ id, response }) => r.answerInteractionAction(id, response) }),
    "operator.dismiss": defineAction({ area: "ai", input: thread, run: ({ id }) => r.dismissInteractionAction(id) }),
    "operator.approveGrant": defineAction({ area: "ai", ownerOnly: true, input: thread, run: ({ id }) => g.approveGrant(id) }),
    "operator.denyGrant": defineAction({ area: "ai", ownerOnly: true, input: thread.extend({ note: z.string().max(4000).optional() }), run: ({ id, note }) => g.denyGrant(id, note) }),
    "operator.resetSession": defineAction({ area: "ai", input: thread, run: ({ id }) => c.resetClaudeSessionAction(id) }),
    "operator.rename": defineAction({ area: "ai", input: thread.extend({ title: z.string().trim().min(1).max(80) }), run: ({ id, title }) => c.renameConversationAction(id, title) }),
    "operator.archive": defineAction({ area: "ai", input: thread.extend({ archived: z.boolean() }), run: ({ id, archived }) => c.archiveConversationAction(id, archived) }),
    "operator.pin": defineAction({ area: "ai", input: thread.extend({ pinned: z.boolean() }), run: ({ id, pinned }) => c.pinConversationAction(id, pinned) }),
    "operator.settle": defineAction({ area: "ai", input: thread, run: ({ id }) => c.settleConversationAction(id) }),
    "operator.unsettle": defineAction({ area: "ai", input: thread, run: ({ id }) => c.unsettleConversationAction(id) }),
    "operator.move": defineAction({ area: "ai", input: thread.extend({ folderId: id.nullable() }), run: ({ id, folderId }) => c.moveConversationAction(id, folderId) }),
    "operator.fileUnder": defineAction({ area: "ai", input: thread.extend({ entity }), run: ({ id, entity }) => c.fileConversationUnderAction(id, entity) }),
    "operator.delete": defineAction({ area: "ai", input: thread, run: ({ id }) => c.deleteConversationAction(id) }),
    "operator.createFolder": defineAction({ area: "ai", input: z.object({ name: z.string().trim().min(1).max(120) }).strict(), run: ({ name }) => c.createFolderAction(name) }),
    "operator.renameFolder": defineAction({ area: "ai", input: thread.extend({ name: z.string().trim().min(1).max(120) }), run: ({ id, name }) => c.renameFolderAction(id, name) }),
    "operator.collapseFolder": defineAction({ area: "ai", input: thread.extend({ collapsed: z.boolean() }), run: ({ id, collapsed }) => c.setFolderCollapsedAction(id, collapsed) }),
    "operator.archiveFolder": defineAction({ area: "ai", input: thread.extend({ archived: z.boolean() }), run: ({ id, archived }) => c.archiveFolderAction(id, archived) }),
  };
}
export const operatorActions = createOperatorActions();
