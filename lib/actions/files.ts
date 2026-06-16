"use server";

// File actions (Phase 8-D). The preview pane's "Summarize" button routes here.
// Like every AI touch-point, it goes through lib/ai.ts — never a provider — so
// the swap in Phase 7.3 needs no screen changes. Returns the summary text to the
// client; no DB mutation (read-only synthesis).

import { ai } from "@/lib/ai";
import { queryOne } from "@/lib/db";

interface FileSummaryRow {
  name: string;
  tag: string;
  subtitle: string | null;
  ai_tags: string[];
}

/** Summarize a file from its metadata via the AI service. Returns a one-line
 *  blurb (or a fallback when the file is gone). */
export async function summarizeFile(id: string): Promise<string> {
  const row = await queryOne<FileSummaryRow>(
    `SELECT name, tag, subtitle, ai_tags FROM files WHERE id = $1`,
    [id],
  );
  if (!row) return "That file is no longer available.";

  const text =
    `${row.name} — ${row.tag}. ${row.subtitle ?? ""} ` +
    `Tags: ${row.ai_tags.join(", ") || "none"}.`;

  const { summary } = await ai.summarize({ text, focus: "file" });
  return summary;
}
