import { askBoundary } from "@/lib/thread-access";
import { isAskFailure } from "@/lib/ask-result-codes";
import { withAskLaunchSource } from "@/lib/ask-run-admission";
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
export function createOperatorActions(c = chat, r = runs, g = grants, pageContext = operatorPageContext, boundary = <T>(fn:()=>Promise<T>)=>askBoundary(fn,error=>error instanceof MobileInputError)) {
  // Validate the strict schema first, then fence context serializers and
  // provider/grant callbacks. Delete uses its actor-authorized retry command.
  const fencedAction = <S extends z.ZodType, R>(definition: Parameters<typeof defineAction<S,R>>[0]) => defineAction({...definition,run:(input,user)=>boundary(()=>definition.run(input,user))});
  return {
    "operator.new": fencedAction({ area: "ai", input: z.object({ agent: z.enum(["auto", "claude", "qwen", "hermes"]), folderId: id.nullable().optional(), entity: entity.optional(), context: operatorContextSchema.optional(), options: options.optional() }).strict(), run: async ({ agent, folderId, entity, context, options }, user) => {
      if (user.role !== "owner" && (agent === "hermes" || agent === "qwen")) throw new MobileInputError("Hermes and Qwen act as Joe. Pick Auto or Claude.");
      await pageContext(context, user);
      const result=await c.newConversationAction(agent, { folderId, entity });
      if(isAskFailure(result))return result;
      return { conversationId: result.id, context: context ?? null, options: options ?? null };
    } }),
    "operator.send": fencedAction({ area: "ai", input: z.object({ id, prompt: z.string().max(100000), context: operatorContextSchema.optional(), options: options.optional(), attachments: z.array(z.object({ name: z.string().min(1).max(500), path: z.string().min(1).max(2000) }).strict()).max(20).optional(), subjectWorkItemId: id.optional(), allowSends: z.boolean().optional() }).strict(), run: async ({ id, prompt, context, options, attachments, subjectWorkItemId, allowSends }, user) => {
      if (allowSends && user.role !== "owner") throw new MobileInputError("Only Joe can give express send permission.");
      const contextText = await pageContext(context, user);
      return withAskLaunchSource("panel_mobile", () => c.sendMessageAction(id, prompt, contextText, options, attachments, subjectWorkItemId, allowSends));
    } }),
    // Preserve PollResult's error/nextRunId envelope: the generic dispatcher would
    // otherwise reduce an error result to {error} and lose a follow-on run.
    "operator.poll": fencedAction({ area: "ai", input: z.object({ runId: id }).strict(), run: async ({ runId }) => {const result=await r.pollAgentRun(runId);return isAskFailure(result)?result:{poll:result};} }),
    "operator.stop": fencedAction({ area: "ai", input: z.object({ runId: id }).strict(), run: ({ runId }) => r.stopAgentRun(runId) }),
    "operator.steer": fencedAction({ area: "ai", input: z.object({ runId: id, text: z.string().trim().min(1).max(8000) }).strict(), run: ({ runId, text }) => r.steerAgentRun(runId, text) }),
    "operator.answer": fencedAction({ area: "ai", input: z.object({ id, response: interactionResponse }).strict(), run: ({ id, response }) => r.answerInteractionAction(id, response) }),
    "operator.dismiss": fencedAction({ area: "ai", input: thread, run: ({ id }) => r.dismissInteractionAction(id) }),
    "operator.approveGrant": fencedAction({ area: "ai", ownerOnly: true, input: thread, run: ({ id }) => g.approveGrant(id) }),
    "operator.denyGrant": fencedAction({ area: "ai", ownerOnly: true, input: thread.extend({ note: z.string().max(4000).optional() }), run: ({ id, note }) => g.denyGrant(id, note) }),
    "operator.resetSession": fencedAction({ area: "ai", input: thread, run: ({ id }) => c.resetClaudeSessionAction(id) }),
    "operator.rename": fencedAction({ area: "ai", input: thread.extend({ title: z.string().trim().min(1).max(80) }), run: ({ id, title }) => c.renameConversationAction(id, title) }),
    "operator.archive": fencedAction({ area: "ai", input: thread.extend({ archived: z.boolean() }), run: ({ id, archived }) => c.archiveConversationAction(id, archived) }),
    "operator.pin": fencedAction({ area: "ai", input: thread.extend({ pinned: z.boolean() }), run: ({ id, pinned }) => c.pinConversationAction(id, pinned) }),
    "operator.settle": fencedAction({ area: "ai", input: thread, run: ({ id }) => c.settleConversationAction(id) }),
    "operator.unsettle": fencedAction({ area: "ai", input: thread, run: ({ id }) => c.unsettleConversationAction(id) }),
    "operator.move": fencedAction({ area: "ai", input: thread.extend({ folderId: id.nullable() }), run: ({ id, folderId }) => c.moveConversationAction(id, folderId) }),
    "operator.fileUnder": fencedAction({ area: "ai", input: thread.extend({ entity }), run: ({ id, entity }) => c.fileConversationUnderAction(id, entity) }),
    "operator.delete": defineAction({ area: "ai", input: thread.extend({operationId:z.uuidv4()}), run: ({ id, operationId }) => c.deleteConversationAction(id,operationId) }),
    "operator.createFolder": fencedAction({ area: "ai", input: z.object({ name: z.string().trim().min(1).max(120) }).strict(), run: ({ name }) => c.createFolderAction(name) }),
    "operator.renameFolder": fencedAction({ area: "ai", input: thread.extend({ name: z.string().trim().min(1).max(120) }), run: ({ id, name }) => c.renameFolderAction(id, name) }),
    "operator.collapseFolder": fencedAction({ area: "ai", input: thread.extend({ collapsed: z.boolean() }), run: ({ id, collapsed }) => c.setFolderCollapsedAction(id, collapsed) }),
    "operator.archiveFolder": fencedAction({ area: "ai", input: thread.extend({ archived: z.boolean() }), run: ({ id, archived }) => c.archiveFolderAction(id, archived) }),
  };

}
export const operatorActions = createOperatorActions();
