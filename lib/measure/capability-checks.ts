// Automatic evidence for the capability ledger (A18). The ledger was filled by
// hand and went stale: on 2026-10-31 it still showed 0 of 37 deployed / enabled
// / proven while the build had been live since 2026-10-02 with 12 policies on
// and real cases in the database. These checks derive each claim from the live
// system instead, so scripts/refresh-capabilities.mjs can re-state them after
// every deploy:
//
//   deployed  the live checkout contains the automation build's merge commit
//             and a production build is present (probe.deployedVersion)
//   enabled   the capability's switch is on: an active policy, a running
//             systemd timer, a configured login / key. "always" = no switch,
//             it is on whenever it is deployed.
//   proven    real production cases exist (fixture rows `zz-%` excluded), with
//             counts and sample ids in the evidence note. Each check names the
//             OUTCOME the capability exists for — a capability whose outcome has
//             no cases yet stays unproven even if lots of related rows exist.
//
// A check that can't run (table missing, permission) makes no claim. Nothing
// here turns a state OFF except `enabled` when its switch is verifiably off.
// Pure over run(sql, params) + an injected probe; no server-only import.

import type { Run } from "../commands/core.ts";

export interface CapabilityProbe {
  /** Build/commit string when the automation build is live, else null. */
  deployedVersion: () => Promise<string | null>;
  /** systemd --user unit active? null = can't tell. */
  timerActive: (unit: string) => Promise<boolean | null>;
  /** A configuration key (env / .env.local) is set to a non-empty value. */
  configured: (key: string) => boolean;
  /** Migration files in the checkout (db/migrations/*.sql), for A00. */
  migrationFiles: () => Promise<string[]>;
}

export interface Finding {
  on: boolean;
  note: string;
}

type Check = (run: Run, probe: CapabilityProbe) => Promise<Finding | null>;

interface CapabilityCheck {
  enabled?: Check | "always";
  proven?: Check;
}

async function one<T = Record<string, unknown>>(run: Run, sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    const rows = await run<T>(sql, params);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function count(run: Run, sql: string, params: unknown[] = []): Promise<number | null> {
  const r = await one<{ n: string | number }>(run, sql, params);
  return r == null ? null : Number(r.n);
}

/** Proven when `sql` (SELECT count(*) AS n, <sample> AS sample …) finds cases. */
function cases(label: string, sql: string, params: unknown[] = []): Check {
  return async (run) => {
    const r = await one<{ n: string | number; sample: string | null; last: string | null }>(run, sql, params);
    if (r == null) return null;
    const n = Number(r.n);
    const sample = r.sample ? `; e.g. ${String(r.sample).slice(0, 160)}` : "";
    const last = r.last ? `; latest ${String(r.last).slice(0, 10)}` : "";
    return { on: n > 0, note: `${n} ${label}${sample}${last}` };
  };
}

function policies(...keys: string[]): Check {
  return async (run) => {
    const rows = await (async () => {
      try {
        return await run<{ key: string; state: string; version: number }>(`SELECT key, state, version FROM policies WHERE key = ANY($1::text[])`, [keys]);
      } catch {
        return null;
      }
    })();
    if (rows == null) return null;
    const active = rows.filter((r) => r.state === "active");
    return {
      on: active.length > 0,
      note: active.length
        ? `policy ${active.map((r) => `${r.key}@${r.version}`).join(", ")} active`
        : `policy ${keys.join(" / ")} not active (${rows.map((r) => `${r.key}: ${r.state}`).join(", ") || "not seeded"})`,
    };
  };
}

function timers(...units: string[]): Check {
  return async (_run, probe) => {
    const states = await Promise.all(units.map(async (u) => [u, await probe.timerActive(u)] as const));
    if (states.some(([, s]) => s === null)) return null;
    const off = states.filter(([, s]) => !s).map(([u]) => u);
    return { on: off.length === 0, note: off.length ? `${off.join(", ")} not running` : `${units.join(", ")} running` };
  };
}

function config(...keys: string[]): Check {
  return async (_run, probe) => {
    const missing = keys.filter((k) => !probe.configured(k));
    return { on: missing.length === 0, note: missing.length ? `${missing.join(", ")} not set` : `${keys.join(", ")} set` };
  };
}

function all(...checks: Check[]): Check {
  return async (run, probe) => {
    const out: Finding[] = [];
    for (const c of checks) {
      const f = await c(run, probe);
      if (f == null) return null;
      out.push(f);
    }
    return { on: out.every((f) => f.on), note: out.map((f) => f.note).join("; ") };
  };
}

const NOT_FIXTURE = (col: string) => `${col} NOT LIKE 'zz-%'`;

export const CAPABILITY_CHECKS: Record<string, CapabilityCheck> = {
  A00: {
    enabled: "always",
    proven: async (run, probe) => {
      const files = await probe.migrationFiles();
      const applied = await (async () => {
        try {
          return (await run<{ name: string }>(`SELECT name FROM schema_migrations`)).map((r) => String(r.name));
        } catch {
          return null;
        }
      })();
      if (applied == null || !files.length) return null;
      const set = new Set(applied.map((n) => n.replace(/\.sql$/, "")));
      const missing = files.filter((f) => !set.has(f.replace(/\.sql$/, "")));
      return { on: missing.length === 0, note: missing.length ? `${missing.length} migration(s) not applied: ${missing.slice(0, 5).join(", ")}` : `all ${files.length} migrations in the checkout are applied` };
    },
  },
  A01: { enabled: "always", proven: cases("obligations resolved", `SELECT count(*) AS n, (array_agg(id::text ORDER BY updated_at DESC))[1] AS sample, max(updated_at)::text AS last FROM obligations WHERE status = 'done'`) },
  A02: { enabled: "always", proven: cases("runbook instances run to the end", `SELECT count(*) AS n, (array_agg(id::text ORDER BY started_at DESC))[1] AS sample, max(started_at)::text AS last FROM runbook_instances WHERE status = 'done'`) },
  A03a: { enabled: "always", proven: cases("commands recorded", `SELECT count(*) AS n, (array_agg(name ORDER BY started_at DESC))[1] AS sample, max(started_at)::text AS last FROM commands`) },
  A03b: {
    enabled: timers("sjcos-agent-worker.timer", "sjcos-worker.service"),
    proven: cases("event triggers processed by the background worker (done or stopped at a stated boundary)", `SELECT count(*) AS n, (array_agg(kind || ' ' || ref ORDER BY done_at DESC))[1] AS sample, max(done_at)::text AS last FROM agent_triggers WHERE state = 'done'`),
  },
  A04: { enabled: "always", proven: cases("to-dos completed with typed evidence", `SELECT count(*) AS n, (array_agg(work_item_id::text ORDER BY created_at DESC))[1] AS sample, max(created_at)::text AS last FROM agent_receipts WHERE metadata ? 'evidence'`) },
  A05_A06: {
    enabled: timers("sjcos-dispatch.timer"),
    proven: cases("approved sends delivered through the intent ledger (one each)", `SELECT count(*) AS n, (array_agg(kind ORDER BY created_at DESC))[1] AS sample, max(created_at)::text AS last FROM action_intents WHERE state = 'confirmed'`),
  },
  A07a: { enabled: "always" },
  A07b: {
    enabled: policies("invoice.initial_on_acceptance", "invoice.progress_on_owner_confirmation", "invoice.final_on_client_signoff"),
    proven: cases("payments recorded on app invoices", `SELECT count(*) AS n, (array_agg(COALESCE(provider, method, 'payment') || ' ' || to_char(amount_cents / 100.0, 'FM$999,999,990.00') ORDER BY received_at DESC))[1] AS sample, max(received_at)::text AS last FROM invoice_payments WHERE status = 'settled' AND COALESCE(method, '') <> 'legacy_status'`),
  },
  A08a: { enabled: config("DATABASE_URL_AGENT") },
  A08b: { enabled: config("DATABASE_URL_AGENT", "DATABASE_URL_WORKER") },
  A09a: {
    enabled: timers("sjcos-backup.timer", "sjcos-backup-db.timer"),
    proven: cases("backups with a tested restore", `SELECT count(*) AS n, (array_agg(kind || ' ' || id::text ORDER BY restore_tested_at DESC))[1] AS sample, max(restore_tested_at)::text AS last FROM backup_runs WHERE state = 'ok' AND restore_tested_at IS NOT NULL`),
  },
  A09b: { enabled: all(timers("sjcos-monitor.timer"), config("SJCOS_HEALTHCHECK_URL")) },
  A10: {
    enabled: async (run) => {
      const n = await count(run, `SELECT count(*) AS n FROM policies WHERE state = 'active'`);
      return n == null ? null : { on: n > 0, note: `${n} polic${n === 1 ? "y" : "ies"} active` };
    },
    proven: cases("owner decisions resolved", `SELECT count(*) AS n, (array_agg(kind ORDER BY updated_at DESC))[1] AS sample, max(updated_at)::text AS last FROM decisions WHERE status IN ('approved', 'consumed', 'rejected')`),
  },
  A11: {
    enabled: all(timers("sjcos-lead-first-response.timer", "sjcos-lead-thread-sync.timer"), policies("lead.missing_facts")),
    proven: cases("lead first responses sent", `SELECT count(*) AS n, (array_agg(lead_id::text ORDER BY updated_at DESC))[1] AS sample, max(updated_at)::text AS last FROM lead_first_responses WHERE status = 'sent'`),
  },
  A12: { enabled: "always", proven: cases("sub paperwork requests fulfilled", `SELECT count(*) AS n, (array_agg(id::text))[1] AS sample, NULL::text AS last FROM sub_document_requests WHERE state = 'satisfied'`) },
  A13: { enabled: "always", proven: cases("vendor bills paid on approval", `SELECT count(*) AS n, (array_agg(id::text))[1] AS sample, NULL::text AS last FROM bills WHERE state = 'paid'`) },
  A14: {
    enabled: async (run) => {
      const n = await count(run, `SELECT count(*) AS n FROM qbo_connection WHERE realm_id IS NOT NULL`);
      return n == null ? null : { on: n > 0, note: n > 0 ? "QuickBooks connected" : "QuickBooks not connected" };
    },
    // No automatic proof: sync runs and imported mappings exist, but the
    // outcome (books reconciled against QuickBooks) needs the bookkeeper's
    // sign-off, recorded by hand.
  },
  A15: { enabled: policies("learning.cost_update") },
  A16: {
    enabled: all(policies("weekly.client_summary"), timers("sjcos-weekly-summary.timer")),
    proven: cases("weekly client summaries sent", `SELECT count(*) AS n, (array_agg(project_id::text ORDER BY published_at DESC))[1] AS sample, max(published_at)::text AS last FROM weekly_summaries WHERE published_at IS NOT NULL`),
  },
  A17: { enabled: all(policies("postproject.followthrough"), timers("sjcos-post-project.timer")) },
  A18: { enabled: "always" },
  A19: { enabled: "always" },
  A20: {
    enabled: config("SQUARE_ACCESS_TOKEN"),
    proven: cases("Square card payments settled", `SELECT count(*) AS n, (array_agg(to_char(amount_cents / 100.0, 'FM$999,999,990.00') ORDER BY received_at DESC))[1] AS sample, max(received_at)::text AS last FROM invoice_payments WHERE provider = 'square' AND status = 'settled'`),
  },
  A21: { enabled: "always" },
  A22: {
    enabled: "always",
    proven: cases("to-dos shared with a staff login", `SELECT count(*) AS n, (array_agg(a.work_item_id::text))[1] AS sample, NULL::text AS last FROM work_item_assignees a JOIN users u ON u.id = a.user_id WHERE u.role = 'staff'`),
  },
  A23: {
    enabled: "always",
    proven: cases("workflow stage events on real jobs", `SELECT count(*) AS n, (array_agg(e.kind ORDER BY e.created_at DESC))[1] AS sample, max(e.created_at)::text AS last FROM project_workflow_events e JOIN projects p ON p.id = e.project_id WHERE ${NOT_FIXTURE("p.slug")}`),
  },
  A24: {
    enabled: policies("agent.event_wakeups"),
    proven: cases("worker runs finished with versioned instructions loaded", `SELECT count(*) AS n, (array_agg(trigger_kind || ' ' || trigger_ref ORDER BY started_at DESC))[1] AS sample, max(started_at)::text AS last FROM agent_executions WHERE status = 'done' AND entry_point = 'worker' AND instruction_versions <> '{}'::jsonb`),
  },
  "feature.decisions": { enabled: "always", proven: cases("decisions approved or consumed", `SELECT count(*) AS n, (array_agg(kind ORDER BY updated_at DESC))[1] AS sample, max(updated_at)::text AS last FROM decisions WHERE status IN ('approved', 'consumed')`) },
  "feature.dispatcher": { enabled: timers("sjcos-dispatch.timer"), proven: cases("intents delivered by the dispatcher", `SELECT count(*) AS n, (array_agg(kind ORDER BY created_at DESC))[1] AS sample, max(created_at)::text AS last FROM action_intents WHERE state = 'confirmed'`) },
  "feature.square": { enabled: config("SQUARE_ACCESS_TOKEN"), proven: cases("Square card payments settled", `SELECT count(*) AS n, NULL::text AS sample, max(received_at)::text AS last FROM invoice_payments WHERE provider = 'square' AND status = 'settled'`) },
  "feature.qbo": {
    enabled: async (run) => {
      const n = await count(run, `SELECT count(*) AS n FROM qbo_connection WHERE realm_id IS NOT NULL`);
      return n == null ? null : { on: n > 0, note: n > 0 ? "QuickBooks connected" : "QuickBooks not connected" };
    },
  },
  "feature.weekly_summary": {
    enabled: all(policies("weekly.client_summary"), timers("sjcos-weekly-summary.timer")),
    proven: cases("weekly client summaries sent", `SELECT count(*) AS n, NULL::text AS sample, max(published_at)::text AS last FROM weekly_summaries WHERE published_at IS NOT NULL`),
  },
  "feature.owner_time": { enabled: "always" },
  "feature.measurement": { enabled: "always" },
  "feature.overhead": { enabled: "always", proven: cases("overhead subscriptions tracked", `SELECT count(*) AS n, NULL::text AS sample, NULL::text AS last FROM overhead_subscriptions`) },
  "feature.procedure_checks": { enabled: "always" },
};

export interface DerivedCapability {
  key: string;
  deployed: Finding | null;
  enabled: Finding | null;
  proven: Finding | null;
}

/** Derive deployed / enabled / proven for every key in `keys`. */
export async function deriveCapabilities(run: Run, probe: CapabilityProbe, keys: readonly string[]): Promise<DerivedCapability[]> {
  const version = await probe.deployedVersion();
  const deployed: Finding | null = version ? { on: true, note: `live build ${version}` } : null;
  const out: DerivedCapability[] = [];
  for (const key of keys) {
    const c = CAPABILITY_CHECKS[key] ?? {};
    const enabled = !deployed
      ? null
      : c.enabled === "always"
        ? { on: true, note: "no switch: on whenever deployed" }
        : c.enabled
          ? await c.enabled(run, probe)
          : null;
    const proven = c.proven ? await c.proven(run, probe) : null;
    out.push({ key, deployed, enabled, proven });
  }
  return out;
}
