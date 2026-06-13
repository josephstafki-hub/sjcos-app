// Leads list data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the leads table already exists — see db/schema.sql). Shape stays stable.

import type { ChipKind } from "@/components/ui/Chip";
import type { LeadStage, TriageVerdict } from "./types";
import { ai } from "./ai";

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

export interface LeadListItem {
  slug: string;
  initials: string;
  name: string;
  scope: string;
  stage: LeadStage;
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

const LEADS: LeadListItem[] = [
  {
    slug: "maria-chen",
    initials: "MC",
    name: "Maria & David Chen",
    scope: "Kitchen reno · Edina",
    stage: "phase1_sent",
    value: "$49–60k",
    ageDays: 6,
    hot: true,
    flag: { label: "Needs reply", kind: "flag" },
  },
  {
    slug: "anh-pham",
    initials: "AP",
    name: "Anh Pham",
    scope: "Bath reno · St Paul",
    stage: "intake",
    value: "$22k",
    ageDays: 2,
    hot: false,
  },
  {
    slug: "a-cole",
    initials: "AC",
    name: "A. Cole",
    scope: "Basement bar · Mpls",
    stage: "intake",
    value: "?",
    ageDays: 4,
    hot: false,
    flag: { label: "New", kind: "ai" },
  },
  {
    slug: "linda-bauer",
    initials: "LB",
    name: "Linda Bauer",
    scope: "Mudroom · Mpls",
    stage: "precon_in_flight",
    value: "$28k",
    ageDays: 21,
    hot: false,
  },
  {
    slug: "erik-holmstrom",
    initials: "EH",
    name: "Erik Holmstrom",
    scope: "Front porch · Edina",
    stage: "phase1_sent",
    value: "$32k",
    ageDays: 9,
    hot: true,
    flag: { label: "Cooling", kind: "flag" },
  },
  {
    slug: "gabe-reyes",
    initials: "GR",
    name: "Gabe Reyes (referral)",
    scope: "Master bath · Mpls",
    stage: "formal_proposal",
    value: "$41k",
    ageDays: 15,
    hot: false,
  },
  {
    slug: "n-sandberg",
    initials: "NS",
    name: "N. Sandberg",
    scope: "Built-ins · Edina",
    stage: "precon_signed",
    value: "$14k",
    ageDays: 11,
    hot: false,
  },
];

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
  },
};

/** Parse a display value like "$49–60k" / "$22k" / "?" to a rough dollar number. */
function parseValue(v: string): number | null {
  const m = v.match(/\$?\s*(\d+)/);
  return m ? Number(m[1]) * 1000 : null;
}

export async function getLead(slug: string): Promise<LeadDetail | null> {
  const item = LEADS.find((l) => l.slug === slug);
  if (!item) return null;

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
  };
}

export async function getLeadsData(): Promise<LeadsData> {
  const needReply = LEADS.filter((l) => l.flag?.label === "Needs reply" || l.flag?.label === "Cooling").length;
  return {
    summary: `Pipeline · ${LEADS.length} active · ${needReply} need a reply · $186k weighted`,
    stages: STAGES.map((s) => ({
      ...s,
      count: LEADS.filter((l) => l.stage === s.key).length,
    })),
    leads: LEADS,
  };
}
