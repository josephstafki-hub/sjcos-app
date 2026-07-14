// Pure fill logic — no DB, no server-only, unit-testable. Enforces the manifest
// contract that AI may write ONLY narrative (`source:'ai'`) fields and that
// money/date/enum values are well-formed. resolveAutoFields (DB) lives in
// fill.ts and re-exports these.

import type { DocTemplate, FieldValues, FillResult, TemplateField } from "./types";
import { isTableValue } from "./blocks";

export type FillMark = "auto" | "ai" | "owner" | "missing";
export type FillReport = Record<string, FillMark>;
export type Actor = "ai" | "owner";

export interface ApplyResult {
  values: FieldValues;
  fillReport: FillReport;
  /** Per-key rejection reasons — nothing was applied for these. */
  rejected: Record<string, string>;
}

/** True when a value should count as "present" for required-field checks. */
function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (isTableValue(v)) return v.rows.length === 0;
  return false;
}

/** Validate a single edit against its field spec. Returns an error string or
 *  null (ok). Coerces nothing silently — callers pass typed values. */
function validateValue(field: TemplateField, value: unknown): string | null {
  switch (field.kind) {
    case "money_cents":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return "money fields must be an integer number of cents";
      }
      if (value < 0) return "money cannot be negative";
      return null;
    case "date":
      if (typeof value !== "string" || value.trim() === "") return "date must be a non-empty string";
      return null;
    case "enum":
      if (typeof value !== "string") return "enum must be a string";
      if (field.enumValues && !field.enumValues.includes(value)) {
        return `must be one of: ${field.enumValues.join(", ")}`;
      }
      return null;
    case "table":
      if (!isTableValue(value)) return "table value must be { columns, rows }";
      return null;
    case "text":
    case "narrative":
      if (typeof value !== "string") return "must be a string";
      return null;
    default:
      return "unknown field kind";
  }
}

/**
 * Apply a batch of field edits from `actor`, validating against the manifest.
 *   • unknown keys are rejected
 *   • actor 'ai' may write ONLY `source:'ai'` fields (the core safety rule)
 *   • money/date/enum/table values must be well-formed
 * Returns the merged values + updated fill report; rejected keys are untouched.
 */
export function applyFieldEdits(
  template: DocTemplate,
  currentValues: FieldValues,
  currentReport: FillReport,
  edits: Record<string, unknown>,
  actor: Actor,
): ApplyResult {
  const byKey = new Map(template.fields.map((f) => [f.key, f]));
  const values: FieldValues = { ...currentValues };
  const fillReport: FillReport = { ...currentReport };
  const rejected: Record<string, string> = {};

  for (const [key, value] of Object.entries(edits)) {
    const field = byKey.get(key);
    if (!field) {
      rejected[key] = "unknown field";
      continue;
    }
    if (actor === "ai" && field.source !== "ai") {
      rejected[key] = `AI may not write '${field.source}' field '${key}' — narratives only`;
      continue;
    }
    const err = validateValue(field, value);
    if (err) {
      rejected[key] = err;
      continue;
    }
    values[key] = value as FieldValues[string];
    fillReport[key] = isEmpty(value) ? "missing" : actor;
  }

  return { values, fillReport, rejected };
}

/** All required fields present → ok, else the list of missing field keys. */
export function validateForRender(template: DocTemplate, values: FieldValues): FillResult {
  const missing = template.fields
    .filter((f) => f.required && isEmpty(values[f.key]))
    .map((f) => f.key);
  return { ok: missing.length === 0, missing };
}
