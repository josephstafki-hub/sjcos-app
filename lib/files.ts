// Files browser data builder. DB-backed: the file list + previews read the files
// table, and the left-rail project folders are built from the real projects that
// actually have files (keyed by slug, which is how uploads + generated docs are
// tagged). The type-filter chips are live client filters (FilesClient). No
// Google-Drive mirror — files are stored on this server.

import type { ChipKind } from "@/components/ui/Chip";
import { query } from "./db";

export type FileType = "doc" | "img" | "folder";

export interface FileRow {
  id: string;
  /** Project folder this file lives under — drives the tree-rail filter. */
  projectKey: string;
  type: FileType;
  name: string;
  /** Stage/tag label shown in its column, e.g. "CONTRACT" / "AI · DRAFT". */
  tag: string;
  /** Tag is AI-generated/AI-origin — renders as an `ai` chip + tinted icon. */
  ai: boolean;
  modified: string;
  /** Display size, "—" for folders. */
  size: string;
  /** A real uploaded blob is on the server — Open/Download streams it. */
  hasBlob: boolean;
}

export interface FilePreview {
  name: string;
  subtitle: string;
  /** Big label drawn on the thumbnail placeholder. */
  thumbLabel: string;
  meta: { label: string; value: string; chip?: ChipKind }[];
  aiTags: string[];
  /** True when a real uploaded blob backs this file (Open downloads it). */
  hasBlob: boolean;
}

export interface FilesData {
  /** Project folders in the tree rail — real projects that have files, keyed by
   *  slug (how files.project_key is tagged). */
  projects: { slug: string; name: string }[];
  /** Type filter chips; the last ("AI tags") is an `ai` chip. */
  typeFilters: string[];
  files: FileRow[];
  selectedId: string;
  previews: Record<string, FilePreview>;
}

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
  storage_path: string | null;
}

export async function getFilesData(): Promise<FilesData> {
  const [{ rows }, projectRes] = await Promise.all([
    query<FileDbRow>(`
      SELECT id, project_key, type, name, tag, ai_origin,
             modified_label, size_label, subtitle, ai_tags, storage_path
      FROM files
      ORDER BY sort, name
    `),
    // Real project folders: every project that has at least one file, newest work
    // first. project_key on a file is the project slug.
    query<{ slug: string; name: string }>(`
      SELECT p.slug, p.name
        FROM projects p
       WHERE EXISTS (SELECT 1 FROM files f WHERE f.project_key = p.slug)
       ORDER BY p.progress DESC, p.name ASC
    `),
  ]);

  const files: FileRow[] = rows.map((r) => ({
    id: r.id,
    projectKey: r.project_key,
    type: r.type,
    name: r.name,
    tag: r.tag,
    ai: r.ai_origin,
    modified: r.modified_label,
    size: r.size_label,
    hasBlob: !!r.storage_path,
  }));

  const previews: Record<string, FilePreview> = {};
  for (const r of rows) {
    // Real uploads + generated docs live on this server; anything without a blob
    // is an index/placeholder row.
    const mirror: { label: string; value: string; chip?: ChipKind } = r.storage_path
      ? { label: "Storage", value: "On server ✓", chip: "money" }
      : { label: "Storage", value: "No file attached" };

    previews[r.id] = {
      name: r.name,
      subtitle: r.subtitle ?? r.project_key,
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
      hasBlob: !!r.storage_path,
    };
  }

  return {
    projects: projectRes.rows,
    typeFilters: ["All", "Contracts", "Drawings", "Photos", "Invoices", "AI tags"],
    files,
    selectedId: files[0]?.id ?? "",
    previews,
  };
}
