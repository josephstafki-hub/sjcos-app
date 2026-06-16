// Leads data builder. DB-backed (Phase 7.2): the list + detail read from the
// leads table via lib/db. Detail pages still merge curated rich content
// (intake Q&A, estimate lines) keyed by slug — those aren't modeled as columns
// yet, so they fall back to sensible generics for un-curated rows. The AI
// triage verdict still routes through lib/ai.ts.

import type { ChipKind } from "@/components/ui/Chip";
import type { LeadStage, TriageVerdict } from "./types";
import { ai } from "./ai";
import { query } from "./db";

/** The 6 pipeline stages, in order, with display labels. */
export const STAGES: { key: LeadStage; label: string }[] = [
  { key: "intake", label: "Intake" },
  { key: "phase1_sent", label: "Phase 1 sent" },
  { key: "precon_signed", label: "Pre-con signed" },
  { key: "precon_in_flight", label: "Pre-con in flight" },
  { key: "formal_proposal", label: "Formal proposal" },
  { key: "signed_retainer", label: "Signed + retainer" },
];

export function stageIndex(stage: LeadStage): number {
  return STAGES.findIndex((s) => s.key === stage);
}

export function stageLabel(stage: LeadStage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
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
  age_days: number;
}

const LEAD_SELECT = `
  SELECT slug, name, scope, stage,
         COALESCE(value_display, '?') AS value,
         hot, flag_label, flag_kind, estimate_value,
         GREATEST(0, (CURRENT_DATE - last_contact_at::date))::int AS age_days
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
  loggedLabel: string;
  ageDays: number;
  hot: boolean;
  triage: { verdict: TriageVerdict; rationale: string };
  intake: { label: string; value: string }[];
  estimate: {
    sentLabel: string;
    lines: { label: string; value: string }[];
    total: string;
  } | null;
  cadence: { label: string; value: string; chip?: ChipKind }[];
  photosCount: number;
  conversation: { from: string; role: "lead" | "you" | "ai"; time: string; body: string }[];
  selections: { label: string; choice: string; status: string; chip: ChipKind }[];
  files: { name: string; meta: string; tag?: string }[];
}

/** Rich, curated detail content keyed by slug. Leads not listed here still get
 *  a sensible generic detail so every row in the table opens a real page. */
const DETAILS: Record<string, Partial<LeadDetail>> = {
  "maria-chen": {
    address: "4218 Hillcrest Ave · Edina",
    source: "Site form",
    loggedLabel: "Logged Apr 19 (6 days ago)",
    intake: [
      { label: "Scope", value: "Full kitchen reno — cabinets, counters, backsplash, flooring, recessed lighting" },
      { label: "Timeline", value: "Hoping to start late June, done before Thanksgiving" },
      { label: "Budget", value: "$45,000 – $55,000" },
      { label: "Address", value: "4218 Hillcrest Ave, Edina MN" },
      { label: "Other bids?", value: "Yes — 2 others (one is Smith Bros)" },
      { label: "Photos / measure", value: "6 photos + rough measurements provided" },
    ],
    estimate: {
      sentLabel: "Sent Apr 21",
      lines: [
        { label: "Demo + prep", value: "$3,200" },
        { label: "Cabinetry (mid-tier)", value: "$14,500 – $18,500" },
        { label: "Counters (Calacatta)", value: "$8,200 – $11,000" },
        { label: "Backsplash + tile", value: "$3,400 – $4,800" },
        { label: "Flooring (LVP)", value: "$4,200 – $5,400" },
        { label: "Electrical + light", value: "$3,800" },
        { label: "Labor + GC + sub", value: "$12,000 – $14,000" },
      ],
      total: "$49,300 – $60,700",
    },
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
        from: "Claude",
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
      { name: "Phase 1 estimate.pdf", meta: "Sent Apr 21 · 88 KB", tag: "Claude" },
    ],
  },
};

/** Parse a display value like "$49–60k" / "$22k" / "?" to a rough dollar number. */
function parseValue(v: string): number | null {
  const m = v.match(/\$?\s*(\d+)/);
  return m ? Number(m[1]) * 1000 : null;
}

export async function getLead(slug: string): Promise<LeadDetail | null> {
  const { rows } = await query<LeadRow>(`${LEAD_SELECT} WHERE slug = $1`, [slug]);
  const row = rows[0];
  if (!row) return null;
  const item = rowToItem(row);

  const triageResult = await ai.triage({
    name: item.name,
    scope: item.scope,
    estimateValue: parseValue(item.value),
    source: "lead list",
  });

  const curated = DETAILS[slug] ?? {};

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
    loggedLabel: curated.loggedLabel ?? `Logged ${item.ageDays} days ago`,
    triage: { verdict: triageResult.verdict, rationale: triageResult.rationale },
    intake:
      curated.intake ??
      [
        { label: "Scope", value: item.scope },
        { label: "Est. value", value: item.value },
        { label: "Stage", value: stageLabel(item.stage) },
        { label: "Age", value: `${item.ageDays} days` },
      ],
    estimate: curated.estimate ?? null,
    cadence:
      curated.cadence ??
      [
        { label: "First contact", value: `${item.ageDays}d ago` },
        { label: "Last contact", value: "—" },
      ],
    photosCount: curated.photosCount ?? 0,
    conversation: curated.conversation ?? [],
    selections: curated.selections ?? [],
    files: curated.files ?? [],
  };
}

export async function getLeadsData(): Promise<LeadsData> {
  const { rows } = await query<LeadRow>(`${LEAD_SELECT} ORDER BY hot DESC, last_contact_at DESC`);
  const leads = rows.map(rowToItem);

  const needReply = leads.filter(
    (l) => l.flag?.label === "Needs reply" || l.flag?.label === "Cooling",
  ).length;
  const weightedK = Math.round(
    rows.reduce((sum, r) => sum + (r.estimate_value ?? 0), 0) / 1000,
  );

  return {
    summary: `Pipeline · ${leads.length} active · ${needReply} need a reply · $${weightedK}k weighted`,
    stages: STAGES.map((s) => ({
      ...s,
      count: leads.filter((l) => l.stage === s.key).length,
    })),
    leads,
  };
}
