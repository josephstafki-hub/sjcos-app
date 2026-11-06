// Canvas Phase 1 seam (coordinator stub, 2026-11-05). The provenance builder
// replaces this implementation. The canvas commands builder codes against
// this exact signature. See docs/plans/ask-canvas-plan.md §5.1, §5.2, §9 and §9.1.
//
// FAIL-CLOSED STUB: until real tracking lands, every conversation reports
// incomplete provenance. Per §9 that means the full content catalog (`areas:
// null`), so owner Save pre-ticks everything and staff content writes are
// refused. Never replace this with a permissive default.

/**
 * @typedef {Object} ConversationProvenance
 * @property {boolean} complete   true only when every input of the generation context is tracked (§9.1)
 * @property {string[]|null} areas sorted PermissionKey list derived from tracked inputs; null = unknown ⇒ full catalog (§9)
 * @property {number} revision     monotonic manifest revision. Canvas versions persist it; a Save fails as stale-policy if it changed (§8.4)
 * @property {Array<{ref:string, hash:string, areas:string[]}>} inputs  classified input refs + hashes (no private text)
 */

/**
 * Current provenance for one conversation, read inside the caller's transaction.
 * @param {{ client: { query: Function }, threadId: string, runId?: string|null }} args
 * @returns {Promise<ConversationProvenance>}
 */
export async function conversationProvenance({ client, threadId }) {
  void client; void threadId;
  return { complete: false, areas: null, revision: 0, inputs: [] };
}
