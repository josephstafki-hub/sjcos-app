import type { ChatAttachment } from "@/lib/actions/ai-chat";
import type { ChatMessage } from "@/lib/ai-chat";
import type { DevAgent } from "@/lib/dev-agents-meta";

/**
 * In-memory home for the embedded AI bar's threads, keyed per page, so a chat
 * survives leaving the page and coming back (CommandBar unmounts on navigate
 * and would otherwise lose everything).
 *
 * Module scope is doing real work here, not just holding a variable:
 *  - Navigation in this app is all `next/link` soft nav, so the document — and
 *    therefore this module — outlives any route change. The thread persists.
 *  - A hard refresh reloads the bundle and this Map starts empty again, which
 *    IS the "auto-clear on hard refresh" requirement. There is no teardown code
 *    to get wrong. (sessionStorage would survive the refresh and we'd have to
 *    explicitly clear it — fighting the requirement instead of falling out of it.)
 *
 * Never touch this during render. CommandBar is a client component but still
 * server-renders, so on the server this module is evaluated once per process
 * and would be shared across requests; reading it in render would also risk a
 * hydration mismatch. All access happens in effects, which don't run on the
 * server — so the server-side copy of this Map stays empty.
 */

export interface CommandBarSnapshot {
  agent: DevAgent;
  conversationId: string | null;
  messages: ChatMessage[];
  prompt: string;
  attachments: ChatAttachment[];
  /** A turn that was still in flight when the bar went away. The run itself
   *  lives server-side in dev_agent_runs and finishes regardless, so the next
   *  mount re-polls this id and the answer lands in the thread late rather
   *  than being lost. Written directly (not mirrored from React state) so it
   *  still records when the bar is already unmounted. */
  pendingRunId: string | null;
}

/** Threads are small (text + `{name, path}` attachment refs), but a long
 *  session shouldn't grow this forever — keep the most recent pages only. */
const MAX_KEYS = 20;

const store = new Map<string, CommandBarSnapshot>();

export function getSnapshot(key: string): CommandBarSnapshot | undefined {
  return store.get(key);
}

/** Mirror of the bar's visible state. `pendingRunId` is deliberately not a
 *  parameter — it's owned by the poll lifecycle and preserved across saves. */
export function saveSnapshot(
  key: string,
  snap: Omit<CommandBarSnapshot, "pendingRunId">,
): void {
  const pendingRunId = store.get(key)?.pendingRunId ?? null;
  // Delete before set so insertion order tracks recency and the eviction below
  // drops the least recently used page, not the first one visited.
  store.delete(key);
  store.set(key, { ...snap, pendingRunId });
  if (store.size > MAX_KEYS) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
}

/** No-op when the page has no snapshot yet; by the time a run starts, the user
 *  turn has already rendered and been mirrored, so the entry exists. */
export function setPendingRun(key: string, runId: string | null): void {
  const snap = store.get(key);
  if (snap) snap.pendingRunId = runId;
}

/** Same direct-write treatment as setPendingRun, for the id of a conversation
 *  opened mid-send. The first turn on a page creates the thread inside the
 *  async send, so leaving the page during that window means setConversationId
 *  lands on an unmounted bar and the mirror never sees it — the next turn would
 *  then open a *second* conversation and fork the history. */
export function setConversationRef(key: string, conversationId: string): void {
  const snap = store.get(key);
  if (snap) snap.conversationId = conversationId;
}

export function clearSnapshot(key: string): void {
  store.delete(key);
}
