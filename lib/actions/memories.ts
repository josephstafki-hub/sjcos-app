"use server";

// W5 agent-memories review actions. Owner-gated — these clicks are the ONLY
// path by which an agent-written memory gains any authority. Capture stays in
// lib/agent-memory.ts (safe defaults); reads in lib/memories.ts.

import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";

type Result = { ok: true } | { ok: false; error: string };

/** Approve as evidence only — agents may cite it, it never instructs. */
export async function approveMemoryEvidence(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE agent_memories SET review_status = 'approved', updated_at = now() WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}

/** Approve as a standing instruction — Joe's click IS the user confirmation
 *  the table's safe defaults wait for. */
export async function approveMemoryInstruction(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE agent_memories
        SET review_status = 'approved', can_use_as_instruction = true,
            requires_user_confirmation = false, confidence = 0.8,
            provenance_status = 'user_confirmed', updated_at = now()
      WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}

export async function rejectMemory(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE agent_memories SET review_status = 'rejected', updated_at = now() WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}

/** Revoke a standing instruction — it stays approved evidence, but stops
 *  instructing agents immediately. */
export async function revokeMemoryInstruction(id: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE agent_memories SET can_use_as_instruction = false, updated_at = now() WHERE id = $1`,
    [id],
  );
  revalidatePath("/engine");
  return { ok: true };
}

/** Set (or clear, with "") the date a standing instruction goes stale. */
export async function setMemoryStaleAfter(id: string, date: string): Promise<Result> {
  await requireRole("owner");
  await query(
    `UPDATE agent_memories SET stale_after = NULLIF($2, '')::timestamptz, updated_at = now() WHERE id = $1`,
    [id, date.trim()],
  );
  revalidatePath("/engine");
  return { ok: true };
}
