import "server-only";

// W6 runbook stepper. A runbook_instance is one live walk through a runbook
// (runbooks/runbook_steps stay the definitions — see lib/skills.ts) against
// one lead or project. The engine spawns exactly ONE work item per step:
//
//   startRunbook()          → creates the instance + spawns step 1
//   maybeAdvanceRunbook()   → called from EVERY work-item completion path
//                             (owner UI actions, orchestrator executors, and —
//                             via app/api/internal/runbooks — the MCP server);
//                             no-op unless the item carries a
//                             runbook_instance_id
//   advanceRunbookInstance()→ judges the current step's work item: done (+
//                             approved when the step requires it) spawns the
//                             next step or completes the instance; a cancelled
//                             step cancels the instance with a note; otherwise
//                             it just refreshes the instance's waiting status.
//
// Agent steps get an immediate ping (pingAgentWorkItem — same machinery as
// approval pings, retry sweep + the agent's scheduled pass as fallback); human
// steps push Joe via notifyOwner (W3). Advancing is idempotent: the
// current_step compare-and-set means only one caller ever spawns a given step.

import { query, queryOne } from "@/lib/db";
import { pingAgentWorkItem } from "@/lib/dev-agents";
import { notifyOwner } from "@/lib/notify-owner";

export type RunbookInstanceStatus =
  | "running"
  | "waiting_approval"
  | "waiting_human"
  | "done"
  | "cancelled";

interface StepDef {
  stepOrder: number;
  title: string;
  skillSlug: string | null;
  expectedOutput: string;
  requiresApproval: boolean;
  assignedTo: "agent" | "human";
}

interface RunbookDef {
  id: string;
  slug: string;
  title: string;
  active: boolean;
  steps: StepDef[];
}

interface Target {
  kind: "lead" | "project";
  id: string;
  slug: string;
  name: string;
}

async function loadRunbookDef(slug: string): Promise<RunbookDef | null> {
  // No `active` filter: deactivating a runbook mid-run must not strand a live
  // instance — startRunbook checks `active` itself.
  const rb = await queryOne<{ id: string; slug: string; title: string; active: boolean }>(
    `SELECT id, slug, title, active FROM runbooks WHERE slug = $1`,
    [slug],
  );
  if (!rb) return null;
  const { rows } = await query<{
    step_order: number;
    title: string;
    skill_slug: string | null;
    expected_output: string;
    requires_human_approval: boolean;
    assigned_to: string;
  }>(
    `SELECT step_order, title, skill_slug, expected_output, requires_human_approval, assigned_to
       FROM runbook_steps WHERE runbook_id = $1 ORDER BY step_order`,
    [rb.id],
  );
  return {
    id: rb.id,
    slug: rb.slug,
    title: rb.title,
    active: rb.active,
    steps: rows.map((s) => ({
      stepOrder: s.step_order,
      title: s.title,
      skillSlug: s.skill_slug,
      expectedOutput: s.expected_output,
      requiresApproval: s.requires_human_approval,
      assignedTo: s.assigned_to === "human" ? "human" : "agent",
    })),
  };
}

async function loadTarget(leadId: string | null, projectId: string | null): Promise<Target | null> {
  if (leadId) {
    const l = await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM leads WHERE id = $1`, [leadId]);
    return l ? { kind: "lead", id: leadId, slug: l.slug, name: l.name } : null;
  }
  if (projectId) {
    const p = await queryOne<{ slug: string; name: string }>(`SELECT slug, name FROM projects WHERE id = $1`, [
      projectId,
    ]);
    return p ? { kind: "project", id: projectId, slug: p.slug, name: p.name } : null;
  }
  return null;
}

function targetHref(t: Target): string {
  return `/${t.kind === "lead" ? "leads" : "projects"}/${t.slug}`;
}

/** Create the ONE work item for a step, point the instance at it, and nudge
 *  whoever owns it. The nudges are best-effort — a failed ping must never
 *  error the spawn; the step just waits for the agent's next scheduled pass
 *  (or Joe finding it on /engine). */
async function spawnStep(instanceId: string, rb: RunbookDef, step: StepDef, target: Target): Promise<string> {
  const isAgent = step.assignedTo === "agent";
  const title = `${rb.title} · step ${step.stepOrder}: ${step.title}`;
  const body = [
    `Runbook "${rb.title}" (${rb.slug}) — step ${step.stepOrder} of ${rb.steps.length}: ${step.title}`,
    `Target: ${target.kind} ${target.name} (${targetHref(target)})`,
    step.expectedOutput ? `Expected output:\n${step.expectedOutput}` : null,
    `Mark this work item done when the step's output exists — the runbook engine spawns the next step automatically.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const wi = await queryOne<{ id: string }>(
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
      rb.slug,
      step.requiresApproval,
      instanceId,
      step.stepOrder,
    ],
  );

  await query(
    `UPDATE runbook_instances SET current_step = $2, status = $3
      WHERE id = $1 AND status NOT IN ('done','cancelled')`,
    [instanceId, step.stepOrder, isAgent ? "running" : "waiting_human"],
  );

  const pageContext = `${target.kind} ${target.slug}`;
  if (isAgent) {
    try {
      const prompt =
        `New runbook step: "${title}"\n\n${body}\n\n` +
        (step.skillSlug ? `Load the skill "${step.skillSlug}" (get_skill) before working the step. ` : "") +
        (step.requiresApproval
          ? `This step needs Joe's approval — stage the output with submit_draft_for_approval, never send anything yourself. `
          : "") +
        `When the expected output exists, mark the work item done via update_work_item_status.`;
      await pingAgentWorkItem(wi!.id, "hermes-telegram", title, prompt, pageContext);
    } catch (err) {
      console.error("[runbook-engine] step ping failed (agent's scheduled pass will pick it up)", err);
    }
  } else {
    // notifyOwner never throws; quiet hours / throttle park to push_outbox.
    await notifyOwner({
      kind: "urgent_item",
      title: `Runbook step for you: ${step.title}`,
      body: `${rb.title} · step ${step.stepOrder} of ${rb.steps.length} · ${target.name}`,
      href: `${targetHref(target)}?tab=Ops`,
    });
  }
  return wi!.id;
}

export type StartRunbookResult =
  | { ok: true; instanceId: string; workItemId: string }
  | { ok: false; error: string };

/** Start a runbook against one lead or project. Refuses (rather than throws)
 *  when an active instance of that runbook already exists for the target. */
export async function startRunbook(
  runbookSlug: string,
  target: { leadId?: string | null; projectId?: string | null },
  startedBy: string,
): Promise<StartRunbookResult> {
  const rb = await loadRunbookDef(runbookSlug);
  if (!rb) return { ok: false, error: `No runbook "${runbookSlug}".` };
  if (!rb.active) return { ok: false, error: `Runbook "${runbookSlug}" is inactive.` };
  if (rb.steps.length === 0) return { ok: false, error: `Runbook "${runbookSlug}" has no steps.` };

  const t = await loadTarget(target.leadId ?? null, target.projectId ?? null);
  if (!t) return { ok: false, error: "Target lead/project not found." };

  const dupe = await queryOne<{ id: string }>(
    `SELECT id FROM runbook_instances
      WHERE runbook_slug = $1 AND ${t.kind === "lead" ? "lead_id" : "project_id"} = $2
        AND status NOT IN ('done','cancelled')`,
    [runbookSlug, t.id],
  );
  if (dupe) {
    return { ok: false, error: `Runbook "${runbookSlug}" is already running for ${t.kind} ${t.slug} (instance ${dupe.id}).` };
  }

  let instanceId: string;
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO runbook_instances (runbook_id, runbook_slug, lead_id, project_id, started_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [rb.id, rb.slug, t.kind === "lead" ? t.id : null, t.kind === "project" ? t.id : null, startedBy],
    );
    instanceId = row!.id;
  } catch (err) {
    // Race on the partial unique index (two starts at once) → same refusal.
    if ((err as { code?: string }).code === "23505") {
      return { ok: false, error: `Runbook "${runbookSlug}" is already running for ${t.kind} ${t.slug}.` };
    }
    throw err;
  }

  const workItemId = await spawnStep(instanceId, rb, rb.steps[0], t);
  return { ok: true, instanceId, workItemId };
}

/** Judge the current step's work item and move the instance accordingly.
 *  Idempotent: re-judging an already-advanced step (or a terminal instance)
 *  is a no-op — the current_step compare-and-set makes sure only one caller
 *  spawns any given step. */
export async function advanceRunbookInstance(instanceId: string): Promise<void> {
  const inst = await queryOne<{
    id: string;
    runbook_slug: string;
    lead_id: string | null;
    project_id: string | null;
    current_step: number;
    status: string;
  }>(
    `SELECT id, runbook_slug, lead_id, project_id, current_step, status
       FROM runbook_instances WHERE id = $1`,
    [instanceId],
  );
  if (!inst || inst.status === "done" || inst.status === "cancelled") return;

  const wi = await queryOne<{
    id: string;
    title: string;
    status: string;
    approval_status: string;
    requires_approval: boolean;
    assignee_kind: string;
  }>(
    `SELECT id, title, status, approval_status, requires_approval, assignee_kind
       FROM work_items
      WHERE runbook_instance_id = $1 AND runbook_step_order = $2
      ORDER BY created_at DESC LIMIT 1`,
    [instanceId, inst.current_step],
  );
  if (!wi) return;

  if (wi.status === "cancelled") {
    await query(
      `UPDATE runbook_instances
          SET status = 'cancelled', completed_at = now(),
              note = CASE WHEN note = '' THEN $2 ELSE note || E'\n' || $2 END
        WHERE id = $1 AND status NOT IN ('done','cancelled')`,
      [instanceId, `Cancelled: step ${inst.current_step} work item "${wi.title}" was cancelled.`],
    );
    return;
  }

  const cleared = wi.status === "done" && (!wi.requires_approval || wi.approval_status === "approved");
  if (!cleared) {
    // Not done yet — just keep the instance's waiting status honest.
    const waiting: RunbookInstanceStatus =
      wi.status === "approval_needed" ||
      wi.approval_status === "requested" ||
      (wi.status === "done" && wi.requires_approval)
        ? "waiting_approval"
        : wi.assignee_kind === "human"
          ? "waiting_human"
          : "running";
    await query(
      `UPDATE runbook_instances SET status = $2
        WHERE id = $1 AND status NOT IN ('done','cancelled') AND status <> $2`,
      [instanceId, waiting],
    );
    return;
  }

  const rb = await loadRunbookDef(inst.runbook_slug);
  const next = rb?.steps.find((s) => s.stepOrder > inst.current_step);
  if (!rb || !next) {
    await query(
      `UPDATE runbook_instances SET status = 'done', completed_at = now()
        WHERE id = $1 AND status NOT IN ('done','cancelled')`,
      [instanceId],
    );
    return;
  }

  // Compare-and-set: whoever wins this update owns spawning the next step.
  const advanced = await queryOne<{ id: string }>(
    `UPDATE runbook_instances SET current_step = $3
      WHERE id = $1 AND current_step = $2 AND status NOT IN ('done','cancelled')
      RETURNING id`,
    [instanceId, inst.current_step, next.stepOrder],
  );
  if (!advanced) return;

  const t = await loadTarget(inst.lead_id, inst.project_id);
  if (!t) return; // target gone — the instance cascades away with it
  await spawnStep(instanceId, rb, next, t);
}

/** The completion-path hook: no-op unless the work item belongs to a runbook
 *  instance. Never throws — advancing is bookkeeping around a status change
 *  that already committed. */
export async function maybeAdvanceRunbook(workItemId: string): Promise<void> {
  try {
    const row = await queryOne<{ runbook_instance_id: string | null }>(
      `SELECT runbook_instance_id FROM work_items WHERE id = $1`,
      [workItemId],
    );
    if (!row?.runbook_instance_id) return;
    await advanceRunbookInstance(row.runbook_instance_id);
  } catch (err) {
    console.error("[runbook-engine] advance failed", err);
  }
}

/** Owner-only (via lib/actions/engine.ts): cancel an instance and close out
 *  its open step work items so nothing orphaned stays in the queue. */
export async function cancelRunbookInstance(instanceId: string, note = "Cancelled by owner."): Promise<void> {
  const inst = await queryOne<{ id: string }>(
    `UPDATE runbook_instances
        SET status = 'cancelled', completed_at = now(),
            note = CASE WHEN note = '' THEN $2 ELSE note || E'\n' || $2 END
      WHERE id = $1 AND status NOT IN ('done','cancelled')
      RETURNING id`,
    [instanceId, note],
  );
  if (!inst) return;
  await query(
    `UPDATE work_items
        SET status = 'cancelled', blocked_reason = COALESCE(blocked_reason, $2)
      WHERE runbook_instance_id = $1 AND status NOT IN ('done','cancelled')`,
    [instanceId, note],
  );
}

// ─── Read views (/engine block + lead/project badges) ────────────────────────

export interface RunbookInstanceView {
  id: string;
  runbookSlug: string;
  runbookTitle: string;
  status: RunbookInstanceStatus;
  currentStep: number;
  stepCount: number;
  currentStepTitle: string | null;
  startedAt: string;
  startedBy: string;
  targetKind: "lead" | "project" | null;
  targetSlug: string | null;
  targetName: string | null;
}

interface InstanceViewRow {
  id: string;
  runbook_slug: string;
  runbook_title: string;
  status: RunbookInstanceStatus;
  current_step: number;
  step_count: number;
  current_step_title: string | null;
  started_at: string;
  started_by: string;
  lead_slug: string | null;
  lead_name: string | null;
  project_slug: string | null;
  project_name: string | null;
}

const INSTANCE_VIEW_SQL = `
  SELECT i.id, i.runbook_slug, COALESCE(r.title, i.runbook_slug) AS runbook_title,
         i.status, i.current_step, i.started_at::text AS started_at, i.started_by,
         COALESCE((SELECT count(*)::int FROM runbook_steps s WHERE s.runbook_id = i.runbook_id), 0) AS step_count,
         (SELECT s.title FROM runbook_steps s
           WHERE s.runbook_id = i.runbook_id AND s.step_order = i.current_step) AS current_step_title,
         l.slug AS lead_slug, l.name AS lead_name,
         p.slug AS project_slug, p.name AS project_name
    FROM runbook_instances i
    LEFT JOIN runbooks r ON r.id = i.runbook_id
    LEFT JOIN leads l    ON l.id = i.lead_id
    LEFT JOIN projects p ON p.id = i.project_id`;

function rowToInstanceView(r: InstanceViewRow): RunbookInstanceView {
  return {
    id: r.id,
    runbookSlug: r.runbook_slug,
    runbookTitle: r.runbook_title,
    status: r.status,
    currentStep: r.current_step,
    stepCount: r.step_count,
    currentStepTitle: r.current_step_title,
    startedAt: r.started_at,
    startedBy: r.started_by,
    targetKind: r.lead_slug ? "lead" : r.project_slug ? "project" : null,
    targetSlug: r.lead_slug ?? r.project_slug,
    targetName: r.lead_name ?? r.project_name,
  };
}

/** All non-terminal instances, newest first (the /engine "Active runbooks" block). */
export async function getActiveRunbookInstances(): Promise<RunbookInstanceView[]> {
  const { rows } = await query<InstanceViewRow>(
    `${INSTANCE_VIEW_SQL}
      WHERE i.status NOT IN ('done','cancelled')
      ORDER BY i.started_at DESC`,
  );
  return rows.map(rowToInstanceView);
}

/** Non-terminal instances on one lead/project (the detail-page badge). */
export async function getActiveRunbookInstancesFor(
  kind: "lead" | "project",
  slug: string,
): Promise<RunbookInstanceView[]> {
  const { rows } = await query<InstanceViewRow>(
    `${INSTANCE_VIEW_SQL}
      WHERE i.status NOT IN ('done','cancelled') AND ${kind === "lead" ? "l.slug" : "p.slug"} = $1
      ORDER BY i.started_at DESC`,
    [slug],
  );
  return rows.map(rowToInstanceView);
}
