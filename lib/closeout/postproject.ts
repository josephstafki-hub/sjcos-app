// Post-project follow-through (A17 / W12) under policy postproject.followthrough.
//
//   warranty_docs  — from the CONFIGURED warranty terms (company.warranty_terms)
//                    plus the MN statutory tiers for residential work; never
//                    invented coverage. Missing terms → 'not_configured'.
//   review_request — only when company.google_review_url is set.
//   checkin        — at config.checkin_days (default 30) after sign-off.
//   learning       — closeout actuals to WS-estimating (recordCloseoutActuals).
//
// Each send is an intent (send_email) for the dispatcher when the policy is
// active, or a decision when it is not. A check-in reply with a problem
// becomes a warranty claim + owner escalation.

import { canonicalJson } from "../commands/core.ts";
import type { Run } from "../commands/core.ts";
import { stageDecision } from "../commands/decisions.ts";
import { enqueueIntent } from "../commands/intents.ts";
import { activePolicy, policyRef } from "../commands/policies.ts";
import type { Principal } from "../commands/principal.ts";
import type { CloseoutActuals, CloseoutHooks } from "./hooks.ts";
import { heldOutEvaluation } from "../estimating/rules.ts";

export const POSTPROJECT_POLICY_KEY = "postproject.followthrough";

export type PostKind = "warranty_docs" | "review_request" | "checkin" | "learning";

export interface PostProjectAction {
  id: string;
  project_id: string;
  kind: PostKind;
  scheduled_for: string;
  intent_id: string | null;
  decision_id: string | null;
  state: "scheduled" | "queued" | "pending_decision" | "done" | "skipped" | "not_configured" | "issue_reported";
  note: string;
  detail: Record<string, unknown>;
}

const COLS = `id, project_id, kind, scheduled_for::text AS scheduled_for, intent_id, decision_id, state, note, detail`;

async function setting(run: Run, key: string): Promise<string> {
  const [row] = await run<{ value: string }>(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return (row?.value ?? "").trim();
}

/** Days after sign-off for one step. The seeded policy lists
 *  `steps: [{ key, daysAfter }]` (warranty_care 1, review_request 7, checkin
 *  90); an older flat key is still read; else the default. */
function stepDays(config: Record<string, unknown> | undefined, stepKey: string, flatKey: string, fallback: number): number {
  const steps = Array.isArray(config?.steps) ? (config.steps as { key?: unknown; daysAfter?: unknown }[]) : [];
  const step = steps.find((x) => x?.key === stepKey);
  const n = Number(step?.daysAfter ?? config?.[flatKey]);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

/** Schedule the four actions (idempotent: UNIQUE(project, kind)). */
export async function schedulePostProjectActions(run: Run, projectId: string): Promise<PostProjectAction[]> {
  const policy = await activePolicy(run, POSTPROJECT_POLICY_KEY);
  const rows: PostProjectAction[] = [];
  const plan: { kind: PostKind; days: number }[] = [
    { kind: "warranty_docs", days: stepDays(policy?.config, "warranty_care", "warranty_delay_days", 0) },
    { kind: "review_request", days: stepDays(policy?.config, "review_request", "review_delay_days", 0) },
    { kind: "checkin", days: stepDays(policy?.config, "checkin", "checkin_days", 30) },
    { kind: "learning", days: 0 },
  ];
  for (const p of plan) {
    const [row] = await run<PostProjectAction>(
      `INSERT INTO post_project_actions (project_id, kind, scheduled_for)
       VALUES ($1, $2, now() + make_interval(days => $3::int))
       ON CONFLICT (project_id, kind) DO UPDATE SET kind = EXCLUDED.kind RETURNING ${COLS}`,
      [projectId, p.kind, p.days],
    );
    rows.push(row);
  }
  return rows;
}

async function clientEmailFor(run: Run, projectId: string): Promise<{ email: string | null; first: string; projectName: string; slug: string }> {
  const [p] = await run<{ email: string | null; client_name: string; name: string; slug: string }>(
    `SELECT COALESCE(NULLIF((SELECT u.email FROM users u WHERE u.role = 'client' AND u.active AND u.link_slug = p.slug AND u.email NOT LIKE '%@client-portal.invalid' LIMIT 1), ''), NULLIF(p.client_email, '')) AS email,
            p.client_name, p.name, p.slug FROM projects p WHERE p.id = $1`,
    [projectId],
  );
  return { email: p?.email ?? null, first: (p?.client_name ?? "").split(/\s+/)[0] || "there", projectName: p?.name ?? "your project", slug: p?.slug ?? "" };
}

/** The warranty/care text from configured terms only. Null when nothing is configured. */
export async function warrantyDocText(run: Run, projectId: string, mnTiers: { label: string; detail: string }[]): Promise<string | null> {
  const terms = await setting(run, "company.warranty_terms");
  const company = (await setting(run, "company.name")) || "SJ Carpentry LLC";
  // The Minnesota statutory warranty is a home-improvement warranty: not on a commercial job.
  const [p] = await run<{ commercial: boolean }>(`SELECT commercial FROM projects WHERE id = $1`, [projectId]);
  const tiers = p?.commercial ? [] : mnTiers;
  if (!terms && !tiers.length) return null;
  const lines = [`Warranty coverage for your project with ${company}:`, ""];
  if (terms) lines.push(terms, "");
  if (tiers.length) {
    lines.push("Minnesota statutory home-improvement warranty (Minn. Stat. §327A.02):");
    for (const t of tiers) lines.push(`• ${t.label} — ${t.detail}`);
  }
  lines.push("", "Keep this for your records. Reply to this email to report anything covered.");
  return lines.join("\n");
}

export interface RunDueOptions {
  /** MN statutory tiers (lib/warranty-mn.ts MN_WARRANTY_TIERS) — passed in so this module stays pure. */
  mnTiers: { label: string; detail: string }[];
  now?: Date;
}

/** Process due actions: enqueue intents under the policy, or stage decisions
 *  when the policy is inactive. Replay-safe by operation key / dedupe key. */
export async function runDuePostProjectActions(run: Run, principal: Principal, opts: RunDueOptions, hooks: CloseoutHooks): Promise<PostProjectAction[]> {
  const now = opts.now ?? new Date();
  const policy = await activePolicy(run, POSTPROJECT_POLICY_KEY);
  // Compare on the database clock (µs) unless the caller pinned `now`: a JS
  // millisecond timestamp can fall just short of a row scheduled in the same ms.
  const due = await run<PostProjectAction>(`SELECT ${COLS} FROM post_project_actions WHERE state = 'scheduled' AND scheduled_for <= COALESCE($1::timestamptz, now()) ORDER BY scheduled_for FOR UPDATE SKIP LOCKED`, [opts.now ? now.toISOString() : null]);
  const out: PostProjectAction[] = [];
  for (const a of due) {
    const c = await clientEmailFor(run, a.project_id);
    let subject = "";
    let body: string | null = null;
    if (a.kind === "warranty_docs") {
      body = await warrantyDocText(run, a.project_id, opts.mnTiers);
      subject = `Warranty and care information — ${c.projectName}`;
      if (!body) {
        out.push(await setState(run, a.id, "not_configured", "company.warranty_terms is not set; nothing was sent (no invented coverage)."));
        continue;
      }
    } else if (a.kind === "review_request") {
      const url = await setting(run, "company.google_review_url");
      if (!url) {
        out.push(await setState(run, a.id, "not_configured", "company.google_review_url is not set; no review request."));
        continue;
      }
      subject = `A quick favor — how did we do on ${c.projectName}?`;
      body = `Hi ${c.first},\n\nIt was a pleasure working on ${c.projectName}. If you were happy with the work, a short Google review helps other homeowners find us:\n${url}\n\nThank you.`;
    } else if (a.kind === "checkin") {
      subject = `Checking in on ${c.projectName}`;
      body = `Hi ${c.first},\n\nIt's been a few weeks since we wrapped up ${c.projectName}. How is everything holding up? If anything needs a look, just reply here and I'll take care of it.`;
    } else if (a.kind === "learning") {
      out.push(await learningStep(run, a));
      continue;
    }
    if (!c.email) {
      out.push(await setState(run, a.id, "skipped", "no client email on file"));
      continue;
    }
    if (!policy) {
      const staged = await stageDecision(run, {
        kind: "postproject",
        action: `send_${a.kind}`,
        title: `${subject} → ${c.email}`,
        summary: { recipients: [{ name: c.first, address: c.email }], effect: body!.slice(0, 400) },
        targetKind: "post_project_action",
        targetId: a.id,
        recipient: c.email,
        content: { to: c.email, subject, body },
        projectId: a.project_id,
        dedupeKey: `postproject:${a.id}`,
        requestedBy: principal,
      });
      const [row] = await run<PostProjectAction>(`UPDATE post_project_actions SET state = 'pending_decision', decision_id = $2 WHERE id = $1 RETURNING ${COLS}`, [a.id, staged.decision.id]);
      out.push(row);
      continue;
    }
    const { intent } = await enqueueIntent(run, {
      operationKey: `postproject:${a.id}:${a.kind}`,
      kind: "send_email",
      targetKind: "post_project_action",
      targetId: a.id,
      recipient: c.email,
      projectId: a.project_id,
      payload: { to: c.email, subject, bodyText: body, kind: a.kind },
      policyRef: policyRef(policy),
      principal,
    });
    const [row] = await run<PostProjectAction>(`UPDATE post_project_actions SET state = 'queued', intent_id = $2 WHERE id = $1 RETURNING ${COLS}`, [a.id, intent.id]);
    out.push(row);
  }
  void hooks;
  return out;
}

/** The learning step. Per-scope actuals (unit, quantity, cost; recorded with
 *  recordCloseoutActuals, which also feeds the cost book) are compared with
 *  the contract estimate's internal costs scope by scope (heldOutEvaluation)
 *  and the report kept on the step. With none recorded yet it waits a week at
 *  a time, eight times, then says plainly that this job taught nothing. */
async function learningStep(run: Run, a: PostProjectAction): Promise<PostProjectAction> {
  const [act] = await run<{ actuals: CloseoutActuals }>(`SELECT actuals FROM closeout_actuals WHERE project_id = $1 ORDER BY revision DESC LIMIT 1`, [a.project_id]);
  const lines = (Array.isArray(act?.actuals?.lines) ? act.actuals.lines : []) as { scope_key?: string; actual_cost_cents?: number | null }[];
  if (!lines.some((l) => l?.scope_key)) {
    const waits = Number(a.detail?.waits ?? 0);
    if (waits >= 8) return setState(run, a.id, "not_configured", "No per-scope actuals were recorded for this job (unit, quantity and cost per scope), so the cost book learned nothing from it.");
    const [row] = await run<PostProjectAction>(
      `UPDATE post_project_actions SET scheduled_for = now() + interval '7 days', note = $2, detail = detail || $3::jsonb WHERE id = $1 RETURNING ${COLS}`,
      [a.id, "Waiting for per-scope actuals (record_actuals) before the estimate-vs-actual check.", JSON.stringify({ waits: waits + 1 })],
    );
    return row;
  }
  const actual = new Map<string, number | null>();
  for (const l of lines) {
    if (!l?.scope_key) continue;
    const prev = actual.has(l.scope_key) ? actual.get(l.scope_key)! : 0;
    actual.set(l.scope_key, prev == null || l.actual_cost_cents == null ? null : prev + Number(l.actual_cost_cents));
  }
  const estimated = await run<{ scope_key: string; cents: string | null }>(
    `SELECT l.scope_item_key AS scope_key,
            CASE WHEN bool_and(l.internal_cost_cents IS NOT NULL) THEN sum(l.internal_cost_cents)::text END AS cents
       FROM estimate_lines l
      WHERE l.estimate_id = project_contract_estimate_id($1) AND l.superseded_by IS NULL AND l.scope_item_key IS NOT NULL
      GROUP BY l.scope_item_key`,
    [a.project_id],
  );
  const report = heldOutEvaluation(
    estimated.map((e) => ({ scope_key: e.scope_key, cents: e.cents == null ? null : Number(e.cents) })),
    [...actual].map(([scope_key, cents]) => ({ scope_key, cents })),
  );
  const note =
    report.mean_abs_error_pct == null
      ? `Estimate vs actual: nothing comparable (${report.note}).`
      : `Estimate vs actual over ${report.compared} scope(s): off by ${report.mean_abs_error_pct}% on average, ${report.bias_pct! >= 0 ? "over" : "under"} by ${Math.abs(report.bias_pct!)}% overall. ${report.note}.`;
  const [row] = await run<PostProjectAction>(
    `UPDATE post_project_actions SET state = 'done', note = $2, detail = detail || $3::jsonb WHERE id = $1 RETURNING ${COLS}`,
    [a.id, note, JSON.stringify({ held_out: report })],
  );
  return row;
}

async function setState(run: Run, id: string, state: PostProjectAction["state"], note: string): Promise<PostProjectAction> {
  const [row] = await run<PostProjectAction>(`UPDATE post_project_actions SET state = $2, note = $3 WHERE id = $1 RETURNING ${COLS}`, [id, state, note]);
  return row;
}

/** A reply to the check-in. A reported problem → warranty claim + escalation. */
export async function checkInReplyReceived(
  run: Run,
  input: { projectId: string; body: string; hasIssue: boolean; source?: string },
  hooks: CloseoutHooks,
): Promise<{ claimId: string | null }> {
  const [p] = await run<{ name: string; client_name: string; slug: string }>(`SELECT name, client_name, slug FROM projects WHERE id = $1`, [input.projectId]);
  if (!input.hasIssue) {
    await run(`UPDATE post_project_actions SET state = 'done', note = 'client replied: all good' WHERE project_id = $1 AND kind = 'checkin' AND state IN ('queued','done')`, [input.projectId]);
    return { claimId: null };
  }
  const [claim] = await run<{ id: string }>(
    `INSERT INTO warranty_claims (project, client, issue, project_id, source, ack_deadline_at, resolve_deadline_at, dot)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + 5, CURRENT_DATE + 30, 'flag') RETURNING id`,
    [p?.name ?? "", p?.client_name ?? "", input.body.slice(0, 500), input.projectId, input.source ?? "checkin_reply"],
  );
  await run(`UPDATE post_project_actions SET state = 'issue_reported', note = $2, detail = detail || $3::jsonb WHERE project_id = $1 AND kind = 'checkin'`, [
    input.projectId,
    "client reported a problem at check-in",
    JSON.stringify({ claimId: claim.id }),
  ]);
  await hooks.notifyOwner({ kind: "urgent_item", title: `Warranty issue reported · ${p?.name ?? "project"}`, body: input.body.slice(0, 200), href: "/warranty" });
  return { claimId: claim.id };
}

/** Record closeout actuals for WS-estimating. Same numbers → same revision
 *  (no re-ingest); changed numbers → next revision, hook once per revision. */
export async function recordCloseoutActuals(run: Run, input: { projectId: string; actuals: CloseoutActuals; reason?: string }, hooks: CloseoutHooks): Promise<{ revision: number; created: boolean }> {
  const [last] = await run<{ revision: number; actuals: CloseoutActuals }>(`SELECT revision, actuals FROM closeout_actuals WHERE project_id = $1 ORDER BY revision DESC LIMIT 1`, [input.projectId]);
  if (last && canonicalJson(last.actuals) === canonicalJson(input.actuals)) return { revision: last.revision, created: false };
  const [row] = await run<{ revision: number }>(
    `INSERT INTO closeout_actuals (project_id, revision, actuals, reason) VALUES ($1, COALESCE($2, 0) + 1, $3::jsonb, $4) RETURNING revision`,
    [input.projectId, last?.revision ?? 0, JSON.stringify(input.actuals), input.reason ?? (last ? "late adjustment" : "closeout")],
  );
  await hooks.ingestCloseoutActuals(run, { projectId: input.projectId, revision: row.revision, actuals: input.actuals, supersedesRevision: last?.revision ?? null });
  await run(`UPDATE closeout_actuals SET ingested_at = now() WHERE project_id = $1 AND revision = $2`, [input.projectId, row.revision]);
  return { revision: row.revision, created: true };
}

export async function listPostProjectActions(run: Run, projectId: string): Promise<PostProjectAction[]> {
  return run<PostProjectAction>(`SELECT ${COLS} FROM post_project_actions WHERE project_id = $1 ORDER BY scheduled_for`, [projectId]);
}
