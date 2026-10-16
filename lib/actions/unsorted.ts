"use server";

// /unsorted — Joe sorting the invoices / receipts an agent couldn't place.
// Same writes the agents' MCP tools use (lib/unsorted-docs.ts), behind the
// money area: filing logs costs on a job.

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/dal";
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
