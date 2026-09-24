// A24 operating-agent context tools: the versioned instruction block and the
// narrowly scoped project/lead context every business run should load,
// execution records for agents that run outside the worker (Hermes, claude.ai,
// the Ask window), and trigger enqueueing.

import { z } from "zod";
import { buildBusinessInstructions, standingContextBlock, listInstructionVersions } from "../lib/agent-runtime/instructions.ts";
import { startExecution, finishExecution, listExecutions } from "../lib/agent-runtime/executions.ts";
import { enqueueAgentTrigger, listPendingTriggers, TRIGGER_KINDS } from "../lib/agent-runtime/triggers.ts";
import { txOver, principalFor, fail, agentNameOf } from "./tool-shared.mjs";

export function registerContextTools(server, { rows, json, pool, slugToId, currentPrincipal }) {
  const tx = txOver(pool);
  const run = async (sql, params) => rows(sql, params ?? []);
  const principal = () => principalFor(currentPrincipal, agentNameOf(server));

  server.registerTool(
    "get_operating_context",
    { title: "Operating context for a project/lead (load first)", description: "The versioned operating instruction block (workflow digest, active policies, tone guide, standing instructions) plus narrowly scoped current context: authority, workflow state, scope, design, estimate (internal cost vs offered price, allowances), quotes/suppliers, delivery/money, communications, evidence. Untrusted text is fenced as data. Load this before working any event; never rebuild history from an inbox scan.", inputSchema: { project_slug: z.string().optional(), lead_slug: z.string().optional(), trigger: z.object({ kind: z.string(), ref: z.string(), payload: z.record(z.string(), z.unknown()).optional() }).optional(), page_context: z.string().optional() } },
    async ({ project_slug, lead_slug, trigger, page_context }) => {
      try {
        const projectId = project_slug ? await slugToId("projects", project_slug) : null;
        const leadId = lead_slug ? await slugToId("leads", lead_slug) : null;
        const p = await principal();
        const out = await buildBusinessInstructions(run, { projectId, leadId, trigger: trigger ?? null, principal: { kind: p.kind, label: p.onBehalfOf ? `${p.agent} for ${p.onBehalfOf.name}` : `${p.agent} (unattended)`, onBehalfOf: p.onBehalfOf ? { name: p.onBehalfOf.name, role: p.onBehalfOf.role } : null } }, page_context ?? null);
        return json({ ok: true, prompt: out.prompt, versions: out.versions, context: out.context });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_instruction_versions",
    { title: "Instruction versions (loaded/active)", description: "Active and historical versions of the operating block, workflow digest, policy digest and tone guide with checksums — what every business entry point loads right now.", inputSchema: { key: z.enum(["operating_block", "workflow_digest", "policy_digest", "tone_guide"]).optional(), page_context: z.string().optional() } },
    async ({ key, page_context }) => {
      try {
        const block = await standingContextBlock(run, page_context ?? null);
        return json({ ok: true, active: block.versions, history: await listInstructionVersions(run, key) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "record_agent_execution",
    { title: "Record an agent execution (start / finish)", description: "Agents running outside the worker log their run: on start (trigger, scope, loaded instruction versions, model) you get an execution id; on finish pass the tool trace, records touched, blocked reason and the next trigger. This is the proof-of-work record A24 evaluations read; it never marks business work done by itself.", inputSchema: { execution_id: z.string().uuid().optional().describe("omit to start; pass to finish"), trigger_kind: z.string().optional(), trigger_ref: z.string().optional(), project_slug: z.string().optional(), lead_slug: z.string().optional(), model: z.string().optional(), instruction_versions: z.record(z.string(), z.unknown()).optional(), status: z.enum(["done", "blocked", "failed", "timeout"]).optional(), result_summary: z.string().optional(), tool_trace: z.array(z.record(z.string(), z.unknown())).optional(), records_touched: z.array(z.record(z.string(), z.unknown())).optional(), blocked_reason: z.string().optional(), next_trigger: z.record(z.string(), z.unknown()).optional(), owner_prompts: z.number().int().optional(), cost_usd: z.number().optional(), latency_ms: z.number().int().optional() } },
    async (a) => {
      try {
        const p = await principal();
        if (!a.execution_id) {
          const projectId = a.project_slug ? await slugToId("projects", a.project_slug) : null;
          const leadId = a.lead_slug ? await slugToId("leads", a.lead_slug) : null;
          const versions = a.instruction_versions ?? (await standingContextBlock(run, null)).versions;
          const ex = await tx((r) => startExecution(r, { triggerKind: a.trigger_kind ?? "sweep", triggerRef: a.trigger_ref ?? `manual:${Date.now()}`, runtime: p.agent, entryPoint: "mcp", principal: { kind: p.kind, agent: p.agent, onBehalfOf: p.onBehalfOf ? { userId: p.onBehalfOf.userId, role: p.onBehalfOf.role, name: p.onBehalfOf.name } : null }, projectId, leadId, instructionVersions: versions, model: a.model ?? null }));
          return json({ ok: true, execution_id: ex.id });
        }
        const ex = await tx((r) => finishExecution(r, a.execution_id, { status: a.status ?? "done", resultSummary: a.result_summary ?? null, toolTrace: a.tool_trace, recordsTouched: a.records_touched, blockedReason: a.blocked_reason ?? null, nextTrigger: a.next_trigger ?? null, ownerPrompts: a.owner_prompts, costUsd: a.cost_usd ?? null, latencyMs: a.latency_ms ?? null, model: a.model ?? null }));
        return json(ex ? { ok: true, execution: ex } : { ok: false, error: "no such execution" });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "enqueue_agent_trigger",
    { title: "Enqueue an event for the background operating agent", description: "Registers an event (signature, message, note, quote, selection, payment, field_report, approval, signoff, sweep) so the background worker works it without Joe opening the panel. Idempotent on (kind, ref).", inputSchema: { kind: z.enum(TRIGGER_KINDS), ref: z.string(), project_slug: z.string().optional(), lead_slug: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional() } },
    async (a) => {
      try {
        const projectId = a.project_slug ? await slugToId("projects", a.project_slug) : null;
        const leadId = a.lead_slug ? await slugToId("leads", a.lead_slug) : null;
        return json(await tx((r) => enqueueAgentTrigger(r, { kind: a.kind, ref: a.ref, projectId, leadId, payload: a.payload ?? {}, enqueuedBy: `mcp:${agentNameOf(server)}` })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_agent_activity",
    { title: "Pending triggers and recent executions", description: "What the background agent still has to work and what it did recently (versions, tool trace summary, blocked reasons).", inputSchema: { project_slug: z.string().optional(), limit: z.number().int().min(1).max(100).optional() } },
    async ({ project_slug, limit }) => {
      try {
        const projectId = project_slug ? await slugToId("projects", project_slug) : null;
        return json({ pending: await listPendingTriggers(run, limit ?? 50), executions: await listExecutions(run, { projectId, limit: limit ?? 20 }) });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
