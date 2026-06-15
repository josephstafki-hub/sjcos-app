// Client portal data builder. Standalone surface a client sees (no SJC OS
// sidebar). Mock-backed today; reads the project journal + draw schedule in
// Phase 7.

export interface JournalEntry {
  date: string;
  title: string;
  body: string;
  /** Number of photo tiles to show (first entry only, in the design). */
  photos: number;
}

export interface ClientPortalData {
  project: string;
  clientInitials: string;
  greeting: string;
  statusChips: { label: string; kind: "accent" | "money" | "ghost"; dot?: boolean }[];
  entries: JournalEntry[];
  decision: { title: string; detail: string };
  money: { label: string; value: string; good?: boolean }[];
  files: string[];
}

export async function getClientPortalData(): Promise<ClientPortalData> {
  return {
    project: "Henderson kitchen",
    clientInitials: "TH",
    greeting: "Hi Tom & Kate — here's where we are.",
    statusChips: [
      { label: "Tile phase · started today", kind: "accent", dot: true },
      { label: "On schedule", kind: "money" },
      { label: "Expected completion: Jun 18", kind: "ghost" },
    ],
    entries: [
      {
        date: "TODAY · MAY 25",
        title: "Tile install begins",
        body: "Marco arrived 12:30 with everything for the floor and backsplash. Joe walked it before the trowel went down — substrate looked clean. Photos coming end of day.",
        photos: 4,
      },
      {
        date: "FRI · MAY 22",
        title: "Cabinets — last hardware install",
        body: "Doors and brass pulls in. Pantry door had a hairline scratch from shipping — replacement on the way, no schedule impact.",
        photos: 0,
      },
      {
        date: "WED · MAY 20",
        title: "Counter slab confirmed at fabricator",
        body: "Slab #2 (the one you liked best) is on the saw Tues. Template fits — your inverted notch worked.",
        photos: 0,
      },
    ],
    decision: {
      title: "Vent grate finish · pick 1",
      detail: "Aged brass or matte black. Either works — your call by Wed.",
    },
    money: [
      { label: "Contract", value: "$58,400" },
      { label: "Paid to date", value: "$35,040", good: true },
      { label: "Next draw (tile)", value: "$12,400 · this week" },
    ],
    files: ["Signed contract", "Selections summary", "Floor plan v3", "Weekly photos · folder"],
  };
}
