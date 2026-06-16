// Files browser data builder. DB-backed (Phase 7-B): the file list + previews
// read the files table via lib/db (Google-Drive mirror is still deferred). The
// left-rail tree (Spaces, project folders, type filters) stays static chrome —
// it's a showcase, not a live filter. The 3-pane shape is unchanged.

import type { ChipKind } from "@/components/ui/Chip";
import { query } from "./db";

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

// Static left-rail chrome (not a live filter — see header note).
const SPACES = ["SOPs", "Subs (COI / W-9)", "Materials & spec sheets", "Insurance & licenses"];
const PROJECTS = [
  { name: "Bauer", active: false },
  { name: "Chen (lead)", active: false },
  { name: "Henderson", active: true },
  { name: "Olson", active: false },
  { name: "Reyes", active: false },
];

interface FileDbRow {
  id: string;
  project_key: string;
  type: FileType;
  name: string;
  tag: string;
  ai_origin: boolean;
  modified_label: string;
  size_label: string;
  subtitle: string | null;
  ai_tags: string[];
}

export async function getFilesData(): Promise<FilesData> {
  const { rows } = await query<FileDbRow>(`
    SELECT id, project_key, type, name, tag, ai_origin,
           modified_label, size_label, subtitle, ai_tags
    FROM files
    ORDER BY sort, name
  `);

  const files: FileRow[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    tag: r.tag,
    ai: r.ai_origin,
    modified: r.modified_label,
    size: r.size_label,
  }));

  const previews: Record<string, FilePreview> = {};
  for (const r of rows) {
    // AI-origin files aren't mirrored yet; everything else shows as synced.
    const mirror: { label: string; value: string; chip?: ChipKind } = r.ai_origin
      ? { label: "Mirror", value: "Not yet synced" }
      : { label: "Mirror", value: "G Drive ✓", chip: "money" };

    previews[r.id] = {
      name: r.name,
      subtitle: r.subtitle ?? `2026 / ${r.project_key}`,
      thumbLabel: r.name.toUpperCase(),
      meta: [
        { label: "Modified", value: r.modified_label },
        {
          label: r.type === "folder" ? "Contents" : "Size",
          value: r.type === "folder" ? r.tag : r.size_label,
        },
        mirror,
      ],
      aiTags:
        r.ai_tags.length > 0
          ? r.ai_tags
          : r.ai_origin
            ? [r.tag, "AI draft"]
            : [r.tag, r.project_key],
    };
  }

  return {
    spaces: SPACES,
    projects: PROJECTS,
    folderTitle: "2026 / Henderson",
    folderMeta: `${files.length} items · auto-organized · synced w/ Google Drive`,
    typeFilters: ["All", "Contracts", "Drawings", "Photos", "Invoices", "AI tags"],
    files,
    selectedId: files[0]?.id ?? "",
    previews,
  };
}
