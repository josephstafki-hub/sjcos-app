import "server-only";

// Lead ingestion + AI scoring. The entry point for inbound leads that arrive
// from OUTSIDE a logged-in session — today the website's lead form (POSTed to
// /api/leads/intake), later anything else. Deliberately NOT tied to a fixed
// question set: it takes whatever fields the source provides, stores them as
// flexible intake rows, and scores the lead on the full picture.
//
// Server-only (imports lib/db → pg). Never import a value from here into a
// client component.

import { query, queryOne } from "./db";
import { ai } from "./ai";
import { AI_NAME } from "./ai-name";
import { logLeadActivity } from "./lead-activity";
import { emit } from "./notify";
import { openEntityRoom } from "./rooms";
import { startRunbook } from "./runbook-engine";

/** A flexible inbound lead. `name` is the only hard requirement; every other
 *  field is optional, and `extra` carries any additional key/value pairs the
 *  source sends (form questions, UTM tags, etc.) without a schema change. */
export interface InboundLead {
  name: string;
  email?: string | null;
  phone?: string | null;
  /** The project description / what they want done. */
  project?: string | null;
  budget?: string | null;
  timeline?: string | null;
  address?: string | null;
  /** Free-form message from the lead. */
  message?: string | null;
  /** Where the lead came from, e.g. "Website form". */
  source?: string | null;
  /** Any other provided fields, label → value. */
  extra?: Record<string, string>;
}

/** Kebab-case a display name into a URL slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "lead"
  );
}

/** A slug not yet taken in the leads table (appends -2, -3, … on collision). */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await queryOne(`SELECT 1 FROM leads WHERE slug = $1`, [slug]);
    if (!hit) return slug;
    slug = `${base}-${i}`;
  }
}

/** Pull a rough whole-dollar number out of a free-form budget string, e.g.
 *  "$60–80k" → 60000, "$22,000" → 22000, "not sure" → null. */
function parseBudget(budget: string | null | undefined): number | null {
  if (!budget) return null;
  const m = budget.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  // "k" or a small bare number (≤ 999) reads as thousands.
  return m[2] || n < 1000 ? Math.round(n * 1000) : Math.round(n);
}

/** The provided fields as ordered {label, value} pairs — the flexible intake
 *  store AND the input the scorer weighs. Blank values are dropped. */
function detailPairs(lead: InboundLead): { label: string; value: string }[] {
  const pairs: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) pairs.push({ label, value: v });
  };
  push("Project", lead.project);
  push("Budget", lead.budget);
  push("Timeline", lead.timeline);
  push("Address", lead.address);
  push("Email", lead.email);
  push("Phone", lead.phone);
  push("Message", lead.message);
  for (const [label, value] of Object.entries(lead.extra ?? {})) {
    push(label.slice(0, 80), value);
  }
  return pairs;
}

/** Score a lead on everything currently on file (columns + intake rows) and
 *  persist the verdict/confidence/rationale to lead_qualification, mirroring
 *  the verdict onto leads.triage_verdict for the list view. Returns the score. */
export async function scoreLead(
  slug: string,
): Promise<{ verdict: "go" | "hold" | "pass"; confidence: number; rationale: string } | null> {
  const lead = await queryOne<{
    id: string;
    name: string;
    scope: string;
    source: string | null;
    estimate_value: number | null;
  }>(
    `SELECT id, name, scope, source, estimate_value FROM leads WHERE slug = $1`,
    [slug],
  );
  if (!lead) return null;

  const { rows: intake } = await query<{ question: string; answer: string }>(
    `SELECT question, answer FROM lead_intake WHERE lead_id = $1 ORDER BY sort_order, id`,
    [lead.id],
  );

  const result = await ai.triage({
    name: lead.name,
    scope: lead.scope,
    estimateValue: lead.estimate_value,
    source: lead.source,
    details: intake.map((i) => ({ label: i.question, value: i.answer })),
  });
  const confidence = result.confidence > 1 ? result.confidence / 100 : result.confidence;

  await query(
    `INSERT INTO lead_qualification (lead_id, verdict, confidence, rationale, created_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (lead_id) DO UPDATE
       SET verdict = EXCLUDED.verdict, confidence = EXCLUDED.confidence,
           rationale = EXCLUDED.rationale, created_at = now()`,
    [lead.id, result.verdict, confidence, result.rationale],
  );
  await query(`UPDATE leads SET triage_verdict = $2 WHERE slug = $1`, [slug, result.verdict]);
  return { verdict: result.verdict, confidence, rationale: result.rationale };
}

/** The persisted AI score for a lead, or null if it hasn't been scored yet. */
export async function getLeadScore(
  slug: string,
): Promise<{ verdict: "go" | "hold" | "pass"; confidence: number; rationale: string } | null> {
  const row = await queryOne<{ verdict: "go" | "hold" | "pass"; confidence: number | null; rationale: string }>(
    `SELECT q.verdict, q.confidence, q.rationale
       FROM lead_qualification q JOIN leads l ON l.id = q.lead_id
      WHERE l.slug = $1`,
    [slug],
  );
  if (!row) return null;
  return { verdict: row.verdict, confidence: row.confidence ?? 0, rationale: row.rationale };
}

/** Create a lead from an external inbound submission, store the provided fields
 *  as flexible intake rows, score it, and notify the owner. Returns the new
 *  lead's slug + score. This is the single funnel every inbound source uses. */
export async function createInboundLead(
  lead: InboundLead,
): Promise<{ slug: string; verdict: "go" | "hold" | "pass" | null }> {
  const name = lead.name.trim().slice(0, 200);
  const scope = (lead.project ?? "").trim().slice(0, 400);
  const source = (lead.source ?? "").trim() || "Website form";
  const email = (lead.email ?? "").trim() || null;
  const phone = (lead.phone ?? "").trim() || null;
  const address = (lead.address ?? "").trim() || null;
  const budgetValue = parseBudget(lead.budget);
  const budgetDisplay = (lead.budget ?? "").trim() || null;

  const slug = await uniqueSlug(name);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO leads
       (slug, name, scope, stage, email, phone, address, scope_city,
        estimate_value, value_display, source, last_contact_at)
     VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7, $8, $9, $10, now())
     RETURNING id`,
    [slug, name, scope, email, phone, address, address, budgetValue, budgetDisplay, source],
  );
  const leadId = rows[0].id;

  // Store every provided field as a flexible intake row (question = label).
  const pairs = detailPairs(lead);
  for (let i = 0; i < pairs.length; i++) {
    await query(
      `INSERT INTO lead_intake (lead_id, sort_order, question, answer)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lead_id, question) DO UPDATE SET answer = EXCLUDED.answer`,
      [leadId, i + 1, pairs[i].label, pairs[i].value],
    );
  }

  await logLeadActivity(slug, "created", `Lead received · ${source}`);

  // Auto-create the lead's chat room (P1-D2) — same as the manual form, so the
  // highest-volume creation path (inbound) gets a room too. Best-effort.
  try {
    await openEntityRoom("lead", slug, name);
  } catch {
    /* room bookkeeping must never block ingestion */
  }

  // Score on the full inbound (best-effort — never block ingestion on the model).
  let verdict: "go" | "hold" | "pass" | null = null;
  try {
    const score = await scoreLead(slug);
    verdict = score?.verdict ?? null;
    if (score) {
      await logLeadActivity(slug, "note", `Scored ${score.verdict.toUpperCase()} — ${score.rationale}`, AI_NAME);
    }
  } catch {
    /* leave unscored; the owner can re-score from the detail page */
  }

  await emit({
    kind: "job",
    tag: "Intake",
    accent: verdict === "go" ? "money" : "accent",
    icon: "site",
    flagged: verdict === "go",
    title: `New lead · ${name}${verdict ? ` · ${verdict.toUpperCase()}` : ""}`,
    subline: scope || source,
    href: `/leads/${slug}`,
  });

  // W6: auto-start the intake runbook — spawns the Gate-1 triage work item and
  // pings the agent. Best-effort; the duplicate guard makes a re-run refuse.
  try {
    await startRunbook("lead-intake-to-qualified-or-declined", { leadId }, "auto:new-lead");
  } catch {
    /* runbook auto-start must never block ingestion */
  }

  return { slug, verdict };
}
