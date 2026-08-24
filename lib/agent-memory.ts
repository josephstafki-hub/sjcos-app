// W5 learning layer — the single writer for agent_memories.
//
// Every capture lands with the table's safe defaults: provenance_status
// 'inferred', review_status 'pending', can_use_as_instruction false,
// requires_user_confirmation true. Nothing here may promote a memory —
// promotion is Joe's click in /engine only.

import { query, queryOne } from "@/lib/db";

export type AgentMemoryRef = {
  kind: string; // knowledge/thread/file/lead/project/uri/receipt/grant/draft/issue/work_item/…
  id?: string;
  uri?: string;
  label: string;
};

export type CaptureAgentMemoryInput = {
  /** One line, plain. Also the near-duplicate key among pending rows. */
  summary: string;
  /** The facts: what the agent did, what Joe did instead. */
  content: string;
  memoryType: "observation" | "preference" | "instruction" | "fact";
  runtimeName?: string;
  leadId?: string;
  projectId?: string;
  refs?: AgentMemoryRef[];
};

/**
 * Capture one agent memory (pending, evidence-only). Returns the memory id,
 * or null on failure — never throws into its caller: a broken learning layer
 * must not break the operational path it observes.
 *
 * Near-duplicate guard: a pending memory with the same summary absorbs this
 * event's refs instead of spawning a sibling row.
 *
 * Confidence is deliberately left null at capture — it is earned at review
 * (Joe's approve-as-instruction sets it), not claimed at write time.
 */
export async function captureAgentMemory(
  input: CaptureAgentMemoryInput,
): Promise<string | null> {
  try {
    const summary = input.summary.trim();
    const content = input.content.trim();
    if (!summary || !content) return null;

    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM agent_memories
        WHERE review_status = 'pending' AND summary = $1
        ORDER BY created_at DESC LIMIT 1`,
      [summary],
    );

    let memoryId: string;
    if (existing) {
      memoryId = existing.id;
      await query(`UPDATE agent_memories SET updated_at = now() WHERE id = $1`, [memoryId]);
    } else {
      const inserted = await queryOne<{ id: string }>(
        `INSERT INTO agent_memories (summary, content, memory_type, runtime_name, lead_id, project_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          summary,
          content,
          input.memoryType,
          input.runtimeName ?? null,
          input.leadId ?? null,
          input.projectId ?? null,
        ],
      );
      if (!inserted) return null;
      memoryId = inserted.id;
    }

    for (const ref of input.refs ?? []) {
      // On the dedupe path, skip refs the memory already carries.
      await query(
        `INSERT INTO agent_memory_source_refs (memory_id, ref_kind, ref_id, uri, label)
         SELECT $1, $2, $3, $4, $5
          WHERE NOT EXISTS (
            SELECT 1 FROM agent_memory_source_refs
             WHERE memory_id = $1 AND ref_kind = $2
               AND ref_id IS NOT DISTINCT FROM $3
               AND uri IS NOT DISTINCT FROM $4
          )`,
        [memoryId, ref.kind, ref.id ?? null, ref.uri ?? null, ref.label],
      );
    }

    return memoryId;
  } catch (err) {
    console.error("[agent-memory] capture failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Joe-approved standing instructions as one prompt block for the in-app chat
 * agents (Hermes/Qwen) — same query the get_standing_instructions MCP tool
 * serves, capped at 10 entries / 2000 chars. Empty string when there are none
 * (or on failure — a broken learning layer must not break chat).
 */
export async function standingInstructionsBlock(): Promise<string> {
  try {
    const { rows } = await query<{ summary: string; content: string }>(
      `SELECT summary, content FROM agent_memories
        WHERE review_status = 'approved' AND can_use_as_instruction = true
          AND (stale_after IS NULL OR stale_after > now())
        ORDER BY confidence DESC NULLS LAST, updated_at DESC
        LIMIT 10`,
    );
    if (!rows.length) return "";
    const header = "STANDING INSTRUCTIONS (Joe-approved) — honor every entry:";
    const lines: string[] = [header];
    let length = header.length;
    for (const r of rows) {
      const line = `- ${r.summary ? `${r.summary}: ` : ""}${r.content.replace(/\s+/g, " ").trim()}`;
      if (length + line.length + 1 > 2000) break;
      lines.push(line);
      length += line.length + 1;
    }
    return lines.length > 1 ? lines.join("\n") : "";
  } catch (err) {
    console.error("[agent-memory] standing instructions failed:", err instanceof Error ? err.message : err);
    return "";
  }
}
