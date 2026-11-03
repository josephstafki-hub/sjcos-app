// lib/consult/form-types.ts  (pure, client-safe; zod schemas beside it)
export type FieldType = "length" | "length_pair" | "count" | "number" | "choice" | "multi" | "yesno" | "text" | "year" | "date" | "signature" | "instance_reference";
export type Unit = "in" | "sf" | "lf" | "ea" | "amp" | "gal" | "cfm" | "pct" | "psi" | "pitch" | "V" | "BTU/h" | "ton" | "lb" | "pCi/L";
export interface AtomicWhen { field: string; op: "eq" | "ne" | "in" | "lt" | "gt" | "answered"; value?: unknown }   // sibling or "house.year_built"
export type When = AtomicWhen | { all: When[] } | { any: When[] } | { not: When };
export interface ShotDef { key: string; label: string; required: boolean | When; tier: "price_critical" | "record"; hint?: string; note?: string }
export interface FieldDef {
  key: string; label: string; type: FieldType; unit?: Unit;
  component_ranges?: [[number, number], [number, number]];
  range?: [number, number];            // sanity range in the stored unit (inches for lengths)
  warn?: { below?: number; above?: number; text: string };
  precision?: number;                  // inches: 0.0625 | 0.125 | 0.5 | 1
  options?: string[];
  required: boolean | When;
  tier: "price_critical" | "record";
  say?: string;                        // script line shown above the field
  /** Office/plan note: never rendered on the visit screens. */
  note?: string;
  /** One plain visitor sentence shown under the field (Joe's words; no internal terms). */
  hint?: string;
  /** Legacy (published before notes/hints split): never rendered. */
  help?: string;
  shots?: ShotDef[];                   // photos that prove this field
  derive?: string;                     // formula over keys in the same instance/consult, e.g. "length*width/144"
  derive_cases?: ({ when: When; formula: string } | { when: When; value: string | boolean } | { when: When; gap: true })[];
  flags?: { when: When; issue: string }[];
  flag?: { when: When; issue: string };   // becomes an `issue` finding the visitor must decide (§10.3 check 9)
  maps_to?: { scope_key: string; quantity_label?: string; kind: "measurement" | "observation" | "client_answer" | "decision" | "issue" | "new_work" | "photo" };
}
export interface ModuleDef {
  key: string; version: number; title: string;
  parent_module?: string; context_module?: boolean;
  repeatable: boolean; instance_label?: string;   // "Window {n} — {location}"
  say: string[];                                  // section script lines
  fields: FieldDef[]; shots: ShotDef[];
  coverage: { key: string; text: string; satisfied_by: string[] }[];  // question items for the coverage engine
}
export interface TemplateDef {
  key: string; version: number; title: string;
  opening: string[]; closing: string[]; opening_staff?: string[]; closing_staff?: string[];
  modules: { module: string; required: boolean | When; min?: number; label?: string; presets?: Record<string, unknown>[] }[];
  derived: { key: string; label: string; formula: string; maps_to: FieldDef["maps_to"] }[];
}
