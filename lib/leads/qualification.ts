// Qualification checklist (A11 / W01): service area, job type, scope,
// budget fit, timeline, goals (+ photos, measurements, address as estimate
// inputs). Facts live in lead_facts; this module derives them from the
// existing intake answers and lead fields, then reads the budget floor from
// the 'lead-triage-under-20k' skill text when that skill exists. Pure `run`.

import type { Run } from "../commands/core.ts";

export const FACT_KEYS = ["service_area", "job_type", "scope", "budget_fit", "timeline", "goals", "photos", "measurements", "address"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export interface LeadFact {
  key: FactKey;
  value: unknown;
  status: "known" | "unknown" | "conflicting";
  source_ref: string;
  asked_at: string | null;
  answered_at: string | null;
}

export interface Checklist {
  leadId: string;
  facts: Record<FactKey, LeadFact>;
  missing: FactKey[];
  budgetFloorCents: number | null;
  budgetFloorSource: string | null;
  verdict: "go" | "hold" | "pass" | "incomplete";
  reasons: string[];
}

/** Budget floor from the approved skill text, e.g. "under $20k" → 2_000_000. */
export async function budgetFloorFromSkill(run: Run): Promise<{ cents: number | null; source: string | null }> {
  const [row] = await run<{ slug: string; description: string; when_to_use: string; body: string | null }>(
    `SELECT s.slug, s.description, s.when_to_use,
            (SELECT v.body_markdown FROM skill_versions v WHERE v.id = s.current_version_id) AS body
       FROM skills s WHERE s.slug = 'lead-triage-under-20k' AND s.active = true LIMIT 1`,
  );
  if (!row) return { cents: null, source: null };
  const text = [row.description, row.when_to_use, row.body ?? ""].join("\n");
  const m = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\s*(k)?\b/i.exec(text);
  if (!m) return { cents: null, source: `skill:${row.slug}` };
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return { cents: Math.round(n * 100), source: `skill:${row.slug}` };
}

const MEASURE_RE = /\b\d+(?:\.\d+)?\s*(?:'|′|ft\b|feet\b|"|″|inch(?:es)?\b|sq\.?\s*ft\b|sqft\b|sf\b|lf\b|meters?\b)|\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\b/i;

/** The LOW end of whatever the client said ("$40-50k", "40k to 50k", "$40,000")
 *  — a range's "k" applies to both ends, and the floor check is conservative. */
export function parseBudgetCents(text: string): number | null {
  const tokens = [...text.matchAll(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?(?![\w.])/gi)].map((m) => ({ n: Number(m[1].replace(/,/g, "")), k: Boolean(m[2]) }));
  if (!tokens.length) return null;
  const anyK = tokens.some((t) => t.k);
  const values = tokens.map((t) => (t.k || (anyK && t.n < 1000) ? t.n * 1000 : t.n)).filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length) return null;
  const n = Math.min(...values);
  return Math.round(n * 100);
}

/** Derive facts from what the lead already told us (lead row + intake +
 *  files) and merge them into lead_facts without overwriting owner-set rows. */
export async function syncFactsFromIntake(run: Run, leadId: string): Promise<void> {
  const [lead] = await run<{ scope: string; address: string | null; scope_city: string | null; estimate_value: number | null }>(
    `SELECT scope, address, scope_city, estimate_value FROM leads WHERE id = $1`,
    [leadId],
  );
  if (!lead) return;
  const intake = await run<{ question: string; answer: string }>(`SELECT question, answer FROM lead_intake WHERE lead_id = $1`, [leadId]);
  const ans = (re: RegExp) => intake.find((q) => re.test(q.question) && q.answer.trim())?.answer.trim() ?? null;
  const [files] = await run<{ n: number }>(`SELECT count(*)::int AS n FROM files f JOIN leads l ON l.slug = f.lead_slug WHERE l.id = $1 AND f.storage_path IS NOT NULL AND f.type = 'img'`, [leadId]);
  const allText = [lead.scope, ...intake.map((q) => `${q.question}: ${q.answer}`)].join("\n");
  const scope = lead.scope.trim() || ans(/scope|project|description/i);
  const derived: Partial<Record<FactKey, unknown>> = {
    scope: scope && scope.length >= 20 ? scope : null,
    job_type: scope ? scope.split(/[.,\n]/)[0].trim().slice(0, 80) || null : null,
    timeline: ans(/timeline|timing|when/i),
    budget_fit: ans(/budget/i),
    address: lead.address?.trim() || ans(/address|location/i),
    service_area: lead.scope_city?.trim() || null,
    goals: ans(/goal|why|hoping|want/i),
    photos: Number(files?.n ?? 0) > 0 ? { count: Number(files.n) } : null,
    measurements: MEASURE_RE.test(allText) ? { text: allText.match(MEASURE_RE)?.[0] } : null,
  };
  for (const key of FACT_KEYS) {
    const v = derived[key] ?? null;
    await run(
      `INSERT INTO lead_facts (lead_id, key, value, source_ref, status, answered_at)
       VALUES ($1, $2, $3::jsonb, 'intake', $4, CASE WHEN $3::jsonb IS NULL THEN NULL ELSE now() END)
       ON CONFLICT (lead_id, key) DO UPDATE SET
         value = CASE WHEN lead_facts.status = 'known' AND lead_facts.source_ref <> 'intake' THEN lead_facts.value ELSE COALESCE(EXCLUDED.value, lead_facts.value) END,
         status = CASE WHEN lead_facts.status = 'known' THEN 'known' WHEN EXCLUDED.value IS NULL THEN lead_facts.status ELSE 'known' END,
         answered_at = CASE WHEN lead_facts.status = 'known' THEN lead_facts.answered_at WHEN EXCLUDED.value IS NULL THEN lead_facts.answered_at ELSE now() END,
         updated_at = now()`,
      [leadId, key, v == null ? null : JSON.stringify(v), v == null ? "unknown" : "known"],
    );
  }
}

/** Record a fact from a reply/portal/call. Conflicting values are flagged,
 *  not silently overwritten. */
export async function recordFact(run: Run, input: { leadId: string; key: FactKey; value: unknown; sourceRef: string }): Promise<{ status: "known" | "conflicting" }> {
  const [cur] = await run<{ value: unknown; status: string; source_ref: string }>(`SELECT value, status, source_ref FROM lead_facts WHERE lead_id = $1 AND key = $2`, [input.leadId, input.key]);
  const conflicting = Boolean(cur && cur.status === "known" && cur.value != null && JSON.stringify(cur.value) !== JSON.stringify(input.value) && cur.source_ref !== "intake");
  await run(
    `INSERT INTO lead_facts (lead_id, key, value, source_ref, status, answered_at) VALUES ($1, $2, $3::jsonb, $4, $5, now())
     ON CONFLICT (lead_id, key) DO UPDATE SET value = CASE WHEN $5 = 'conflicting' THEN lead_facts.value ELSE EXCLUDED.value END,
       source_ref = EXCLUDED.source_ref, status = $5, answered_at = now(), updated_at = now()`,
    [input.leadId, input.key, JSON.stringify(input.value), input.sourceRef, conflicting ? "conflicting" : "known"],
  );
  return { status: conflicting ? "conflicting" : "known" };
}

export async function qualificationChecklist(run: Run, leadId: string): Promise<Checklist> {
  await syncFactsFromIntake(run, leadId);
  const rows = await run<LeadFact>(`SELECT key, value, status, source_ref, asked_at::text AS asked_at, answered_at::text AS answered_at FROM lead_facts WHERE lead_id = $1`, [leadId]);
  const facts = Object.fromEntries(FACT_KEYS.map((k) => [k, rows.find((r) => r.key === k) ?? { key: k, value: null, status: "unknown", source_ref: "", asked_at: null, answered_at: null }])) as Record<FactKey, LeadFact>;
  const missing = FACT_KEYS.filter((k) => facts[k].status !== "known");
  const floor = await budgetFloorFromSkill(run);
  const reasons: string[] = [];
  let verdict: Checklist["verdict"] = "incomplete";
  const [lead] = await run<{ triage_verdict: string | null }>(`SELECT triage_verdict FROM leads WHERE id = $1`, [leadId]);
  const budgetCents = facts.budget_fit.status === "known" ? parseBudgetCents(String(typeof facts.budget_fit.value === "string" ? facts.budget_fit.value : JSON.stringify(facts.budget_fit.value))) : null;
  if (floor.cents != null && budgetCents != null && budgetCents < floor.cents) {
    verdict = "pass";
    reasons.push(`Stated budget is under the floor in ${floor.source}.`);
  } else if (lead?.triage_verdict === "pass") {
    verdict = "pass";
    reasons.push("Triage verdict is PASS.");
  } else if (missing.filter((k) => ["service_area", "job_type", "scope", "budget_fit", "timeline"].includes(k)).length === 0) {
    verdict = lead?.triage_verdict === "hold" ? "hold" : "go";
    if (verdict === "hold") reasons.push("Triage verdict is HOLD.");
  } else {
    reasons.push(`Still missing: ${missing.join(", ")}.`);
  }
  return { leadId, facts, missing, budgetFloorCents: floor.cents, budgetFloorSource: floor.source, verdict, reasons };
}
