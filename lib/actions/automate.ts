"use server";

// Server actions for the headless-CLI automation builder.
//
// Two actions form the confirm gate:
//   proposeAction()  → owner types intent, gets a structured plan back to review
//   executeAction()  → fires ONLY when the owner clicks "Approve" on that plan
//
// The plan travels client→server between the two calls, so executeApprovedPlan()
// re-validates it server-side — a tampered plan can never widen tool scope or
// escape the automations dir.

import { getCurrentUser } from "@/lib/dal";
import {
  proposeAutomation,
  executeApprovedPlan,
  installPlanCrons,
  type AutomationPlan,
} from "@/lib/automate";

async function requireOwner() {
  const user = await getCurrentUser();
  if (!user || user.role !== "owner") {
    throw new Error("not authorized");
  }
}

export interface ProposeState {
  plan?: AutomationPlan;
  error?: string;
}

/** Phase 1: read-only. Returns a plan for the owner to review. Nothing changes. */
export async function proposeAction(
  _prev: ProposeState,
  formData: FormData,
): Promise<ProposeState> {
  await requireOwner();
  const instruction = String(formData.get("instruction") ?? "").trim();
  if (!instruction) return { error: "Describe the automation you want." };

  try {
    const plan = await proposeAutomation(instruction);
    return { plan };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface ExecuteState {
  ok?: boolean;
  output?: string;
  costUsd?: number;
  /** Cron lines staged (not installed). Non-empty ⇒ show the Install step. */
  stagedCron?: string[];
  error?: string;
}

/** Phase 2: gated execution. Only call after the owner approves the plan. */
export async function executeAction(
  instruction: string,
  plan: AutomationPlan,
): Promise<ExecuteState> {
  await requireOwner();
  try {
    const result = await executeApprovedPlan(instruction, plan);
    return {
      ok: result.ok,
      output: result.output,
      costUsd: result.costUsd,
      stagedCron: result.stagedCron,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface InstallState {
  installed?: string[];
  skipped?: string[];
  error?: string;
}

/** Phase 3: install staged cron lines. Only call after a second confirm. */
export async function installCronAction(plan: AutomationPlan): Promise<InstallState> {
  await requireOwner();
  try {
    const result = await installPlanCrons(plan);
    return { installed: result.installed, skipped: result.skipped };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
