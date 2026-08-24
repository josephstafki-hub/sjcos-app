import "server-only";

// W5 agent-memories read layer: what the capture hooks (lib/agent-memory.ts)
// have parked for Joe's review, plus the approved standing instructions.
// Writes live in lib/actions/memories.ts; agent capture in lib/agent-memory.ts.

import { query } from "./db";
import type { MemoryReviewStatus } from "./types";

export interface MemoryRefView {
  kind: string;
  id: string | null;
  uri: string | null;
  label: string;
}

export interface MemoryView {
  id: string;
  summary: string;
  content: string;
  memoryType: string;
  reviewStatus: MemoryReviewStatus;
  canUseAsInstruction: boolean;
  confidence: number | null;
  staleAfter: string | null;
  runtimeName: string | null;
  createdAt: string;
  refs: MemoryRefView[];
}

export interface MemoriesData {
  pending: MemoryView[];
  /** Approved + can_use_as_instruction — Joe's standing orders to all agents. */
  instructions: MemoryView[];
}

interface MemoryRow {
  id: string;
  summary: string;
  content: string;
  memory_type: string;
  review_status: MemoryReviewStatus;
  can_use_as_instruction: boolean;
  confidence: string | null;
  stale_after: string | null;
  runtime_name: string | null;
  created_at: string;
  refs: MemoryRefView[] | null;
}

const MEMORY_SELECT = `
  m.id, m.summary, m.content, m.memory_type, m.review_status,
  m.can_use_as_instruction, m.confidence, m.stale_after, m.runtime_name, m.created_at,
  (SELECT json_agg(json_build_object('kind', r.ref_kind, 'id', r.ref_id, 'uri', r.uri, 'label', r.label)
                   ORDER BY r.created_at)
     FROM agent_memory_source_refs r WHERE r.memory_id = m.id) AS refs`;

function rowToView(r: MemoryRow): MemoryView {
  return {
    id: r.id,
    summary: r.summary,
    content: r.content,
    memoryType: r.memory_type,
    reviewStatus: r.review_status,
    canUseAsInstruction: r.can_use_as_instruction,
    confidence: r.confidence === null ? null : Number(r.confidence),
    staleAfter: r.stale_after ? String(r.stale_after) : null,
    runtimeName: r.runtime_name,
    createdAt: String(r.created_at),
    refs: r.refs ?? [],
  };
}

export async function getMemoriesData(): Promise<MemoriesData> {
  const [pending, instructions] = await Promise.all([
    query<MemoryRow>(
      `SELECT ${MEMORY_SELECT} FROM agent_memories m
        WHERE m.review_status = 'pending'
        ORDER BY m.created_at DESC LIMIT 100`,
    ),
    query<MemoryRow>(
      `SELECT ${MEMORY_SELECT} FROM agent_memories m
        WHERE m.review_status = 'approved' AND m.can_use_as_instruction = true
        ORDER BY m.confidence DESC NULLS LAST, m.updated_at DESC`,
    ),
  ]);
  return {
    pending: pending.rows.map(rowToView),
    instructions: instructions.rows.map(rowToView),
  };
}
