"use server";

// /unsorted — Joe sorting the invoices / receipts an agent couldn't place.
// Same writes the agents' MCP tools use (lib/unsorted-docs.ts), behind the
// money area: filing logs costs on a job.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { runDirect } from "@/lib/commands/db";
import { requireAccess } from "@/lib/dal";
import { readReceipt } from "@/lib/receipt-scan";
import { fileDocument, sendToAgent, undoDocument, type FileTarget } from "@/lib/unsorted-docs";

export interface FileUnsortedInput {
  target: FileTarget;
  logCost?: boolean;
  kind?: string;
  amountCents?: number | null;
  vendorLabel?: string;
  note?: string;
}

export async function fileUnsortedAction(id: number, input: FileUnsortedInput) {
  const user = await requireAccess("money");
  const by = user.role === "owner" ? "owner" : user.name || user.email;
  const r = await fileDocument(id, input.target, { ...input, by });
  revalidatePath("/unsorted");
  return r;
}

export async function noteUnsortedAction(id: number, note: string) {
  await requireAccess("money");
  const r = await sendToAgent(id, note);
  revalidatePath("/unsorted");
  return r;
}

export async function undoUnsortedAction(id: number) {
  await requireAccess("money");
  const r = await undoDocument(id);
  revalidatePath("/unsorted");
  return r;
}

/** Have Claude read a scanned / texted receipt again (a failed or stuck read). */
export async function rereadUnsortedAction(id: number) {
  await requireAccess("money");
  const rows = await runDirect(
    `UPDATE unsorted_docs SET extract_state = 'reading', extract_started_at = now(), extract_error = '', why_unsure = 'Claude is reading it…'
      WHERE id = $1 AND status IN ('pending','needs_agent') AND cardinality(attachment_file_ids) > 0 RETURNING id`, [id]);
  if (!rows.length) return { ok: false as const, error: "There's no photo to read on that one." };
  after(() => readReceipt(id));
  revalidatePath("/unsorted");
  return { ok: true as const };
}
