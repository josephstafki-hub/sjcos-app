"use server";

// Owner-only QuickBooks actions (A14): per-direction switches, connection
// check, an import pass, and mapping review. No tokens are handled here.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { withTransaction } from "@/lib/commands/db";
import { confirmMapping, rejectMapping, setSwitch, type SyncSwitch } from "./qbo/sync";
import { refreshQboConnection, runQboSync } from "./server";

type Result = { ok: boolean; error?: string; detail?: unknown };

const SWITCHES: SyncSwitch[] = ["import_read", "export_invoices", "export_payments"];

export async function setQboSwitch(formData: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const key = String(formData.get("key") ?? "") as SyncSwitch;
  if (!SWITCHES.includes(key)) return;
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await withTransaction((run) => setSwitch(run, key, enabled, `owner:${owner.name}`));
  revalidatePath("/settings/accounting");
}

export async function testQboConnection(): Promise<Result> {
  await requireRole("owner");
  const r = await refreshQboConnection();
  revalidatePath("/settings/accounting");
  return r.ok ? { ok: true, detail: r } : { ok: false, error: r.error };
}

export async function importQboNow(): Promise<Result> {
  await requireRole("owner");
  try {
    const r = await runQboSync();
    revalidatePath("/settings/accounting");
    return { ok: true, detail: r };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function confirmQboMapping(formData: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const mappingId = String(formData.get("mapping_id") ?? "");
  const [internalKind, internalId] = String(formData.get("candidate") ?? "").split("|");
  if (!mappingId || !internalKind || !internalId) return;
  await withTransaction((run) => confirmMapping(run, { mappingId, internalKind, internalId, by: `owner:${owner.name}` }));
  revalidatePath("/settings/accounting");
}

export async function rejectQboMapping(formData: FormData): Promise<void> {
  const owner = await requireRole("owner");
  const mappingId = String(formData.get("mapping_id") ?? "");
  if (!mappingId) return;
  await withTransaction((run) => rejectMapping(run, mappingId, `owner:${owner.name}`, String(formData.get("reason") ?? "not ours")));
  revalidatePath("/settings/accounting");
}
