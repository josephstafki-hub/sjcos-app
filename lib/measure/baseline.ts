// Baseline owner touches (A18) — computed from data that ALREADY exists so
// measurement starts today rather than after every workstream wires
// recordOwnerTouch(). Pure `run` style.
//
// Sources and what each one honestly is:
//   owner_grants      Joe approved/denied an agent send (decided_at) — a touch each;
//                     every audit entry is a spent grant (an agent acted under it).
//   decisions         one-tap decisions Joe resolved (decided_at, decided_via).
//   work_items        approval_status approved/rejected — the table has no decided
//                     timestamp, so updated_at is the proxy (may be later than the tap).
//   notifications     kind = 'decision' rows Joe marked read — an attention touch, not
//                     an approval; counted separately so it is not double-counted.
//   owner_touches     touches already recorded through recordOwnerTouch().
//   agent_runs / dev_agent_runs / agent_usage   agent activity in the same window
//                     (denominator context and cost), not owner time.
//
// Seconds are UNKNOWN for every derived source (nothing timed them). The
// baseline reports touch COUNTS with seconds_known = 0; it never invents a
// per-touch duration. DECISIONS.md: manual correction stays available.

import type { Run } from "../commands/core.ts";

export interface BaselineSource {
  source: string;
  what: string;
  touches: number;
  seconds_known: number;
  /** Extra breakdown where the source has one. */
  detail?: Record<string, number>;
}

export interface Baseline {
  window: { from: string; to: string };
  computed_at: string;
  sources: BaselineSource[];
  /** Approvals + decisions + work-item approvals + recorded touches; attention-only reads excluded. */
  owner_touches_estimated: number;
  owner_seconds_known: number;
  agent_activity: { agent_runs: number; agent_runs_failed: number; dev_agent_runs: number; agent_usage_runs: number | null; known_cost_usd: number };
  caveats: string[];
}

async function tableExists(run: Run, name: string): Promise<boolean> {
  const [r] = await run<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return Boolean(r?.ok);
}

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export async function baselineOwnerTouches(run: Run, window: { from: string; to: string }): Promise<Baseline> {
  const p = [window.from, window.to];
  const sources: BaselineSource[] = [];

  const [grants] = await run<{ decided: string; approved: string; denied: string; spent: string }>(
    `SELECT count(*) FILTER (WHERE decided_at IS NOT NULL)::text AS decided,
            count(*) FILTER (WHERE status = 'approved' AND decided_at IS NOT NULL)::text AS approved,
            count(*) FILTER (WHERE status = 'denied')::text AS denied,
            COALESCE(sum(jsonb_array_length(audit)), 0)::text AS spent
       FROM owner_grants WHERE decided_at >= $1 AND decided_at < $2`,
    p,
  );
  sources.push({
    source: "owner_grants",
    what: "Agent send requests Joe approved or denied (one touch per decision).",
    touches: n(grants?.decided),
    seconds_known: 0,
    detail: { approved: n(grants?.approved), denied: n(grants?.denied), spent_uses: n(grants?.spent) },
  });

  const decisionRows = await run<{ via: string | null; c: string }>(
    `SELECT COALESCE(decided_via, 'unknown') AS via, count(*)::text AS c FROM decisions
      WHERE decided_at >= $1 AND decided_at < $2 GROUP BY 1`,
    p,
  );
  sources.push({
    source: "decisions",
    what: "One-tap decisions Joe resolved (app / telegram / push / mcp).",
    touches: decisionRows.reduce((a, r) => a + n(r.c), 0),
    seconds_known: 0,
    detail: Object.fromEntries(decisionRows.map((r) => [r.via ?? "unknown", n(r.c)])),
  });

  const [wi] = await run<{ approved: string; rejected: string }>(
    `SELECT count(*) FILTER (WHERE approval_status = 'approved')::text AS approved,
            count(*) FILTER (WHERE approval_status = 'rejected')::text AS rejected
       FROM work_items WHERE approval_status IN ('approved','rejected') AND updated_at >= $1 AND updated_at < $2`,
    p,
  );
  sources.push({
    source: "work_items",
    what: "Work items Joe approved or rejected (updated_at proxy — the table has no decided timestamp).",
    touches: n(wi?.approved) + n(wi?.rejected),
    seconds_known: 0,
    detail: { approved: n(wi?.approved), rejected: n(wi?.rejected) },
  });

  const [notif] = await run<{ read: string; total: string }>(
    `SELECT count(*) FILTER (WHERE read)::text AS read, count(*)::text AS total
       FROM notifications WHERE kind = 'decision' AND created_at >= $1 AND created_at < $2`,
    p,
  );
  sources.push({
    source: "notifications",
    what: "Decision notifications Joe read — attention, not an approval; NOT added to the touch estimate.",
    touches: n(notif?.read),
    seconds_known: 0,
    detail: { read: n(notif?.read), raised: n(notif?.total) },
  });

  const [touches] = await run<{ c: string; secs: string | null; known: string }>(
    `SELECT count(*)::text AS c, sum(seconds)::text AS secs, count(*) FILTER (WHERE seconds IS NOT NULL)::text AS known
       FROM owner_touches WHERE created_at >= $1 AND created_at < $2`,
    p,
  );
  sources.push({
    source: "owner_touches",
    what: "Touches recorded through recordOwnerTouch() (the only source with measured seconds).",
    touches: n(touches?.c),
    seconds_known: n(touches?.secs),
    detail: { with_seconds: n(touches?.known) },
  });

  const [runs] = await run<{ c: string; failed: string; usd: string | null }>(
    `SELECT count(*)::text AS c, count(*) FILTER (WHERE status = 'failed')::text AS failed, sum(cost_usd)::text AS usd
       FROM agent_runs WHERE started_at >= $1 AND started_at < $2`,
    p,
  );
  const [dev] = await run<{ c: string; usd: string | null }>(
    `SELECT count(*)::text AS c, sum(cost_usd)::text AS usd FROM dev_agent_runs WHERE created_at >= $1 AND created_at < $2`,
    p,
  );
  let usage: { c: string; usd: string | null } | null = null;
  if (await tableExists(run, "agent_usage")) {
    [usage] = await run<{ c: string; usd: string | null }>(`SELECT count(*)::text AS c, sum(cost_usd)::text AS usd FROM agent_usage WHERE created_at >= $1 AND created_at < $2`, p);
  }

  const estimated = sources.filter((s) => s.source !== "notifications").reduce((a, s) => a + s.touches, 0);
  return {
    window,
    computed_at: new Date().toISOString(),
    sources,
    owner_touches_estimated: estimated,
    owner_seconds_known: n(touches?.secs),
    agent_activity: {
      agent_runs: n(runs?.c),
      agent_runs_failed: n(runs?.failed),
      dev_agent_runs: n(dev?.c),
      agent_usage_runs: usage ? n(usage.c) : null,
      known_cost_usd: Math.round((n(runs?.usd) + n(dev?.usd) + n(usage?.usd)) * 1e6) / 1e6,
    },
    caveats: [
      "Derived sources were never timed: seconds are unknown, not zero. Only owner_touches rows carry measured time.",
      "A grant, a decision and a work-item approval for the same send may all exist; the estimate is an upper bound on distinct touches until recordOwnerTouch() is the single writer.",
      "Notification reads are attention, not approvals, and are excluded from the estimate.",
      "This is a touch-count baseline over the stated window — not an automation percentage.",
    ],
  };
}
