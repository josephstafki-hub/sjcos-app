import "server-only";

import { captureAgentMemory } from "@/lib/agent-memory";
import { query, queryOne } from "@/lib/db";
import { reviewProposals } from "./claude-review";
import { executeProposal } from "./execute";
import { recordRunEffects } from "./effects";

// Qwen's pending-write pipeline. Qwen has no tools; when a message asks it to
// change OS data it ends its reply with a ```sjcos-proposal fence. Each entry
// is parsed with the lib/today-actions.ts paranoia (whitelist of kinds, strict
// payload validation, caps, never throws, never repairs), held in
// agent_pending_actions, batch-reviewed by Claude, and only then executed via
// the app's own whitelisted executors. Guardrail intact: model text only ever
// SELECTS among pre-authorized operations — it can't widen them. On any
// review failure everything stays held; nothing auto-approves.

export type ProposalKind =
  | "mark_done"
  | "snooze"
  | "update_status"
  | "create_work_item"
  | "capture_knowledge";

export interface PendingProposal {
  kind: ProposalKind;
  payload: Record<string, unknown>;
  entityKind: string;
  entityId: string | null;
}

// The fence line may carry stray words after the tag ("```sjcos-proposal
// block" — Qwen copied that from an early hint) — anything up to the newline
// is tolerated; the JSON must start on the next line.
const EXPLICIT_FENCE_RE = /```sjcos-proposal[^\n]*\n([\s\S]*?)```/i;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_PROPOSALS = 10;
const WORK_ITEM_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting_on_human",
  "waiting_on_client",
  "waiting_on_sub",
  "blocked",
  "done",
  "cancelled",
]);
const KNOWLEDGE_KINDS = new Set(["note", "decision", "insight", "preference"]);

function coerce(text: string): PendingProposal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: PendingProposal[] = [];
  for (const item of parsed.slice(0, MAX_PROPOSALS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    switch (o.kind) {
      case "mark_done":
      case "snooze":
      case "update_status": {
        const id = typeof o.work_item_id === "string" ? o.work_item_id : "";
        if (!UUID_RE.test(id)) continue;
        if (o.kind === "update_status" && !WORK_ITEM_STATUSES.has(o.status as string)) continue;
        const payload: Record<string, unknown> = { work_item_id: id };
        if (o.kind === "snooze" && typeof o.days === "number") payload.days = o.days;
        if (o.kind === "update_status") payload.status = o.status;
        out.push({ kind: o.kind, payload, entityKind: "work_item", entityId: id });
        break;
      }
      case "create_work_item": {
        const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
        if (!title) continue;
        const body = typeof o.body === "string" ? o.body.slice(0, 2000) : undefined;
        out.push({ kind: "create_work_item", payload: { title, ...(body ? { body } : {}) }, entityKind: "work_item", entityId: null });
        break;
      }
      case "capture_knowledge": {
        const content = typeof o.content === "string" ? o.content.trim().slice(0, 4000) : "";
        if (!content) continue;
        const kind = KNOWLEDGE_KINDS.has(o.knowledge_kind as string) ? (o.knowledge_kind as string) : "note";
        out.push({ kind: "capture_knowledge", payload: { content, kind }, entityKind: "knowledge_item", entityId: null });
        break;
      }
      default:
        continue;
    }
  }
  return out;
}

/** Split a Qwen reply into display text (fence removed) and valid proposals. */
export function parseModelProposals(body: string): { body: string; proposals: PendingProposal[] } {
  const m = EXPLICIT_FENCE_RE.exec(body);
  if (!m) return { body, proposals: [] };
  return { body: body.replace(m[0], "").trimEnd(), proposals: coerce(m[1]) };
}

/** Escalation seam: filled by the orchestration ladder (phase 5) — a rejected
 *  proposal's task re-routes to Hermes with Claude's critique attached. Until
 *  then rejection is terminal and the transcript says so. */
export type EscalateHook = (args: {
  runId: string;
  conversationId: string;
  userMessage: string;
  critique: string;
}) => Promise<string | null>;

let escalateHook: EscalateHook | null = null;
export function setEscalateHook(fn: EscalateHook): void {
  escalateHook = fn;
}

/**
 * The full pipeline for one completed Qwen turn: parse → hold → Claude batch
 * review → execute approved → outcome lines appended to the reply. Never
 * throws; a review failure holds everything and says so.
 */
export async function processQwenProposals(
  runId: string,
  conversationId: string,
  userMessage: string,
  rawAnswer: string,
  pageContext?: string,
): Promise<string> {
  const { body, proposals: parsed } = parseModelProposals(rawAnswer);

  // Guardrail: a proposal may only name a work item that was actually in
  // view — the queue digest / page context sent with this turn, or an id
  // Joe himself typed. Qwen once invented a well-formed uuid for an item it
  // couldn't see; a whitelist makes that a no-op instead of a gamble.
  const known = new Set<string>();
  for (const src of [pageContext ?? "", userMessage]) {
    for (const m of src.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi)) {
      known.add(m[0].toLowerCase());
    }
  }
  const proposals: PendingProposal[] = [];
  let unknownRefs = 0;
  for (const p of parsed) {
    const wid = p.payload.work_item_id as string | undefined;
    if (wid && !known.has(wid.toLowerCase())) {
      unknownRefs++;
      continue;
    }
    proposals.push(p);
  }

  if (!proposals.length) {
    // Nothing executable — but did Qwen CLAIM it was doing something? Then
    // Joe expects an outcome, and silence (or a fabricated id) is the worst
    // result. Hand the task to Hermes, which has real tools, via the ladder.
    const claimed =
      unknownRefs > 0 ||
      /\b(i'?ll|i will|let'?s|i'?ve|i have|going to|marking|marked|updating|updated|snoozing|snoozed|creating|created|closing|closed)\b[^.\n]{0,80}\b(done|complete|completed|status|snooze|work item|item|todo|task|note|knowledge)\b/i.test(
        body,
      );
    if (claimed && escalateHook) {
      const why = unknownRefs
        ? "Qwen referenced a work item that isn't in view (likely an invented id)."
        : "Qwen described a change but produced no executable proposal.";
      const escalated = await escalateHook({ runId, conversationId, userMessage, critique: why }).catch(() => null);
      if (escalated) return `${body}\n\n🔁 Nothing was changed yet — ${why} Handing to Hermes to do it properly…`;
      return `${body}\n\n⚠️ Nothing was changed — ${why}`;
    }
    return body;
  }

  try {
    const ids: string[] = [];
    for (const p of proposals) {
      const row = await queryOne<{ id: string }>(
        `INSERT INTO agent_pending_actions (run_id, conversation_id, kind, payload, entity_kind, entity_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'reviewing') RETURNING id`,
        [runId, conversationId, p.kind, JSON.stringify(p.payload), p.entityKind, p.entityId],
      );
      ids.push(row!.id);
    }
    await query(
      `UPDATE dev_agent_runs SET activity = $2, updated_at = now() WHERE id = $1`,
      [runId, `Claude is reviewing ${proposals.length} proposed change${proposals.length > 1 ? "s" : ""}…`],
    );

    const verdicts = await reviewProposals(userMessage, body, proposals, pageContext);
    if (!verdicts) {
      await query(
        `UPDATE agent_pending_actions SET status = 'proposed', review_note = 'review unavailable', updated_at = now()
          WHERE id = ANY($1)`,
        [ids],
      );
      return `${body}\n\n⚠️ Claude review unavailable — nothing was changed. The proposals are held for later.`;
    }

    const lines: string[] = [];
    if (unknownRefs) lines.push(`🚫 Dropped ${unknownRefs} proposal${unknownRefs > 1 ? "s" : ""} naming an item that isn't in view.`);
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      const v = verdicts.find((x) => x.index === i);
      // Missing verdict = not approved. Never default to approval.
      if (!v?.approve) {
        const note = v?.note || "Claude did not approve this change.";
        let escalated: string | null = null;
        if (escalateHook) {
          escalated = await escalateHook({ runId, conversationId, userMessage, critique: note }).catch(() => null);
        }
        await query(
          `UPDATE agent_pending_actions SET status = $2, review_note = $3, updated_at = now() WHERE id = $1`,
          [ids[i], escalated ? "escalated" : "rejected", note],
        );
        if (!escalated) {
          // W5 learning layer: a rejected proposal is a signal about what NOT to propose.
          await captureAgentMemory({
            summary: `Rejected: Qwen proposal ${p.kind}${p.entityId ? ` on ${p.entityKind} ${p.entityId}` : ""}`,
            content: [
              `Qwen proposed ${p.kind} (${p.entityKind}${p.entityId ? ` ${p.entityId}` : ""}): ${JSON.stringify(p.payload).slice(0, 600)}`,
              `Rejected in Claude review: ${note}`,
            ].join("\n"),
            memoryType: "observation",
            runtimeName: "qwen-app",
            refs: [
              { kind: "pending_action", id: ids[i], label: `Qwen proposal ${p.kind}` },
              ...(p.entityId ? [{ kind: p.entityKind, id: p.entityId, label: `${p.entityKind} ${p.entityId}` }] : []),
            ],
          });
        }
        lines.push(
          escalated
            ? `🔁 Held by Claude (${note}) — handed to Hermes to do properly.`
            : `🚫 Held by Claude: ${note}`,
        );
        continue;
      }
      const result = await executeProposal(p);
      await query(
        `UPDATE agent_pending_actions SET status = $2, review_note = $3, updated_at = now() WHERE id = $1`,
        [ids[i], result.ok ? "executed" : "failed", v.note || null],
      );
      if (result.ok && result.entityKind) {
        await recordRunEffects(
          runId,
          [{ entityKind: result.entityKind, entityId: result.entityId, action: p.kind === "create_work_item" ? "created" : "updated" }],
          "app",
        ).catch(() => {});
      }
      lines.push(result.ok ? `✅ ${result.summary} · approved by Claude` : `⚠️ ${result.summary}`);
    }
    return `${body}\n\n${lines.join("\n")}`;
  } catch (err) {
    return `${body}\n\n⚠️ Review pipeline failed (${(err as Error).message}) — nothing was changed.`;
  }
}
