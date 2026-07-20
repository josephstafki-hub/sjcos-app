// Today v2 hand-off directives. Pure string builders (server-safe, no imports)
// for the two feed hand-offs: "Have Hermes do it" and "Prep me". Sent as the
// user turn of a chat conversation. Kept deterministic and out of the model's
// hands — the app decides what the directive says; the agent only executes it.

/** Today v2 · Phase 7. A system-message hint appended to the interactive chat
 *  paths (qwenChat + hermesChat) so a model presenting the Today queue can offer
 *  one-click buttons. Self-gating: it only applies when work_item_ids are in the
 *  conversation, which today happens on /today (todayContext lists them). NOT
 *  used on ollamaChat's JSON calls. Parsed by lib/today-actions.ts. */
export const ACTIONS_HINT =
  "If the conversation is about Joe's Today queue and you reference specific " +
  "work items by their work_item_id, you MAY end your reply with a fenced " +
  "```sjcos-actions block containing a JSON array of " +
  '{"kind","work_item_id","label"} objects, where kind is one of ' +
  '"mark_done", "snooze", or "open". The app turns each into a one-click ' +
  "button for Joe. Only use work_item_ids that already appear in the " +
  "conversation — never invent one — and omit the block entirely when no such " +
  "action applies.";

export interface DirectiveItem {
  id: string;
  title: string;
  sub: string;
  tag: string;
  href?: string;
}

/** Directive sent (as the user turn) when Joe clicks "Have Hermes do it".
 *  Hermes is the only agent with the sjcos MCP tools. */
export function doItDirective(p: DirectiveItem): string {
  return [
    `[TODAY ITEM — please complete this now]`,
    `work_item_id: ${p.id}`,
    `title: ${p.title}`,
    `context: ${p.tag} · ${p.sub}`,
    ``,
    `Use your sjcos MCP tools: get_work_item first; do the work with internal`,
    `tools only; then update_work_item_status to done with a short note, and`,
    `record_agent_run + record_receipt. If any step would contact a client or`,
    `send money documents, DO NOT send — prepare a draft with`,
    `submit_draft_for_approval (it sets the item to approval_needed) and tell me`,
    `what's ready for my approval. Reply with 2-4 sentences on what you did.`,
    ``,
    `If your reply suggests a further one-click step on another Today item, you`,
    `may end with a fenced \`\`\`sjcos-actions block — a JSON array of`,
    `{"kind","work_item_id","label"} objects (kind: mark_done | snooze | open).`,
    `The app renders each as a button. Only reference work_item_ids you were`,
    `given; omit the block if none applies.`,
  ].join("\n");
}

/** Directive for "Prep me" on a deep-lane card: gather context and summarize
 *  what to do when Joe opens the page. Changes no records. */
export function prepDirective(p: DirectiveItem): string {
  return [
    `[PREP ME — do not change any records]`,
    p.id ? `work_item_id: ${p.id}` : null,
    `title: ${p.title}`,
    `context: ${p.tag} · ${p.sub}`,
    p.href ? `page: ${p.href}` : null,
    ``,
    `I'm about to open ${p.href ?? "the relevant page"} to do this myself.`,
    `Gather the context I'll need (recent activity, money, related knowledge)`,
    `and reply with a short "here's what to do when you open the page" note —`,
    `3-5 bullet points. Do NOT change any work item, status, or record; this is`,
    `read-only prep.`,
  ]
    .filter(Boolean)
    .join("\n");
}
