// Agent usage metering + thresholds (A08b). Pure over run(sql, params).
//
// Thresholds are app_settings rows (blank = unset):
//   agent.max_cost_per_run_usd  → business runs get `--max-budget-usd`; owner runs are warned in the activity log
//   agent.max_runs_per_hour     → business runs are refused past the cap; owner runs are warned
// The runner writes one agent_usage row per finished run from the CLI's
// result envelope; the Hermes/Qwen paths can call recordUsage too.

import type { Run } from "../commands/core.ts";
import { SETTING_MAX_COST_PER_RUN, SETTING_MAX_RUNS_PER_HOUR, parseThreshold, runAdmission } from "./run-profile.mjs";

export interface UsageThresholds {
  maxCostPerRunUsd: number | null;
  maxRunsPerHour: number | null;
}

export async function readUsageThresholds(run: Run): Promise<UsageThresholds> {
  const rows = await run<{ key: string; value: string }>(`SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`, [
    [SETTING_MAX_COST_PER_RUN, SETTING_MAX_RUNS_PER_HOUR],
  ]);
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return { maxCostPerRunUsd: parseThreshold(get(SETTING_MAX_COST_PER_RUN)), maxRunsPerHour: parseThreshold(get(SETTING_MAX_RUNS_PER_HOUR)) };
}

export type Admission = { ok: true; warning: string | null; thresholds: UsageThresholds } | { ok: false; error: string; thresholds: UsageThresholds };

/** May a new run start right now? Counts every dev_agent_runs row created in
 *  the trailing hour (all agents, all profiles) against the cap. */
export async function admitRun(run: Run, profile: "operator" | "business"): Promise<Admission> {
  const thresholds = await readUsageThresholds(run);
  const [c] = await run<{ n: string }>(`SELECT count(*)::text AS n FROM dev_agent_runs WHERE created_at > now() - interval '1 hour'`);
  const verdict = runAdmission({ profile, runsLastHour: Number(c?.n ?? 0), maxRunsPerHour: thresholds.maxRunsPerHour }) as { ok: boolean; warning: string | null; error?: string };
  if (!verdict.ok) return { ok: false, error: verdict.error ?? "Run refused by usage threshold.", thresholds };
  return { ok: true, warning: verdict.warning, thresholds };
}

export interface UsageRecord {
  runId: string | null;
  runtime: string;
  model?: string | null;
  profile: "operator" | "business";
  principalUserId?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  durationMs?: number | null;
  numTurns?: number | null;
  outcome?: string;
}

export async function recordUsage(run: Run, u: UsageRecord): Promise<void> {
  await run(
    `INSERT INTO agent_usage (run_id, runtime, model, profile, principal_user_id, tokens_in, tokens_out, cost_usd, duration_ms, num_turns, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [u.runId, u.runtime, u.model ?? null, u.profile, u.principalUserId ?? null, u.tokensIn ?? null, u.tokensOut ?? null, u.costUsd ?? null, u.durationMs ?? null, u.numTurns ?? null, u.outcome ?? "done"],
  );
}
