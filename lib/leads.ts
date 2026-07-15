// Leads data builder. DB-backed (Phase 7.2): the list + detail read from the
// leads table via lib/db. Detail pages still merge curated rich content
// (intake Q&A, estimate lines) keyed by slug — those aren't modeled as columns
// yet, so they fall back to sensible generics for un-curated rows. The AI
// triage verdict still routes through lib/ai.ts.

import type { ChipKind } from "@/components/ui/Chip";
import type { LeadStage, TriageVerdict } from "./types";
import { ai, type TriageInput, type TriageResult } from "./ai";
import { query } from "./db";
import { relativeAge } from "./lead-activity";
import { INTAKE_QUESTIONS } from "./lead-intake-questions";

/** The lead pipeline stages, in order, ending at the signed pre-con contract. */
export const STAGES: { key: LeadStage; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "qualified", label: "Qualified" },
  { key: "discovery_call", label: "Discovery call" },
  { key: "rough_estimate", label: "Rough estimate" },
  { key: "precon_signed", label: "Pre-con signed" },
];

/** Terminal, off-pipeline stage for dead/declined/archived leads. Set only by an
 *  explicit "mark lost" — never reached by advancing — and kept out of STAGES so
 *  it never appears in the pipeline strip or the forward progression. */
export const LOST_STAGE = { key: "lost" as LeadStage, label: "Lost / Archived" };

/** Every valid lead stage (pipeline + terminal). Use for stage validation. */
export const ALL_STAGES: { key: LeadStage; label: string }[] = [...STAGES, LOST_STAGE];

export function stageIndex(stage: LeadStage): number {
  return STAGES.findIndex((s) => s.key === stage);
}

export function isLostStage(stage: LeadStage): boolean {
  return stage === "lost";
}

export function stageLabel(stage: LeadStage): string {
  return ALL_STAGES.find((s) => s.key === stage)?.label ?? stage;
}

/** Normalize a model-drafted money string for display: "4000-5000" →
 *  "$4,000–$5,000", "12000" → "$12,000". Already-formatted values and
 *  non-amount text pass through untouched. */
export function formatMoneyish(v: string): string {
  return v
    .trim()
    .replace(/\$?\b(\d{4,7})\b(?!,|\.\d)/g, (_m, n: string) => `$${Number(n).toLocaleString("en-US")}`)
    .replace(/(\$[\d,]+)\s*[-–]\s*(?=\$?\d)/g, "$1–");
}

/** Suggested project name for a converting lead — "<LastName> · <scope head>",
 *  e.g. "Chen · Full kitchen reno". A best-guess prefill only: the owner
 *  confirms/edits it in the convert dialog before the project is created. */
export function suggestedProjectName(leadName: string, scope: string): string {
  const words = leadName.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  const lastName = words[words.length - 1] || leadName;
  const scopeHead = (scope.split(/[·,.]/)[0] ?? "").trim() || scope.trim();
  return [lastName, scopeHead].filter(Boolean).join(" · ").slice(0, 80);
}

/** Lead temperature, derived server-side so the list filter chips work without
 *  pulling this server-coupled module into a client bundle. */
export type LeadTemperature = "hot" | "cooling" | "declined" | "active";

export interface LeadListItem {
  slug: string;
  initials: string;
  name: string;
  scope: string;
  stage: LeadStage;
  /** Precomputed so the client filter never imports stageLabel/stageIndex. */
  stageLabelText: string;
  stageAdvanced: boolean;
  temperature: LeadTemperature;
  /** Display value, e.g. "$49–60k" or "?". */
  value: string;
  ageDays: number;
  /** Avatar emphasis — accent for hot leads. */
  hot: boolean;
  /** Optional "AI take" tag shown in the table's right column. */
  flag?: { label: string; kind: ChipKind };
}

export interface LeadsData {
  summary: string;
  stages: { key: LeadStage; label: string; count: number }[];
  leads: LeadListItem[];
}

// ─── DB row → display mapping ────────────────────────────────────────────────

interface LeadRow {
  slug: string;
  name: string;
  scope: string;
  stage: LeadStage;
  value: string;
  hot: boolean;
  flag_label: string | null;
  flag_kind: string | null;
  estimate_value: number | null;
  email: string | null;
  phone: string | null;
  age_days: number;
  referrer_name: string | null;
  referrer_email: string | null;
  referrer_thanked: boolean;
}

const LEAD_SELECT = `
  SELECT slug, name, scope, stage,
         COALESCE(value_display, '?') AS value,
         hot, flag_label, flag_kind, estimate_value, email, phone,
         GREATEST(0, (CURRENT_DATE - last_contact_at::date))::int AS age_days,
         referrer_name, referrer_email, (referrer_thanked_at IS NOT NULL) AS referrer_thanked
  FROM leads`;

/** Initials from a display name: first + last alphabetic word. */
function initialsFrom(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Classify a lead's temperature for the list filters. A declining/lost flag
 *  wins; otherwise hot, then quiet-for-2-weeks → cooling, else active. */
function temperatureOf(r: LeadRow): LeadTemperature {
  if (r.stage === "lost") return "declined";
  const label = (r.flag_label ?? "").toLowerCase();
  if (/declin|lost|dead|cold/.test(label)) return "declined";
  if (r.hot) return "hot";
  if (/cool/.test(label) || r.age_days >= 14) return "cooling";
  return "active";
}

function rowToItem(r: LeadRow): LeadListItem {
  return {
    slug: r.slug,
    initials: initialsFrom(r.name),
    name: r.name,
    scope: r.scope,
    stage: r.stage,
    stageLabelText: stageLabel(r.stage),
    stageAdvanced: stageIndex(r.stage) >= 3,
    temperature: temperatureOf(r),
    value: r.value,
    ageDays: r.age_days,
    hot: r.hot,
    flag: r.flag_label
      ? { label: r.flag_label, kind: (r.flag_kind ?? "ghost") as ChipKind }
      : undefined,
  };
}

// ─── Lead detail ────────────────────────────────────────────────────────────

export interface LeadDetail {
  slug: string;
  initials: string;
  name: string;
  scope: string;
  stage: LeadStage;
  address: string;
  source: string;
  /** Contact details for the Call/Email actions; null when unknown. */
  email: string | null;
  phone: string | null;
  /** Referral (P6-1): who referred this lead + whether they've been thanked. */
  referrerName: string | null;
  referrerEmail: string | null;
  referrerThanked: boolean;
  loggedLabel: string;
  ageDays: number;
  hot: boolean;
  /** Inputs for the AI triage, resolved lazily so the page paints instantly and
   *  the triage streams in (CPU Qwen is ~11s — see getLeadTriage + Suspense). */
  triageInput: TriageInput;
  intake: { label: string; value: string }[];
  estimate: {
    status: "draft" | "sent";
    sentLabel: string;
    notes: string;
    lines: { label: string; value: string }[];
    total: string;
  } | null;
  cadence: { label: string; value: string; chip?: ChipKind }[];
  photosCount: number;
  /** Real uploaded lead photos (served from /api/files/<id>). */
  photos: { id: string; name: string }[];
  conversation: { from: string; role: "lead" | "you" | "ai"; time: string; body: string }[];
  selections: { label: string; choice: string; status: string; chip: ChipKind }[];
  files: { name: string; meta: string; tag?: string }[];
  /** Slug of the project this lead was converted into, if any. */
  projectSlug: string | null;
}

/** Rich, curated detail content keyed by slug. Leads not listed here still get
 *  a sensible generic detail so every row in the table opens a real page. */
const DETAILS: Record<string, Partial<LeadDetail>> = {
  "maria-chen": {
    address: "4218 Hillcrest Ave · Edina",
    source: "Site form",
    loggedLabel: "Logged Apr 19 (6 days ago)",
    cadence: [
      { label: "First contact", value: "Apr 19, 11:08a" },
      { label: "First reply (SLA <24h)", value: "3h 14m ✓", chip: "money" },
      { label: "Last contact", value: "Today 9:14a" },
      { label: "Awaiting your reply", value: "5h 12m", chip: "flag" },
    ],
    photosCount: 6,
    conversation: [
      {
        from: "Maria Chen",
        role: "lead",
        time: "Apr 19, 11:08a",
        body: "Hi Joe — found you through the Edina remodel photos. We're ready to redo our kitchen and hoping to get a ballpark number.",
      },
      {
        from: "AI assistant",
        role: "ai",
        time: "Apr 19, 11:09a",
        body: "Auto-acknowledged within SLA and sent the 5 intake questions. Scored this a strong lead — full reno, realistic budget, two competing bids.",
      },
      {
        from: "You",
        role: "you",
        time: "Apr 19, 2:22p",
        body: "Thanks Maria! Sent over a few questions — once I have those I can get you a Phase 1 range this week.",
      },
      {
        from: "Maria Chen",
        role: "lead",
        time: "Apr 21, 9:40a",
        body: "Answered everything + attached 6 photos and rough measurements. Two other bids out, but we liked your work best.",
      },
      {
        from: "You",
        role: "you",
        time: "Apr 21, 4:05p",
        body: "Perfect — Phase 1 rough estimate attached, range is $49.3k–$60.7k. Happy to walk through it whenever works.",
      },
    ],
    selections: [
      { label: "Cabinetry", choice: "Mid-tier shaker, painted white", status: "proposed", chip: "ai" },
      { label: "Countertops", choice: "Calacatta quartz", status: "proposed", chip: "ai" },
      { label: "Flooring", choice: "LVP — warm oak", status: "proposed", chip: "ai" },
      { label: "Backsplash", choice: "Undecided", status: "open", chip: "ghost" },
    ],
    files: [
      { name: "Intake photos · 6", meta: "Uploaded Apr 21 · 18.4 MB", tag: "AI-tagged" },
      { name: "Rough measurements.pdf", meta: "Apr 21 · 240 KB" },
      { name: "Phase 1 estimate.pdf", meta: "Sent Apr 21 · 88 KB", tag: "AI" },
    ],
  },
};

/** Parse a display value like "$49–60k" / "$22k" / "?" to a rough dollar number. */
function parseValue(v: string): number | null {
  const m = v.match(/\$?\s*(\d+)/);
  return m ? Number(m[1]) * 1000 : null;
}

/** Compact a rough-estimate total range like "$51,000 – $64,500" down to the
 *  overview list's "$51–65k" style value_display, plus a midpoint estimate_value
 *  (in raw dollars) for sorting/forecast. Null when the total has no numbers. */
export function compactEstimateValue(total: string): { display: string; value: number } | null {
  const nums = total.match(/[\d,]+(?:\.\d+)?/g)?.map((n) => Number(n.replace(/,/g, "")));
  if (!nums || nums.length === 0) return null;
  const ks = nums.map((n) => Math.round(n / 1000));
  const display = ks.length > 1 && ks[0] !== ks[ks.length - 1] ? `$${ks[0]}–${ks[ks.length - 1]}k` : `$${ks[0]}k`;
  const value = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return { display, value };
}

export async function getLead(slug: string): Promise<LeadDetail | null> {
  const { rows } = await query<LeadRow>(`${LEAD_SELECT} WHERE slug = $1`, [slug]);
  const row = rows[0];
  if (!row) return null;
  const item = rowToItem(row);

  // Triage is NOT awaited here — that would block the page on ~11s of CPU
  // inference. Return the inputs; getLeadTriage() runs inside a Suspense slot.
  const triageInput: TriageInput = {
    name: item.name,
    scope: item.scope,
    estimateValue: parseValue(item.value),
    source: "lead list",
  };

  const curated = DETAILS[slug] ?? {};

  // Real uploaded photos for this lead (if any). Fall back to the showcase
  // placeholder count only when none have been uploaded.
  const photoRes = await query<{ id: string; name: string }>(
    `SELECT id, name FROM files
       WHERE lead_slug = $1 AND storage_path IS NOT NULL AND type = 'img'
       ORDER BY created_at DESC`,
    [slug],
  );
  const photos = photoRes.rows;

  // Real intake answers (round 3). Falls back to curated/generic when the lead
  // has no lead_intake rows yet.
  const intakeRes = await query<{ question: string; answer: string }>(
    `SELECT li.question, li.answer
       FROM lead_intake li JOIN leads l ON l.id = li.lead_id
      WHERE l.slug = $1
      ORDER BY li.sort_order, li.id`,
    [slug],
  );
  // Intake is the canonical 5 questions (always editable), pre-filled with any
  // saved answers, then any extra saved questions not in the canonical set.
  const answerOf = new Map(intakeRes.rows.map((r) => [r.question, r.answer]));
  const intake: { label: string; value: string }[] = INTAKE_QUESTIONS.map((q) => ({
    label: q,
    value: answerOf.get(q) ?? "",
  }));
  for (const r of intakeRes.rows) {
    if (!INTAKE_QUESTIONS.includes(r.question as (typeof INTAKE_QUESTIONS)[number])) {
      intake.push({ label: r.question, value: r.answer });
    }
  }

  // Real rough estimate (round 3). One row per lead; null until drafted.
  const estRes = await query<{
    notes: string;
    line_items: { label: string; value: string }[];
    total: string;
    status: "draft" | "sent";
    sent_age: number | null;
  }>(
    `SELECT e.notes, e.line_items, e.total, e.status,
            CASE WHEN e.sent_at IS NULL THEN NULL
                 ELSE EXTRACT(EPOCH FROM (now() - e.sent_at))::int END AS sent_age
       FROM lead_estimates e JOIN leads l ON l.id = e.lead_id
      WHERE l.slug = $1`,
    [slug],
  );
  // Linked project (if this lead was already converted).
  const projRes = await query<{ slug: string }>(
    `SELECT p.slug FROM projects p JOIN leads l ON l.id = p.lead_id
      WHERE l.slug = $1 LIMIT 1`,
    [slug],
  );
  const projectSlug = projRes.rows[0]?.slug ?? null;

  const estRow = estRes.rows[0];
  const estimateFromDb = estRow
    ? {
        status: estRow.status,
        sentLabel:
          estRow.status === "sent"
            ? `Sent ${estRow.sent_age != null ? relativeAge(estRow.sent_age) : ""}`.trim()
            : "Draft",
        notes: estRow.notes,
        lines: (estRow.line_items ?? []).map((l) => ({ ...l, value: formatMoneyish(l.value) })),
        total: formatMoneyish(estRow.total),
      }
    : null;

  return {
    slug: item.slug,
    initials: item.initials,
    name: item.name,
    scope: item.scope,
    stage: item.stage,
    hot: item.hot,
    ageDays: item.ageDays,
    address: curated.address ?? item.scope,
    source: curated.source ?? "Manual entry",
    email: row.email,
    phone: row.phone,
    referrerName: row.referrer_name,
    referrerEmail: row.referrer_email,
    referrerThanked: row.referrer_thanked,
    loggedLabel: curated.loggedLabel ?? `Logged ${item.ageDays} days ago`,
    triageInput,
    intake,
    estimate: estimateFromDb ?? curated.estimate ?? null,
    cadence:
      curated.cadence ??
      [
        { label: "First contact", value: `${item.ageDays}d ago` },
        { label: "Last contact", value: "—" },
      ],
    photosCount: photos.length || curated.photosCount || 0,
    photos,
    conversation: curated.conversation ?? [],
    selections: curated.selections ?? [],
    files: curated.files ?? [],
    projectSlug,
  };
}

/** The AI triage verdict + rationale. Resolved separately from getLead() so it
 *  can stream inside a Suspense boundary instead of blocking the page. */
export async function getLeadTriage(input: TriageInput): Promise<TriageResult> {
  return ai.triage(input);
}

export async function getLeadsData(): Promise<LeadsData> {
  const { rows } = await query<LeadRow>(`${LEAD_SELECT} ORDER BY hot DESC, last_contact_at DESC`);
  const leads = rows.map(rowToItem);

  // "Active" excludes terminal lost/archived leads from the headline + weighting.
  const active = leads.filter((l) => l.stage !== "lost");
  const needReply = active.filter(
    (l) => l.flag?.label === "Needs reply" || l.flag?.label === "Cooling",
  ).length;
  const weightedK = Math.round(
    rows.filter((r) => r.stage !== "lost").reduce((sum, r) => sum + (r.estimate_value ?? 0), 0) / 1000,
  );

  return {
    summary: `Pipeline · ${active.length} active · ${needReply} need a reply · $${weightedK}k weighted`,
    stages: STAGES.map((s) => ({
      ...s,
      count: leads.filter((l) => l.stage === s.key).length,
    })),
    leads,
  };
}
