// Sub portal data builder. Standalone surface a subcontractor sees (no SJC OS
// sidebar). Mock-backed today; reads the sub's assigned job + scope in Phase 7.

export interface SubPortalData {
  subName: string;
  subInitials: string;
  trade: string;
  job: string;
  jobChips: { label: string; kind: "accent" | "ghost"; dot?: boolean }[];
  scope: string[];
  materials: { label: string; verified: boolean }[];
  watchout: { title: string; detail: string };
  money: { label: string; value: string; good?: boolean }[];
  paperwork: string[];
  joePhone: string;
}

export async function getSubPortalData(): Promise<SubPortalData> {
  return {
    subName: "Marco Rivas",
    subInitials: "MR",
    trade: "Tile",
    job: "Henderson kitchen",
    jobChips: [
      { label: "1:00 – EOD · tile install", kind: "accent", dot: true },
      { label: "2317 Sheridan Ave S · Edina", kind: "ghost" },
      { label: "code 4429", kind: "ghost" },
    ],
    scope: [
      "Lay cement board across kitchen floor — full area 178 sq ft",
      "Set Calacatta floor pattern per plan (random length)",
      "Install backsplash 2×8 zellige · cut around outlet boxes",
      "Watch threshold transition at pantry — see Friday QC note",
    ],
    materials: [
      { label: "Calacatta floor · 5 boxes", verified: true },
      { label: "Zellige backsplash · 4 boxes", verified: true },
      { label: "Thinset + cement board", verified: true },
    ],
    watchout: {
      title: "Watch-out · soft spot at pantry threshold",
      detail: "Joe flagged Friday. Bring self-leveler just in case.",
    },
    money: [
      { label: "Total scope", value: "$8,400" },
      { label: "Paid (50%)", value: "$4,200", good: true },
      { label: "Pay on completion", value: "$4,200" },
    ],
    paperwork: ["COI · expires Aug 14", "W-9 on file", "Sub agreement signed"],
    joePhone: "(612) 555-0117",
  };
}
