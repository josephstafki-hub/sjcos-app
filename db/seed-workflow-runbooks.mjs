#!/usr/bin/env node
// Seed the W01–W12 workflow runbook DEFINITIONS (A24). Idempotent.
//
//   node db/seed-workflow-runbooks.mjs            # DATABASE_URL env or .env.local
//   node db/seed-workflow-runbooks.mjs --dry-run  # print what would be written
//
// Writes runbooks (slug workflow-wNN-…, active = false, review_status
// 'proposed', workflow_stage 'WNN') + runbook_steps (assigned_to agent|human,
// requires_human_approval, expected_output, required_evidence) and pins a
// runbook_definition_versions snapshot via WS-recovery's pure
// lib/completion/runbook-core.ts, plus the `workflow-operating-agent` skill
// (proposed). Nothing is activated: Joe approves in /engine. The step ENGINE
// is WS-recovery's (lib/runbook-engine.ts); this file only supplies the
// definitions. Re-running never duplicates a step and never overwrites a step
// Joe edited (ON CONFLICT DO NOTHING per (runbook_id, step_order)).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerOperatingAgentSkill, OPERATING_AGENT_SKILL_SLUG } from "../lib/agent-runtime/skill-versions.ts";
import { snapshotDefinition, pinDefinitionVersion } from "../lib/completion/runbook-core.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// evidence: 'record' = a business record changed; 'draft' = a staged draft/card;
// 'manual' = a human confirmed; 'business_response' = the counterparty replied;
// 'provider_accepted' / 'delivered' = a send left the box / arrived.
const A = "agent";
const H = "human";
export const WORKFLOW_RUNBOOKS = [
  {
    slug: "workflow-w01-lead-qualification",
    stage: "W01",
    title: "W01 Lead qualification and rough estimate",
    description: "Capture the lead, qualify it, gather facts under routine policy, prepare a supported rough estimate for Joe's price/scope approval.",
    steps: [
      [A, "Capture the lead and existing correspondence; check service area, job type, scope, budget fit, timeline", "Lead record + knowledge captures with sources", false, "record"],
      [A, "Request missing facts (photos, approximate measurements, goals) under the routine communication policy; stop when they arrive", "Staged client message draft (no send) or recorded facts", false, "draft"],
      [A, "Prepare the supported rough estimate on the lead page with explicit assumptions", "lead_estimates draft with line items and assumptions", false, "record"],
      [H, "Joe approves the exact rough-estimate price/scope before it is sent", "Owner decision on the exact revision", true, "manual"],
      [A, "On client willingness to proceed, prepare the pre-construction agreement and its invoice under the established terms for release", "Document draft + invoice draft staged for release approval", false, "draft"],
    ],
  },
  {
    slug: "workflow-w02-signature-preparation",
    stage: "W02",
    title: "W02 Signature starts preparation",
    description: "A verified pre-construction signature starts scope breakdown, site-visit planning and design preparation without waiting for payment or a site visit.",
    steps: [
      [A, "Verify the signature event is a SIGNED pre-construction agreement (not declined/void/duplicate) and open exactly one project workflow", "signature_requests row status signed; single project; duplicate event resumes", false, "record"],
      [A, "Prepare the preliminary scope register: work packages, trades, potential subs, suppliers, required finishes, dependencies, exclusions; mark site-dependent assumptions unverified", "scope register revision 1 with unverified flags", false, "record"],
      [A, "Prepare the site-visit plan specific to the scope and unanswered questions", "site-visit plan revision 1", false, "record"],
      [A, "Prepare the design brief and choose the mood-board / selection / direct-product path per room", "design path decision per room with reasons", false, "record"],
      [A, "Create the working formal-estimate structure with known costs and explicit internal gaps (never zero for unknown)", "formal estimate (kind formal) with gap entries", false, "record"],
      [H, "Joe reviews the scope-allocation summary (he may retain work and supply dedicated pricing)", "Owner allocation review recorded (NOT a release)", true, "manual"],
    ],
  },
  {
    slug: "workflow-w03-scope-allocation-site-visit",
    stage: "W03",
    title: "W03 Scope allocation and the site visit",
    description: "Joe's allocation review, the tailored site-visit checklist, and source-linked updates from his notes and photos.",
    steps: [
      [A, "Bring Joe a concise scope-allocation review before any bid request; record retained work and whether entered prices are cost or selling price", "Allocation review card; scope items with responsibility and price basis", false, "draft"],
      [H, "Joe confirms allocations and dedicated pricing (paid site visit stays gated on the pre-construction payment)", "Owner confirmation", true, "manual"],
      [A, "After the visit, extract source-linked facts, measurements, preferences, decisions and issues from Joe's notes/photos; update scopes, plans, takeoffs, selections, estimate inputs; show a change summary", "site-visit findings with sources; updated records; change summary", false, "record"],
      [A, "Ask targeted clarifications for conflicting, illegible or ambiguous findings; never mark checklist items complete without evidence", "Specific questions staged for Joe (one item, not a repeated form)", false, "draft"],
    ],
  },
  {
    slug: "workflow-w04-design-paths",
    stage: "W04",
    title: "W04 Design direction, selections and feedback",
    description: "Mood boards for poorly defined results, selections for undecided choices, exact client products straight into the estimate; feedback applied with revision history.",
    steps: [
      [A, "Evaluate each room/scope: prepare a mood board (unclear result), selections (direction clear, products undecided) or add the client's exact product to the estimate", "Board / selection package / estimate lines with source links", false, "record"],
      [H, "Joe approves the board or selection package before client presentation (exact revision)", "Owner release decision on the exact revision", true, "manual"],
      [A, "Watch client/owner feedback; apply requested adjustments as a new revision; do not treat positive comments as package approval; clarify vague feedback", "Revised artifact + revision history; clarification question if needed", false, "record"],
      [A, "On explicit client direction approval prepare derived selections; on a client choice incorporate it into the estimate; keep partial choices independent", "Selections/estimate updated; unselected options remain open", false, "record"],
    ],
  },
  {
    slug: "workflow-w05-price-discovery-suppliers",
    stage: "W05",
    title: "W05 Price discovery and supplier knowledge",
    description: "Exact product identification, online and historical pricing evidence, category-based supplier candidates, staged supplier pricing requests.",
    steps: [
      [A, "Identify the exact model/variant/finish/unit/quantity; look online and in permissioned history; record source, date, currency, unit basis, tax/freight coverage", "price observations with sources; provisional cost in the draft estimate", false, "record"],
      [A, "Identify candidate suppliers by category and history (three evidence levels kept separate; never invent a discount); resolve the actual contact from trusted records", "supplier capability notes with evidence level", false, "record"],
      [A, "Stage the supplier pricing request (exact products, quantities or explicit gaps, needed dates, documents) with an approval card", "supplier pricing request revision + release decision staged", false, "draft"],
      [H, "Joe approves the exact request before it is sent (overrides broad routine-request policy)", "Owner release decision", true, "manual"],
    ],
  },
  {
    slug: "workflow-w06-package-review-release",
    stage: "W06",
    title: "W06 Review and release of scope/bid packages",
    description: "Every external package needs release approval for its exact revision; accurate review cards; one notification per revision; immutable sent artifacts.",
    steps: [
      [A, "Prepare the bid package from current scope, drawings, takeoffs and selections", "bid package draft with attachment revision list", false, "record"],
      [A, "Stage the approval card: verified recipients and roles, included work and exclusions (incl. Joe's work), quantities/specs, assumptions and gaps, changes since last review, exact effect of approving", "decision of kind package_release bound to the exact revision and recipients", false, "draft"],
      [H, "Joe approves and sends, requests changes or holds (individual release; no project-wide batch gate)", "Owner decision consumed by exactly one send", true, "manual"],
      [A, "After the send: record provider outcome; a revision needs a fresh card; factual status chasing inside the approved request follows routine policy only", "action intent outcome recorded; follow-ups under policy", false, "provider_accepted"],
    ],
  },
  {
    slug: "workflow-w07-estimate-assembly",
    stage: "W07",
    title: "W07 Continuous formal-estimate assembly and client pricing",
    description: "Automatic source-linked estimate updates from products, choices, approved bids, quotes and owner prices; committed price versus allowance.",
    steps: [
      [A, "On each event (client product, selection choice, approved sub bid, noncompetitive quote, owner price, quantity change) update the affected source-linked estimate items without double counting or double markup", "estimate lines with source refs; both cost and selling price stored", false, "record"],
      [A, "On competing quotes prepare an equivalent-scope comparison and stage the owner choice; never sum or auto-select", "comparison + decision staged", false, "draft"],
      [A, "Prepare Joe's internal review highlighting provisional online prices, missing quotes, assumptions and margin exposure; mark allowances explicitly", "review card with readiness flags", false, "draft"],
      [H, "Joe approves sending the offer (committed price or labelled allowance); any revised offer needs fresh approval", "Owner decision on the exact offered revision; offered snapshot frozen", true, "manual"],
    ],
  },
  {
    slug: "workflow-w08-acceptance-agreement-invoice",
    stage: "W08",
    title: "W08 Acceptance, agreement and initial invoice",
    description: "Owner approval to send, client acceptance of the exact revision, then the automatic construction agreement/SOW and initial invoice under their policy.",
    steps: [
      [A, "Prepare the complete proposal package (estimate, SOW, plans, visuals, preliminary timeline) for Joe's send approval", "proposal package draft + release decision", false, "draft"],
      [H, "Joe approves sending the offer", "Owner release decision", true, "manual"],
      [A, "Record the client's acceptance of that exact offered revision (distinct from Joe's approval); a changed-terms reply is not acceptance", "acceptance evidence linked to the offered revision", false, "business_response"],
      [A, "On valid acceptance issue the construction agreement (established template + accepted SOW) and the initial invoice under the predetermined milestone structure and active policy; stable economic identity, no duplicate retainer", "agreement document + initial invoice issued once (policy auth_ref) or held with the missing-policy reason", false, "record"],
    ],
  },
  {
    slug: "workflow-w09-schedule-buyout-cash",
    stage: "W09",
    title: "W09 Schedule, material buyout and project cash",
    description: "Tentative scheduling and lead-time checks before signature/payment; owner schedule approval; signed + paid gate before dates or orders; cash guard.",
    steps: [
      [A, "Prepare the full construction schedule (trade dependencies, durations, inspections, lead times, delivery, funding) and tentative sub availability without confirming dates or awarding work", "schedule draft marked tentative; sub availability notes", false, "record"],
      [H, "Joe approves the schedule (does not authorize spending)", "Owner schedule decision", true, "manual"],
      [A, "Build the material buyout schedule backward from need-on-site dates; align to expected collections; surface shortfalls early", "buyout plan with order deadlines and funding check", false, "record"],
      [A, "Verify the gates before any commitment: construction agreement signed AND initial payment received AND purchase approval; cash guard against collected funds net of spent/reserved; company cash needs explicit approval", "gate check recorded; commitment staged for the purchase decision or blocked with reason", false, "record"],
      [H, "Joe approves each purchase / company-funding decision", "Owner purchase decision (atomic cash reservation)", true, "manual"],
    ],
  },
  {
    slug: "workflow-w10-field-progress-reports",
    stage: "W10",
    title: "W10 Field progress, reports and schedule changes",
    description: "Sub evidence already received is used; only missing facts are requested; Joe confirms completion before billing; one weekly summary.",
    steps: [
      [A, "On a sub completion report, compile the evidence already supplied; ask precisely and only for what is missing (no repeat photo requests)", "completion evidence package; at most one targeted question", false, "record"],
      [H, "Joe confirms physical completion (the confirmation triggers the milestone invoice under its policy)", "Owner completion confirmation", true, "manual"],
      [A, "Compile the weekly sub report from work done, progress, photos, snags and discoveries; proactive updates count; internal issues stay private until Joe decides", "weekly report draft; client update draft under the weekly policy or held", false, "draft"],
      [A, "Adjust internal tasks inside the approved schedule only with no changed promise, cost increase or funding gap; alert Joe immediately to anything affecting the client or another sub with impacts and proposed revised dates", "schedule adjustment record or owner alert with proposed dates", false, "record"],
    ],
  },
  {
    slug: "workflow-w11-snags-decisions-change-orders",
    stage: "W11",
    title: "W11 Snags, owner decisions and change orders",
    description: "Every snag alerts Joe with facts, impact, recommendation and the continue/pause decision; out-of-scope work becomes a priced change order for approval, signature and payment.",
    steps: [
      [A, "On a reported snag alert Joe immediately with source evidence, affected work, likely cost/schedule/client impact, a recommendation and the specific continue/pause decision; record decision pending and site status separately", "snag alert + decision staged; no pause/continue decided by the agent", false, "draft"],
      [H, "Joe decides whether affected work continues", "Owner decision", true, "manual"],
      [A, "Communicate Joe's instruction (drafted for release where client/sub-facing) and update tasks/schedules", "message drafts + updated tasks", false, "draft"],
      [A, "If scope is outside the contract, draft the priced change order (scope, supported costs, timing, payment requirement); missing prices become research/quote work or a targeted owner assumption, never an invented price", "change order draft with supported costs and gaps", false, "record"],
      [H, "Joe approves the change order before client release; client signature and required payment precede the added work", "Owner CO approval; client signature + payment evidence", true, "manual"],
    ],
  },
  {
    slug: "workflow-w12-closeout-post-project",
    stage: "W12",
    title: "W12 Closeout, post-project and learning",
    description: "Internal punch list, owner-confirmed corrections, client walkthrough and written sign-off; automatic final invoice and follow-through under policy; verified-cost learning.",
    steps: [
      [A, "Prepare Joe's internal inspection and punch list; coordinate sub corrections and collect evidence", "punch list with evidence per item", false, "record"],
      [H, "Joe confirms corrections before the client walkthrough is scheduled", "Owner confirmation", true, "manual"],
      [A, "Track client punch items to resolution and obtain written client sign-off (a photo upload is not acceptance)", "written sign-off evidence recorded", false, "business_response"],
      [A, "On written sign-off issue the final invoice for the verified remaining balance (approved CO balances, payments and credits applied once) under its policy; never a duplicate; conflicts are exceptions", "final invoice issued once (policy auth_ref) or held with reason", false, "record"],
      [A, "Send applicable warranty/care documents, request a review and arrange the check-in under the post-project policy; never invent warranties or marketing enrollment; a returned problem becomes tracked work", "follow-through intents under policy or held", false, "record"],
      [A, "Compare estimated versus verified actual costs/hours; update cost observations under the evidence/unit/outlier/rollback rules (markup/profit targets still need approval)", "cost observations with history", false, "record"],
    ],
  },
];

export async function seedWorkflowRunbooks({ run, tx, dryRun = false, by = "seed:workflow-runbooks" }) {
  const report = { runbooks: 0, stepsInserted: 0, stepsExisting: 0, pinned: 0, skill: null };
  if (dryRun) {
    for (const rb of WORKFLOW_RUNBOOKS) console.log(`${rb.slug} (${rb.stage}) — ${rb.steps.length} steps`);
    return report;
  }
  for (const rb of WORKFLOW_RUNBOOKS) {
    await tx(async (r) => {
      const [row] = await r(
        `INSERT INTO runbooks (slug, title, description, active, review_status, workflow_stage)
         VALUES ($1, $2, $3, false, 'proposed', $4)
         ON CONFLICT (slug) DO UPDATE SET workflow_stage = COALESCE(runbooks.workflow_stage, EXCLUDED.workflow_stage), updated_at = now()
         RETURNING id`,
        [rb.slug, rb.title, rb.description, rb.stage],
      );
      report.runbooks++;
      let order = 0;
      for (const [assigned, title, expected, approval, evidence] of rb.steps) {
        order++;
        const ins = await r(
          `INSERT INTO runbook_steps (runbook_id, step_order, title, skill_id, skill_slug, expected_output, requires_human_approval, assigned_to, required_evidence)
           VALUES ($1, $2, $3, (SELECT id FROM skills WHERE slug = $4), $4, $5, $6, $7, $8)
           ON CONFLICT (runbook_id, step_order) DO NOTHING RETURNING id`,
          [row.id, order, title, OPERATING_AGENT_SKILL_SLUG, expected, approval, assigned, evidence],
        );
        if (ins.length) report.stepsInserted++;
        else report.stepsExisting++;
      }
      const snap = await snapshotDefinition(r, rb.slug);
      if (snap) {
        await pinDefinitionVersion(r, snap, by);
        report.pinned++;
      }
    });
  }
  report.skill = await tx((r) => registerOperatingAgentSkill(r, by));
  // Link steps to the (now existing) skill row if it was created after them.
  await tx((r) => r(`UPDATE runbook_steps SET skill_id = (SELECT id FROM skills WHERE slug = $1) WHERE skill_slug = $1 AND skill_id IS NULL`, [OPERATING_AGENT_SKILL_SLUG]));
  return report;
}

async function main() {
  const { default: pg } = await import("pg");
  let url = process.env.DATABASE_URL;
  if (!url) {
    const env = readFileSync(path.join(REPO, ".env.local"), "utf8");
    const m = env.match(/^DATABASE_URL=(.+)$/m);
    if (!m) throw new Error("DATABASE_URL not found (env or .env.local)");
    url = m[1].trim().replace(/^["']|["']$/g, "");
  }
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const run = async (sql, params) => (await pool.query(sql, params)).rows;
  const tx = async (fn) => {
    const c = await pool.connect();
    const r = async (sql, params) => (await c.query(sql, params)).rows;
    try {
      await c.query("BEGIN");
      const out = await fn(r);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };
  try {
    const report = await seedWorkflowRunbooks({ run, tx, dryRun: process.argv.includes("--dry-run") });
    console.log(JSON.stringify({ ...report, skill: report.skill ? { slug: report.skill.skill.slug, review_status: report.skill.skill.review_status, version: report.skill.version.version } : null }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
