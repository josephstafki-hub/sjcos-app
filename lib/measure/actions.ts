"use server";

// Owner-only measurement actions (A18). Nothing here promotes a memory, a
// skill or a policy: the procedure checks only RECORD findings.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { withMeasureTx, knownToolsFromSettings } from "@/lib/measure/server";
import { snapshotProcedures, checkProcedures } from "@/lib/measure/procedures";
import { setCapabilityState, type CapabilityState } from "@/lib/measure/capabilities";

type Result = { ok: true; info?: string } | { ok: false; error: string };

export async function runProcedureChecks(): Promise<Result> {
  await requireRole("owner");
  try {
    const tools = await knownToolsFromSettings();
    const out = await withMeasureTx(async (run) => {
      const snap = await snapshotProcedures(run, { knownTools: tools });
      const checks = await checkProcedures(run, { knownTools: tools });
      return { snap, checks };
    });
    revalidatePath("/engine/measure");
    return {
      ok: true,
      info: `Snapshot ${out.snap.recorded} new version(s); ${out.checks.opened} new finding(s), ${out.checks.resolved} resolved, ${out.checks.open.length} open.${tools.length ? "" : " No MCP tool list recorded yet — missing-tool checks skipped (run the procedure_checks MCP tool once, or node scripts/list-mcp-tools.mjs)."}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCapability(key: string, states: Partial<Record<CapabilityState, boolean>>, evidence: { version: string; note: string; date?: string } | null): Promise<Result> {
  const user = await requireRole("owner");
  try {
    await withMeasureTx((run) => setCapabilityState(run, key, { ...states, evidence: evidence ? { ...evidence, by: user.name } : null }));
    revalidatePath("/engine/capabilities");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
