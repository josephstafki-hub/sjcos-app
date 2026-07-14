// Section-block constructors + a tiny inline-markup parser, so template modules
// read close to the canonical .md text. `parseRuns` understands **bold** and
// *italic* markers (the same markers used in docs/reference/doc-templates/*.md),
// which keeps the transcription faithful and low-noise. Pure, no deps.

import { fmtUsd } from "../cost-book-units";
import type { Run, TableValue, TemplateSection } from "./types";

/** Parse a string with **bold** and *italic* markers into inline runs. */
export function parseRuns(text: string): Run[] {
  const runs: Run[] = [];
  // Split on **...** (bold) and *...* (italic), keeping delimiters.
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ text: tok.slice(2, -2), bold: true });
    else runs.push({ text: tok.slice(1, -1), italic: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

/** One run, optionally bold/italic (for building lists by hand). */
export function r(text: string, opts: { bold?: boolean; italic?: boolean } = {}): Run {
  return { text, ...opts };
}

export function heading(text: string, level: 1 | 2 | 3 = 2): TemplateSection {
  return { kind: "heading", text, level };
}

/** Paragraph from a string (parses bold/italic markers) or explicit runs. */
export function para(text: string | Run[]): TemplateSection {
  return { kind: "paragraph", runs: typeof text === "string" ? parseRuns(text) : text };
}

export function bulletList(items: (string | Run[])[]): TemplateSection {
  return {
    kind: "list",
    ordered: false,
    items: items.map((it) => (typeof it === "string" ? parseRuns(it) : it)),
  };
}

export function numberList(items: (string | Run[])[]): TemplateSection {
  return {
    kind: "list",
    ordered: true,
    items: items.map((it) => (typeof it === "string" ? parseRuns(it) : it)),
  };
}

export function infoStrip(cells: { label: string; value: string }[]): TemplateSection {
  return { kind: "info_strip", cells };
}

export function infoGrid(rows: { label: string; value: string }[]): TemplateSection {
  return { kind: "info_grid", rows };
}

export function moneyTable(
  rows: { label: string; sub?: string; value: string; bold?: boolean }[],
): TemplateSection {
  return { kind: "money_table", rows };
}

/** Turn a resolved TableValue into a columns_table section. */
export function tableSection(t: TableValue): TemplateSection {
  return { kind: "columns_table", headers: t.columns, rows: t.rows, emphasizeLast: t.emphasizeLast };
}

export function checkboxGroup(
  items: { label: string; checked: boolean }[],
  title?: string,
): TemplateSection {
  return { kind: "checkbox_group", items, title };
}

export function signatureBlock(parties: { role: string; name?: string }[]): TemplateSection {
  return { kind: "signature_block", parties };
}

export function notaryBlock(): TemplateSection {
  return { kind: "notary_block" };
}

export function statutoryNotice(text: string): TemplateSection {
  return { kind: "statutory_notice", runs: parseRuns(text) };
}

export function spacer(size = 1): TemplateSection {
  return { kind: "spacer", size };
}

// ─── Value accessors (build() reads field values through these) ──────────────

export function str(values: Record<string, unknown>, key: string, fallback = ""): string {
  const v = values[key];
  return v == null || v === "" ? fallback : String(v);
}

export function isTableValue(v: unknown): v is TableValue {
  return !!v && typeof v === "object" && Array.isArray((v as TableValue).rows);
}

export function table(values: Record<string, unknown>, key: string): TableValue | null {
  const v = values[key];
  return isTableValue(v) ? v : null;
}

/** Format a money_cents field value (integer cents) for display. Falls back to
 *  a dash when the value is missing so partial drafts still render. */
export function money(values: Record<string, unknown>, key: string, fallback = "—"): string {
  const v = values[key];
  if (v == null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? fmtUsd(n) : fallback;
}
