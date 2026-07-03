"use server";

// Open Brain write paths. Owner-gated. Reads + search stay in lib/brain.ts.

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/dal";
import { searchKnowledge, type KnowledgeItemView } from "@/lib/brain";

type Result = { ok: true } | { ok: false; error: string };

/** Capture a durable knowledge item by hand (owner). De-duped by fingerprint. */
export async function captureKnowledge(formData: FormData): Promise<Result> {
  await requireRole("owner");
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { ok: false, error: "Content is required." };
  const kind = String(formData.get("kind") ?? "note").trim() || "note";
  const fp = createHash("md5").update(content).digest("hex");
  await query(
    `INSERT INTO knowledge_items (content, kind, source, content_fingerprint, created_by)
     VALUES ($1,$2,'manual',$3,'user')
     ON CONFLICT (content_fingerprint) WHERE content_fingerprint IS NOT NULL DO NOTHING`,
    [content, kind, fp],
  );
  revalidatePath("/engine");
  return { ok: true };
}

export async function deleteKnowledge(id: string): Promise<Result> {
  await requireRole("owner");
  await query(`DELETE FROM knowledge_items WHERE id = $1`, [id]);
  revalidatePath("/engine");
  return { ok: true };
}

/** Search action for the client knowledge panel — returns view rows. */
export async function searchKnowledgeAction(q: string): Promise<KnowledgeItemView[]> {
  await requireRole("owner");
  return searchKnowledge(q, 40);
}
