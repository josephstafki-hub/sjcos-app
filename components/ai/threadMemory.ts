/**
 * Which conversation each chat surface had open, so leaving a page and coming
 * back reopens the thread you were in — including one whose agent was still
 * working when you left.
 *
 * Only the id is kept, not the transcript. Every agent turn persists its reply
 * server-side (a Claude run from its detached runner, Qwen/Hermes from their
 * background task), so the surface reloads the thread from the database on the
 * way back in and a reply that landed while you were on another page is simply
 * there. `getConversation` also hands back any still-running dev_agent_runs row
 * for the thread, which is how a poll resumes rather than being lost.
 *
 * Module scope, for the same reasons as components/cmdk/commandBarStore.ts:
 * navigation here is all soft `next/link` nav, so the document — and this
 * module — outlives a route change; a hard refresh reloads the bundle and this
 * Map starts empty. Never touch it during render: these are client components
 * that still server-render, so on the server this module is one shared
 * per-process copy. Effects and event handlers only.
 */

const openThreads = new Map<string, string>();

/** One key per chat surface that can be navigated away from. */
export const ASK_THREAD = "ask"; // /ai
export const TODAY_THREAD = "today"; // /today, /cmdk
export const OPERATOR_THREAD = "operator"; // /today-preview

/** Record (or, with null, forget) the thread a surface has open. Safe to call
 *  from an already-unmounted surface — that's the point: a send that creates
 *  its conversation after you've navigated away still lands here. */
export function rememberThread(key: string, conversationId: string | null): void {
  if (conversationId) openThreads.set(key, conversationId);
  else openThreads.delete(key);
}

export function recallThread(key: string): string | undefined {
  return openThreads.get(key);
}
