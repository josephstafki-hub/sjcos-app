// Leads list data builder. Mock-backed today; swaps to DB queries in Phase 7
// (the leads table already exists — see db/schema.sql). Shape stays stable.

import type { ChipKind } from "@/components/ui/Chip";
import type { LeadStage } from "./types";

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
