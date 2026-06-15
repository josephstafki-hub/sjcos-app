// Files browser data builder. Mock-backed today; in Phase 7 this becomes a
// Google-Drive-mirrored tree (the design notes "synced w/ Google Drive") and
// the AI tags are generated per-file. The 3-pane shape stays stable.

import type { ChipKind } from "@/components/ui/Chip";

export type FileType = "doc" | "img" | "folder";

export interface FileRow {
  id: string;
  type: FileType;
  name: string;
  /** Stage/tag label shown in its column, e.g. "CONTRACT" / "AI · DRAFT". */
  tag: string;
  /** Tag is AI-generated/AI-origin — renders as an `ai` chip + tinted icon. */
  ai: boolean;
  modified: string;
  /** Display size, "—" for folders. */
  size: string;
}

export interface FilePreview {
  name: string;
  subtitle: string;
  /** Big label drawn on the thumbnail placeholder. */
  thumbLabel: string;
  meta: { label: string; value: string; chip?: ChipKind }[];
  aiTags: string[];
}

export interface FilesData {
  /** Left-rail "Spaces" folders. */
  spaces: string[];
  /** Project folders under the expanded 2026 year, with the active one flagged. */
  projects: { name: string; active: boolean }[];
  folderTitle: string;
  folderMeta: string;
  /** Type filter chips; the last ("AI tags") is an `ai` chip. */
  typeFilters: string[];
  files: FileRow[];
  selectedId: string;
  previews: Record<string, FilePreview>;
}

const SPACES = ["SOPs", "Subs (COI / W-9)", "Materials & spec sheets", "Insurance & licenses"];

const PROJECTS = [
  { name: "Bauer", active: false },
  { name: "Chen (lead)", active: false },
  { name: "Henderson", active: true },
  { name: "Olson", active: false },
  { name: "Reyes", active: false },
];

const FILES: FileRow[] = [
  { id: "contract", type: "doc", name: "Signed contract.pdf", tag: "CONTRACT", ai: false, modified: "Mar 8", size: "480 KB" },
  { id: "sow", type: "doc", name: "SOW v3 — final.docx", tag: "SCOPE", ai: false, modified: "Apr 30", size: "92 KB" },
  { id: "estimate", type: "doc", name: "Estimate · v1.pdf", tag: "ESTIMATE", ai: false, modified: "Mar 6", size: "1.1 MB" },
  { id: "selections", type: "doc", name: "Selections — final.xlsx", tag: "SELECTIONS", ai: false, modified: "Apr 18", size: "88 KB" },
  { id: "floorplan", type: "img", name: "Floor plan v3.pdf", tag: "DRAWING", ai: false, modified: "Mar 4", size: "2.3 MB" },
  { id: "render", type: "img", name: "3D rendering.png", tag: "RENDER", ai: false, modified: "Mar 4", size: "4.8 MB" },
  { id: "photos-before", type: "folder", name: "Photos / before", tag: "14 photos", ai: false, modified: "Mar 12", size: "—" },
  { id: "photos-progress", type: "folder", name: "Photos / progress", tag: "62 photos", ai: false, modified: "May 22", size: "—" },
  { id: "sub-paperwork", type: "folder", name: "Sub paperwork", tag: "MARCO · TOMAS · BRAD", ai: false, modified: "Apr 12", size: "—" },
  { id: "co-001", type: "doc", name: "CO-001 · soft close hinges.pdf", tag: "CO · SIGNED", ai: false, modified: "Mar 28", size: "64 KB" },
  { id: "co-002", type: "doc", name: "CO-002 · island vent grate.pdf", tag: "CO · SIGNED", ai: false, modified: "Apr 21", size: "52 KB" },
  { id: "demand", type: "doc", name: "Demand letter · template fill.pdf", tag: "AI · DRAFT", ai: true, modified: "Today", size: "88 KB" },
];

/** Curated previews for the headline files; everything else gets a sensible
 *  generic preview built from its row so any file opens a real panel. */
const PREVIEWS: Record<string, FilePreview> = {
  contract: {
    name: "Signed contract.pdf",
    subtitle: "Henderson kitchen · v3 final",
    thumbLabel: "SIGNED CONTRACT.PDF",
    meta: [
      { label: "Modified", value: "Mar 8, 2:14p" },
      { label: "Signed by", value: "Joe S · Tom H · Kate H" },
      { label: "Mirror", value: "G Drive ✓", chip: "money" },
    ],
    aiTags: ["Contract", "$58,400", "5 milestones", "Edina"],
  },
  demand: {
    name: "Demand letter · template fill.pdf",
    subtitle: "Reyes bath · Day 15 · drafted by Claude",
    thumbLabel: "DEMAND LETTER · DRAFT",
    meta: [
      { label: "Created", value: "Today, 9:02a" },
      { label: "Status", value: "Needs review", chip: "flag" },
      { label: "Mirror", value: "Not yet synced" },
    ],
    aiTags: ["Demand letter", "$4,800", "Day 15", "Reyes"],
  },
};

export async function getFilesData(): Promise<FilesData> {
  const previews: Record<string, FilePreview> = { ...PREVIEWS };

  // Generic fallback preview for any file without a curated one.
  for (const f of FILES) {
    if (previews[f.id]) continue;
    previews[f.id] = {
      name: f.name,
      subtitle: "2026 / Henderson",
      thumbLabel: f.name.toUpperCase(),
      meta: [
        { label: "Modified", value: f.modified },
        { label: f.type === "folder" ? "Contents" : "Size", value: f.type === "folder" ? f.tag : f.size },
        { label: "Mirror", value: "G Drive ✓", chip: "money" },
      ],
      aiTags: f.ai ? [f.tag, "AI draft"] : [f.tag, "Henderson"],
    };
  }

  return {
    spaces: SPACES,
    projects: PROJECTS,
    folderTitle: "2026 / Henderson",
    folderMeta: "42 items · auto-organized · synced w/ Google Drive",
    typeFilters: ["All", "Contracts", "Drawings", "Photos", "Invoices", "AI tags"],
    files: FILES,
    selectedId: "contract",
    previews,
  };
}
