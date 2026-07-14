// Document-template type system (doc-templates plan, Phase 2). Plain types +
// no runtime deps — safe to import anywhere. The canonical legal/visual text for
// each template lives in code (lib/doc-templates/<key>.ts); a DocTemplate is that
// module's public shape. See docs/doc-templates-plan.md.
//
//   • `fields` is the manifest the fill engine + AI tools reason about.
//   • `build(values)` is PURE: it turns resolved field values into an ordered
//     list of TemplateSection blocks. All DB access happens earlier, in
//     fill.ts:resolveAutoFields — never here.

/** How a field is typed + validated. Money is always integer CENTS. */
export type FieldKind =
  | "text"
  | "money_cents"
  | "date"
  | "enum"
  | "table"
  | "narrative";

/**
 * Who may write a field:
 *   auto  — resolved from the DB / app_settings (never hand-authored by AI)
 *   owner — must be provided or confirmed by Joe
 *   ai    — an AI agent may draft it (narratives only)
 * The fill layer enforces that `actor==='ai'` edits touch only `source:'ai'`.
 */
export type FieldSource = "auto" | "owner" | "ai";

export interface TemplateField {
  key: string;
  label: string;
  kind: FieldKind;
  source: FieldSource;
  required: boolean;
  /** Allowed values when kind==='enum'. */
  enumValues?: readonly string[];
  /** Optional owner-facing help / hint. */
  help?: string;
}

/** A structured value for a `table` field (auto-resolved; cells are display
 *  strings so the renderer stays dumb). */
export interface TableValue {
  columns: string[];
  rows: string[][];
  /** Render the final row emphasized (a total). */
  emphasizeLast?: boolean;
}

export type FieldValue = string | number | boolean | null | TableValue;
export type FieldValues = Record<string, FieldValue>;

// ─── Section (content-block) model ───────────────────────────────────────────

/** An inline text run; `bold`/`italic` drive both PDF font selection and DOCX
 *  TextRun flags. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type TemplateSection =
  | { kind: "heading"; text: string; level: 1 | 2 | 3 }
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  /** Horizontal boxed strip at the top of a doc: CONTRACT # | DATE | TOTAL. */
  | { kind: "info_strip"; cells: { label: string; value: string }[] }
  /** Vertical label/value grid (client info, payment facts). */
  | { kind: "info_grid"; rows: { label: string; value: string }[] }
  /** Money-style two-column table (label · optional sub · right-aligned value). */
  | { kind: "money_table"; rows: { label: string; sub?: string; value: string; bold?: boolean }[] }
  /** N-column table with a header row (payment schedule, SOW line items). */
  | { kind: "columns_table"; headers: string[]; rows: string[][]; emphasizeLast?: boolean }
  | { kind: "checkbox_group"; title?: string; items: { label: string; checked: boolean }[] }
  | { kind: "signature_block"; parties: { role: string; name?: string }[] }
  | { kind: "notary_block" }
  /** Statutory notice — renderer must emit ≥10-pt bold (Minn. Stat. § 514.011). */
  | { kind: "statutory_notice"; runs: Run[] }
  | { kind: "spacer"; size: number };

// ─── Template ────────────────────────────────────────────────────────────────

export type DocClass = "legal" | "transactional";
/** project — needs a project row; lead — pre-project (precon/estimate); both. */
export type TemplateScope = "project" | "lead" | "both";

export interface DocTemplate {
  key: string;
  /** Bump on ANY language change — stamped on every rendered doc. */
  version: string;
  title: string;
  subtitle: string;
  docClass: DocClass;
  scope: TemplateScope;
  /** Legal-class docs render the LEGAL_DISCLAIMER footer until the canonical
   *  legal text has been confirmed reviewed by Joe's attorney. */
  attorneyReviewed?: boolean;
  fields: TemplateField[];
  build(values: FieldValues): TemplateSection[];
  /** Optional dynamic title (e.g. lien release picks a variant title from
   *  `waiver_type`). When present it overrides `title` in the rendered chrome. */
  titleFor?(values: FieldValues): string;
}

/** Result of validating a draft for render. */
export interface FillResult {
  ok: boolean;
  missing: string[]; // required field keys still empty
}
