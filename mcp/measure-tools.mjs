// SJC OS — MCP measurement tools (A18).
//
// READ-ONLY with respect to business records. measurement_summary,
// capability_report and overhead_summary only read. procedure_checks records
// its findings (procedure_versions / procedure_checks rows) and the server's
// own registered tool names (app_settings 'measure.known_tools') so the
// in-app page can re-run the same checks; it never approves, retires or
// promotes a skill, memory or policy.
//
// Node 22 strips types, so the pure lib/measure + lib/overhead modules are
// imported directly (same precedent as financials-tools.mjs).

import { z } from "zod";
import { measurementSummary } from "../lib/measure/cases.ts";
import { baselineOwnerTouches } from "../lib/measure/baseline.ts";
import { capabilityReport } from "../lib/measure/capabilities.ts";
import { snapshotProcedures, checkProcedures, listOpenChecks, classifyPendingMemories } from "../lib/measure/procedures.ts";
import { overheadSummary, reconcileWithExpenses } from "../lib/overhead/overhead.ts";

export const KNOWN_TOOLS_SETTING = "measure.known_tools";

/** Names the server has registered so far (McpServer keeps them on
 *  _registeredTools). Works on any object exposing that map; empty otherwise. */
export function registeredToolNames(server) {
  const reg = server?._registeredTools;
  return reg && typeof reg === "object" ? Object.keys(reg).sort() : [];
}

function windowFrom({ from, to, days }) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - (days ?? 30) * 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function registerMeasureTools(server, { rows, json, pool }) {
  const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
  const run = async (sql, params) => rows(sql, params ?? []);

  server.registerTool(
    "measurement_summary",
    {
      title: "Measurement summary (honest denominators)",
      description:
        "Counts of eligible automation cases by kind with an explicit denominator and observation window: verified " +
        "successes, corrections, failures, unknown effects, missed commitments, owner minutes, agent cost and latency. " +
        "Failures stay in the denominator; one-tap approvals are assisted, not unattended. Also returns the baseline " +
        "owner-touch count derived from existing records. Never a company-wide automation percentage.",
      inputSchema: {
        days: z.number().int().min(1).max(365).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        include_baseline: z.boolean().optional(),
      },
    },
    async ({ days, from, to, include_baseline }) => {
      try {
        const window = windowFrom({ from, to, days });
        const summary = await measurementSummary(run, window);
        const baseline = include_baseline === false ? undefined : await baselineOwnerTouches(run, window);
        return json({ summary, baseline });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "capability_report",
    {
      title: "Capability status report",
      description:
        "Every A00–A24 task and key feature with four INDEPENDENT states — implemented, deployed, enabled, proven — " +
        "and the dated evidence behind each. Deployed-but-disabled is normal; proven is scoped to its evidence.",
      inputSchema: { only_true: z.enum(["implemented", "deployed", "enabled", "proven"]).optional() },
    },
    async ({ only_true }) => {
      try {
        const r = await capabilityReport(run);
        return json(only_true ? { ...r, rows: r.rows.filter((x) => x[only_true]) } : r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "procedure_checks",
    {
      title: "Procedure truthfulness checks",
      description:
        "Snapshots the current skills, runbooks, active policies and instruction blocks (versions + checksums + tool/field " +
        "references) and lists findings: tools a procedure names that this server does not register, retired fields, " +
        "contradictions between an approved procedure and an active policy or DECISIONS.md rule, and pending agent " +
        "memories / proposed skills that would change send/pay/price authority (proposed rule, not authority). " +
        "Records findings only — approves, retires or promotes nothing. Pass run=false to just read the open findings.",
      inputSchema: { run: z.boolean().optional(), include_memories: z.boolean().optional() },
    },
    async ({ run: doRun, include_memories }) => {
      try {
        const knownTools = registeredToolNames(server);
        let result = null;
        if (doRun !== false) {
          const client = await pool.connect();
          const txRun = async (sql, params) => (await client.query(sql, params ?? [])).rows;
          try {
            await client.query("BEGIN");
            const snap = await snapshotProcedures(txRun, { knownTools });
            const checks = await checkProcedures(txRun, { knownTools });
            if (knownTools.length) {
              await client.query(
                `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
                [KNOWN_TOOLS_SETTING, JSON.stringify(knownTools)],
              );
            }
            await client.query("COMMIT");
            result = { snapshot: { snapshot_id: snap.snapshot_id, recorded: snap.recorded, unchanged: snap.unchanged }, opened: checks.opened, resolved: checks.resolved };
          } catch (e) {
            await client.query("ROLLBACK").catch(() => {});
            throw e;
          } finally {
            client.release();
          }
        }
        const open = await listOpenChecks(run);
        const memories = include_memories ? await classifyPendingMemories(run, 50) : undefined;
        return json({ known_tools: knownTools.length, ...(result ?? {}), open, memories, note: "Findings are recorded only; nothing was approved, retired or promoted." });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "overhead_summary",
    {
      title: "Overhead summary (fixed vs metered)",
      description:
        "Monthly overhead: fixed subscriptions (owner-reported until reconciled to a bill/QBO by external_ref) and " +
        "metered API charges, kept separate — a subscription never implies API credits. Providers with no metered record " +
        "are reported as unknown, not $0. Includes the reconciliation proposal (external_ref matches only; never on amount).",
      inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional(), include_reconciliation: z.boolean().optional() },
    },
    async ({ month, include_reconciliation }) => {
      try {
        const summary = await overheadSummary(run, month);
        const reconciliation = include_reconciliation ? await reconcileWithExpenses(run) : undefined;
        return json({ summary, reconciliation });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
