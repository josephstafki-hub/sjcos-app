// Transactional runbook engine core (A02). Pure: every function takes a
// `run(sql, params)` that the caller wraps in ONE transaction (lib/commands/db
// withTransaction in the app, a pg.Client BEGIN/COMMIT in tests). Network
// calls never happen here — a step's ping/notify is recorded as a row in
// runbook_wakeups inside the same transaction and delivered after commit by
// drainRunbookWakeups() in lib/runbook-engine.ts.
//
// Guarantees (VALIDATION.md V03):
//   • start = instance + pinned definition version + step-1 work item + wakeup
//     in one transaction (a death at any statement leaves nothing);
//   • advance = lock instance FOR UPDATE, validate the pinned definition and
//     the predecessor's evidence, insert the successor under the UNIQUE
//     (instance_id, step_order) key in runbook_steps_log (a concurrent caller
//     hits ON CONFLICT DO NOTHING and stands down), update progress, record
//     the wakeup;
//   • an instance reads ONLY its pinned version: editing runbook_steps mid-run
//     changes nothing for it;
//   • missing definition / unpinned legacy instance → repair_state
//     'needs_review', never a false 'done';
//   • repair is bounded, logged (runbook_repairs) and dry-runnable.

import type { Run } from "../commands/core.ts";

export type RunbookInstanceStatus = "running" | "waiting_approval" | "waiting_human" | "done" | "cancelled";
export type RequiredEvidence = "any" | "draft" | "provider_accepted" | "delivered" | "business_response" | "manual" | "record";

export interface StepDef {
  stepOrder: number;
  title: string;
  skillSlug: string | null;
  expectedOutput: string;
  requiresApproval: boolean;
  assignedTo: "agent" | "human";
  requiredEvidence: RequiredEvidence;
}

export interface RunbookSnapshot {
  id: string;
  slug: string;
  title: string;
  active: boolean;
  steps: StepDef[];
}

export interface PinnedDefinition {
  versionId: string;
  version: number;
  slug: string;
  title: string;
  steps: StepDef[];
}

export interface Target {
  kind: "lead" | "project";
  id: string;
  slug: string;
  name: string;
}

interface StepJson {
  step_order: number;
  title: string;
  skill_slug: string | null;
  expected_output: string;
  requires_approval: boolean;
  assigned_to: string;
  required_evidence?: string;
}

const EVIDENCE_KINDS: RequiredEvidence[] = ["any", "draft", "provider_accepted", "delivered", "business_response", "manual", "record"];

/** Which receipt kinds satisfy a step's contract. */
export function evidenceSatisfies(required: RequiredEvidence, got: string | null | undefined): boolean {
  if (required === "any") return true;
  if (!got) return false;
  switch (required) {
    case "draft":
      return got === "draft";
    case "provider_accepted":
      return got === "provider_accepted" || got === "delivered";
    case "delivered":
      return got === "delivered";
    case "business_response":
      return got === "business_response";
    case "record":
      return got === "record";
    case "manual":
      return EVIDENCE_KINDS.includes(got as RequiredEvidence) && got !== "any";
  }
}

export function stepsFromJson(raw: unknown): StepDef[] {
  const arr = Array.isArray(raw) ? (raw as StepJson[]) : [];
  return arr
    .map((s) => ({
      stepOrder: Number(s.step_order),
      title: String(s.title ?? ""),
      skillSlug: s.skill_slug ?? null,
      expectedOutput: String(s.expected_output ?? ""),
      requiresApproval: Boolean(s.requires_approval),
      assignedTo: s.assigned_to === "human" ? ("human" as const) : ("agent" as const),
      requiredEvidence: (EVIDENCE_KINDS.includes((s.required_evidence ?? "any") as RequiredEvidence) ? s.required_evidence ?? "any" : "any") as RequiredEvidence,
    }))
    .sort((a, b) => a.stepOrder - b.stepOrder);
}

export function stepsToJson(steps: StepDef[]): StepJson[] {
  return steps.map((s) => ({
    step_order: s.stepOrder,
    title: s.title,
    skill_slug: s.skillSlug,
    expected_output: s.expectedOutput,
    requires_approval: s.requiresApproval,
    assigned_to: s.assignedTo,
    required_evidence: s.requiredEvidence,
  }));
}

/** The CURRENT definition (runbooks + runbook_steps). No `active` filter. */
export async function snapshotDefinition(run: Run, slug: string): Promise<RunbookSnapshot | null> {
  const [rb] = await run<{ id: string; slug: string; title: string; active: boolean }>(`SELECT id, slug, title, active FROM runbooks WHERE slug = $1`, [slug]);
  if (!rb) return null;
  const rows = await run<StepJson>(
    `SELECT step_order, title, skill_slug, expected_output, requires_human_approval AS requires_approval, assigned_to, required_evidence
       FROM runbook_steps WHERE runbook_id = $1 ORDER BY step_order`,
    [rb.id],
  );
  return { ...rb, steps: stepsFromJson(rows) };
}

/** Pin the snapshot as an immutable version (re-uses an identical earlier
 *  version by checksum). Serialized per runbook with an advisory xact lock so
 *  two concurrent starts of a freshly edited runbook cannot race on the
 *  version number. */
export async function pinDefinitionVersion(run: Run, snap: RunbookSnapshot, by = "runbook-engine"): Promise<PinnedDefinition> {
  await run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`runbook-def:${snap.slug}`]);
  const stepsJson = JSON.stringify(stepsToJson(snap.steps));
  const inserted = await run<{ id: string; version: number }>(
    `INSERT INTO runbook_definition_versions (runbook_id, runbook_slug, version, title, steps, checksum, created_by)
     SELECT $1, $2, COALESCE((SELECT max(version) FROM runbook_definition_versions WHERE runbook_slug = $2), 0) + 1, $3, $4::jsonb,
            encode(sha256(convert_to($4::jsonb::text, 'UTF8')), 'hex'), $5
     ON CONFLICT (runbook_slug, checksum) DO NOTHING
     RETURNING id, version`,
    [snap.id, snap.slug, snap.title, stepsJson, by],
  );
  let row = inserted[0];
  if (!row) {
    const found = await run<{ id: string; version: number }>(
      `SELECT id, version FROM runbook_definition_versions
        WHERE runbook_slug = $1 AND checksum = encode(sha256(convert_to($2::jsonb::text, 'UTF8')), 'hex')`,
      [snap.slug, stepsJson],
    );
    row = found[0];
    if (!row) throw new Error(`definition version for ${snap.slug} vanished after conflict`);
  }
  return { versionId: row.id, version: row.version, slug: snap.slug, title: snap.title, steps: snap.steps };
}

export async function loadPinnedDefinition(run: Run, versionId: string): Promise<PinnedDefinition | null> {
  const [v] = await run<{ id: string; version: number; runbook_slug: string; title: string; steps: unknown }>(
    `SELECT id, version, runbook_slug, title, steps FROM runbook_definition_versions WHERE id = $1`,
    [versionId],
  );
  if (!v) return null;
  return { versionId: v.id, version: v.version, slug: v.runbook_slug, title: v.title, steps: stepsFromJson(v.steps) };
}

export async function loadTarget(run: Run, leadId: string | null, projectId: string | null): Promise<Target | null> {
  if (leadId) {
    const [l] = await run<{ slug: string; name: string }>(`SELECT slug, name FROM leads WHERE id = $1`, [leadId]);
    return l ? { kind: "lead", id: leadId, slug: l.slug, name: l.name } : null;
  }
  if (projectId) {
    const [p] = await run<{ slug: string; name: string }>(`SELECT slug, name FROM projects WHERE id = $1`, [projectId]);
    return p ? { kind: "project", id: projectId, slug: p.slug, name: p.name } : null;
  }
  return null;
}

export function targetHref(t: Target): string {
  return `/${t.kind === "lead" ? "leads" : "projects"}/${t.slug}`;
}

export interface WakeupRow {
  id: string;
  instance_id: string;
  step_order: number;
  work_item_id: string | null;
  kind: "agent_ping" | "owner_notify";
  payload: Record<string, unknown>;
  state: "pending" | "sent" | "failed";
  attempts: number;
}

interface SpawnOutcome {
  spawned: boolean;
  workItemId: string | null;
  wakeupId: string | null;
}

/** Create the step's work item EXACTLY ONCE per (instance, step). The
 *  runbook_steps_log unique row is claimed first; a loser of that race gets
 *  spawned:false and writes nothing else. Also handles the repair case where
 *  the log row exists but its work item was deleted (work_item_id NULL). */
export async function spawnStepTx(
  run: Run,
  args: { instanceId: string; def: PinnedDefinition; step: StepDef; target: Target; by: string; predecessorEvidence?: Record<string, unknown> | null; repair?: boolean },
): Promise<SpawnOutcome> {
  const { instanceId, def, step, target } = args;
  const claimed = await run<{ id: string }>(
    `INSERT INTO runbook_steps_log (instance_id, step_order, created_by, evidence)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (instance_id, step_order) DO NOTHING
     RETURNING id`,
    [instanceId, step.stepOrder, args.by, args.predecessorEvidence ? JSON.stringify(args.predecessorEvidence) : null],
  );
  let logId = claimed[0]?.id ?? null;
  if (!logId) {
    if (!args.repair) return { spawned: false, workItemId: null, wakeupId: null };
    // Repair: the log row exists; only proceed when its work item is gone.
    const [existing] = await run<{ id: string; work_item_id: string | null; live: boolean }>(
      `SELECT l.id, l.work_item_id, (w.id IS NOT NULL) AS live
         FROM runbook_steps_log l LEFT JOIN work_items w ON w.id = l.work_item_id
        WHERE l.instance_id = $1 AND l.step_order = $2 FOR UPDATE OF l`,
      [instanceId, step.stepOrder],
    );
    if (!existing || existing.live) return { spawned: false, workItemId: existing?.work_item_id ?? null, wakeupId: null };
    logId = existing.id;
  }

  const isAgent = step.assignedTo === "agent";
  const title = `${def.title} · step ${step.stepOrder}: ${step.title}`;
  const body = [
    `Runbook "${def.title}" (${def.slug}, v${def.version}) — step ${step.stepOrder} of ${def.steps.length}: ${step.title}`,
    `Target: ${target.kind} ${target.name} (${targetHref(target)})`,
    step.expectedOutput ? `Expected output:\n${step.expectedOutput}` : null,
    step.requiredEvidence !== "any" ? `Completion evidence required: ${step.requiredEvidence}` : null,
    `Mark this work item done when the step's output exists — the runbook engine spawns the next step automatically.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const [wi] = await run<{ id: string }>(
    `INSERT INTO work_items
       (title, body, priority, assignee_kind, assignee_key, lead_id, project_id,
        expected_skill_slug, expected_runbook_slug, requires_approval,
        source_kind, created_by, runbook_instance_id, runbook_step_order)
     VALUES ($1, $2, 'normal', $3, $4, $5, $6, $7, $8, $9, 'schedule', 'runbook-engine', $10, $11)
     RETURNING id`,
    [
      title,
      body,
      isAgent ? "agent" : "human",
      isAgent ? "hermes-telegram" : "human-joe",
      target.kind === "lead" ? target.id : null,
      target.kind === "project" ? target.id : null,
      step.skillSlug,
      def.slug,
      step.requiresApproval,
      instanceId,
      step.stepOrder,
    ],
  );
  await run(`UPDATE runbook_steps_log SET work_item_id = $2 WHERE id = $1`, [logId, wi.id]);
  await run(
    `UPDATE runbook_instances SET current_step = $2, status = $3, blocked_reason = NULL
      WHERE id = $1 AND status NOT IN ('done','cancelled')`,
    [instanceId, step.stepOrder, isAgent ? "running" : "waiting_human"],
  );
  const payload = isAgent
    ? {
        title,
        assignee_key: "hermes-telegram",
        page_context: `${target.kind} ${target.slug}`,
        prompt:
          `New runbook step: "${title}"\n\n${body}\n\n` +
          (step.skillSlug ? `Load the skill "${step.skillSlug}" (get_skill) before working the step. ` : "") +
          (step.requiresApproval ? `This step needs Joe's approval — stage the output with submit_draft_for_approval, never send anything yourself. ` : "") +
          `When the expected output exists, mark the work item done via update_work_item_status.`,
      }
    : {
        title: `Runbook step for you: ${step.title}`,
        body: `${def.title} · step ${step.stepOrder} of ${def.steps.length} · ${target.name}`,
        href: `${targetHref(target)}?tab=Ops`,
      };
  const [wk] = await run<{ id: string }>(
    `INSERT INTO runbook_wakeups (instance_id, step_order, work_item_id, kind, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [instanceId, step.stepOrder, wi.id, isAgent ? "agent_ping" : "owner_notify", JSON.stringify(payload)],
  );
  return { spawned: true, workItemId: wi.id, wakeupId: wk.id };
}

export type StartRunbookResult = { ok: true; instanceId: string; workItemId: string } | { ok: false; error: string };

/** Instance + pinned version + step 1 + wakeup, all on the caller's tx. */
export async function startRunbookTx(
  run: Run,
  runbookSlug: string,
  target: { leadId?: string | null; projectId?: string | null },
  startedBy: string,
): Promise<StartRunbookResult> {
  const snap = await snapshotDefinition(run, runbookSlug);
  if (!snap) return { ok: false, error: `No runbook "${runbookSlug}".` };
  if (!snap.active) return { ok: false, error: `Runbook "${runbookSlug}" is inactive.` };
  if (snap.steps.length === 0) return { ok: false, error: `Runbook "${runbookSlug}" has no steps.` };

  const t = await loadTarget(run, target.leadId ?? null, target.projectId ?? null);
  if (!t) return { ok: false, error: "Target lead/project not found." };

  // Serialize concurrent starts for the same (runbook, target) so the loser
  // sees the winner's committed row instead of a unique-violation abort.
  await run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`runbook-start:${runbookSlug}:${t.id}`]);
  const [dupe] = await run<{ id: string }>(
    `SELECT id FROM runbook_instances
      WHERE runbook_slug = $1 AND ${t.kind === "lead" ? "lead_id" : "project_id"} = $2 AND status NOT IN ('done','cancelled')`,
    [runbookSlug, t.id],
  );
  if (dupe) return { ok: false, error: `Runbook "${runbookSlug}" is already running for ${t.kind} ${t.slug} (instance ${dupe.id}).` };

  const def = await pinDefinitionVersion(run, snap, startedBy);
  const [inst] = await run<{ id: string }>(
    `INSERT INTO runbook_instances (runbook_id, runbook_slug, lead_id, project_id, started_by, definition_version_id, policy_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [snap.id, snap.slug, t.kind === "lead" ? t.id : null, t.kind === "project" ? t.id : null, startedBy, def.versionId, `def@${def.version}`],
  );
  const spawned = await spawnStepTx(run, { instanceId: inst.id, def, step: def.steps[0], target: t, by: "start" });
  if (!spawned.spawned || !spawned.workItemId) throw new Error("step 1 could not be created for a brand-new instance");
  return { ok: true, instanceId: inst.id, workItemId: spawned.workItemId };
}

export type AdvanceOutcome =
  | { outcome: "noop"; reason: string }
  | { outcome: "waiting"; status: RunbookInstanceStatus }
  | { outcome: "needs_review"; reason: string }
  | { outcome: "evidence_missing"; reason: string }
  | { outcome: "cancelled" }
  | { outcome: "done" }
  | { outcome: "advanced"; stepOrder: number; workItemId: string };

interface InstanceRow {
  id: string;
  runbook_slug: string;
  lead_id: string | null;
  project_id: string | null;
  current_step: number;
  status: RunbookInstanceStatus;
  definition_version_id: string | null;
  repair_state: string;
}

interface StepItemRow {
  id: string;
  title: string;
  status: string;
  approval_status: string;
  requires_approval: boolean;
  assignee_kind: string;
  receipt_kind: string | null;
  receipt_id: string | null;
}

/** Judge the current step under the instance row lock and move on. */
export async function advanceRunbookTx(run: Run, instanceId: string): Promise<AdvanceOutcome> {
  const [inst] = await run<InstanceRow>(
    `SELECT id, runbook_slug, lead_id, project_id, current_step, status, definition_version_id, repair_state
       FROM runbook_instances WHERE id = $1 FOR UPDATE`,
    [instanceId],
  );
  if (!inst) return { outcome: "noop", reason: "no such instance" };
  if (inst.status === "done" || inst.status === "cancelled") return { outcome: "noop", reason: `instance is ${inst.status}` };

  const def = inst.definition_version_id ? await loadPinnedDefinition(run, inst.definition_version_id) : null;
  if (!def) {
    const reason = inst.definition_version_id ? "pinned definition version missing" : "instance has no pinned definition version (legacy); cannot prove which steps it follows";
    await run(`UPDATE runbook_instances SET repair_state = 'needs_review', blocked_reason = $2 WHERE id = $1`, [instanceId, reason]);
    return { outcome: "needs_review", reason };
  }

  const [wi] = await run<StepItemRow>(
    `SELECT w.id, w.title, w.status, w.approval_status, w.requires_approval, w.assignee_kind,
            r.receipt_kind, r.id AS receipt_id
       FROM work_items w
       LEFT JOIN LATERAL (
         SELECT id, receipt_kind FROM agent_receipts WHERE work_item_id = w.id ORDER BY created_at DESC LIMIT 1
       ) r ON true
      WHERE w.runbook_instance_id = $1 AND w.runbook_step_order = $2
      ORDER BY w.created_at DESC LIMIT 1`,
    [instanceId, inst.current_step],
  );
  if (!wi) {
    const reason = `step ${inst.current_step} has no work item; run repair`;
    await run(`UPDATE runbook_instances SET repair_state = 'needs_review', blocked_reason = $2 WHERE id = $1 AND repair_state = 'ok'`, [instanceId, reason]);
    return { outcome: "needs_review", reason };
  }

  if (wi.status === "cancelled") {
    await run(
      `UPDATE runbook_instances
          SET status = 'cancelled', completed_at = now(),
              note = CASE WHEN note = '' THEN $2 ELSE note || E'\n' || $2 END
        WHERE id = $1`,
      [instanceId, `Cancelled: step ${inst.current_step} work item "${wi.title}" was cancelled.`],
    );
    return { outcome: "cancelled" };
  }

  const cleared = wi.status === "done" && (!wi.requires_approval || wi.approval_status === "approved");
  if (!cleared) {
    const waiting: RunbookInstanceStatus =
      wi.status === "approval_needed" || wi.approval_status === "requested" || (wi.status === "done" && wi.requires_approval)
        ? "waiting_approval"
        : wi.assignee_kind === "human"
          ? "waiting_human"
          : "running";
    await run(`UPDATE runbook_instances SET status = $2 WHERE id = $1 AND status <> $2`, [instanceId, waiting]);
    return { outcome: "waiting", status: waiting };
  }

  const current = def.steps.find((s) => s.stepOrder === inst.current_step);
  const required = current?.requiredEvidence ?? "any";
  if (!evidenceSatisfies(required, wi.receipt_kind)) {
    const reason = `step ${inst.current_step} is marked done but has no '${required}' evidence receipt (found: ${wi.receipt_kind ?? "none"})`;
    await run(`UPDATE runbook_instances SET blocked_reason = $2 WHERE id = $1`, [instanceId, reason]);
    return { outcome: "evidence_missing", reason };
  }

  const next = def.steps.find((s) => s.stepOrder > inst.current_step);
  if (!next) {
    await run(`UPDATE runbook_instances SET status = 'done', completed_at = now(), blocked_reason = NULL WHERE id = $1`, [instanceId]);
    return { outcome: "done" };
  }

  const t = await loadTarget(run, inst.lead_id, inst.project_id);
  if (!t) return { outcome: "noop", reason: "target gone" };
  const spawned = await spawnStepTx(run, {
    instanceId,
    def,
    step: next,
    target: t,
    by: "advance",
    predecessorEvidence: { step_order: inst.current_step, work_item_id: wi.id, receipt_id: wi.receipt_id, receipt_kind: wi.receipt_kind },
  });
  if (!spawned.spawned || !spawned.workItemId) return { outcome: "noop", reason: `step ${next.stepOrder} already exists` };
  return { outcome: "advanced", stepOrder: next.stepOrder, workItemId: spawned.workItemId };
}

export async function cancelRunbookInstanceTx(run: Run, instanceId: string, note = "Cancelled by owner."): Promise<boolean> {
  const [inst] = await run<{ id: string }>(
    `UPDATE runbook_instances
        SET status = 'cancelled', completed_at = now(),
            note = CASE WHEN note = '' THEN $2 ELSE note || E'\n' || $2 END
      WHERE id = $1 AND status NOT IN ('done','cancelled')
      RETURNING id`,
    [instanceId, note],
  );
  if (!inst) return false;
  await run(
    `UPDATE work_items SET status = 'cancelled', blocked_reason = COALESCE(blocked_reason, $2)
      WHERE runbook_instance_id = $1 AND status NOT IN ('done','cancelled')`,
    [instanceId, note],
  );
  await run(`UPDATE runbook_wakeups SET state = 'failed', last_error = 'instance cancelled' WHERE instance_id = $1 AND state = 'pending'`, [instanceId]);
  return true;
}

export interface RepairReport {
  dryRun: boolean;
  scanned: number;
  actions: { instanceId: string; stepOrder: number; action: "recreate_step" | "needs_review" | "noop"; detail: string; workItemId?: string | null }[];
}

/** Find live instances whose current step has no work item and recreate
 *  ONLY that step. Replay-safe (the step-log key), logged (runbook_repairs)
 *  and bounded (`limit`). */
export async function repairRunbookInstancesTx(run: Run, opts: { dryRun?: boolean; limit?: number; by?: string } = {}): Promise<RepairReport> {
  const dryRun = opts.dryRun ?? true;
  const by = opts.by ?? "repair";
  const report: RepairReport = { dryRun, scanned: 0, actions: [] };
  const candidates = await run<InstanceRow>(
    `SELECT i.id, i.runbook_slug, i.lead_id, i.project_id, i.current_step, i.status, i.definition_version_id, i.repair_state
       FROM runbook_instances i
      WHERE i.status NOT IN ('done','cancelled')
        AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.runbook_instance_id = i.id AND w.runbook_step_order = i.current_step)
      ORDER BY i.started_at
      LIMIT $1
      ${dryRun ? "" : "FOR UPDATE OF i SKIP LOCKED"}`,
    [Math.min(Math.max(opts.limit ?? 50, 1), 500)],
  );
  report.scanned = candidates.length;
  for (const inst of candidates) {
    const log = async (action: RepairReport["actions"][number]["action"], detail: string, workItemId: string | null = null) => {
      report.actions.push({ instanceId: inst.id, stepOrder: inst.current_step, action, detail, workItemId });
      await run(
        `INSERT INTO runbook_repairs (instance_id, step_order, action, dry_run, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [inst.id, inst.current_step, action, dryRun, JSON.stringify({ detail, work_item_id: workItemId, by })],
      );
    };
    const def = inst.definition_version_id ? await loadPinnedDefinition(run, inst.definition_version_id) : null;
    if (!def) {
      const detail = "no pinned definition version; cannot recreate a step without guessing";
      if (!dryRun) await run(`UPDATE runbook_instances SET repair_state = 'needs_review', blocked_reason = COALESCE(blocked_reason, $2) WHERE id = $1`, [inst.id, detail]);
      await log("needs_review", detail);
      continue;
    }
    const step = def.steps.find((s) => s.stepOrder === inst.current_step);
    if (!step) {
      const detail = `pinned definition v${def.version} has no step ${inst.current_step}`;
      if (!dryRun) await run(`UPDATE runbook_instances SET repair_state = 'needs_review', blocked_reason = COALESCE(blocked_reason, $2) WHERE id = $1`, [inst.id, detail]);
      await log("needs_review", detail);
      continue;
    }
    const target = await loadTarget(run, inst.lead_id, inst.project_id);
    if (!target) {
      await log("noop", "target lead/project gone");
      continue;
    }
    if (dryRun) {
      await log("recreate_step", `would recreate step ${step.stepOrder} "${step.title}" from definition v${def.version}`);
      continue;
    }
    const spawned = await spawnStepTx(run, { instanceId: inst.id, def, step, target, by, repair: true });
    if (spawned.spawned) {
      await run(`UPDATE runbook_instances SET repair_state = 'repaired' WHERE id = $1`, [inst.id]);
      await log("recreate_step", `recreated step ${step.stepOrder} "${step.title}" from definition v${def.version}`, spawned.workItemId);
    } else {
      await log("noop", "step already present when re-checked");
    }
  }
  return report;
}

/** Claim pending wakeups for delivery (SKIP LOCKED makes drains disjoint). */
export async function claimWakeups(run: Run, limit = 20, maxAttempts = 5): Promise<WakeupRow[]> {
  return run<WakeupRow>(
    `WITH picked AS (
       SELECT id FROM runbook_wakeups WHERE state = 'pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     UPDATE runbook_wakeups w SET attempts = w.attempts + 1,
            state = CASE WHEN w.attempts + 1 >= $2 THEN 'failed' ELSE w.state END
       FROM picked WHERE w.id = picked.id
     RETURNING w.id, w.instance_id, w.step_order, w.work_item_id, w.kind, w.payload, w.state, w.attempts`,
    [limit, maxAttempts],
  );
}

export async function finishWakeup(run: Run, id: string, ok: boolean, error?: string | null): Promise<void> {
  if (ok) await run(`UPDATE runbook_wakeups SET state = 'sent', sent_at = now(), last_error = NULL WHERE id = $1`, [id]);
  else await run(`UPDATE runbook_wakeups SET last_error = $2 WHERE id = $1`, [id, (error ?? "unknown").slice(0, 1000)]);
}
