/**
 * Executable version-1 seed for the in-home consultation forms (plan §7, `lib/consult/forms/seed.ts`).
 * Every approved §7.2–§7.11 row is data here; `approved-content.ts` stays the verbatim fidelity copy.
 * Inserted as version 1 by the migration companion; Joe's edits create version 2, 3 …
 */
import type { ModuleDef, TemplateDef, When } from '../form-types.ts';
import { validateModule, validateTemplate, type FormRegistry } from './validate.ts';
import { visit, sharedModules, sharedChildModules } from './seed/shared.ts';
import { templateModules, templateChildModules, addOnModules, addOnChildModules } from './seed/template-modules.ts';
import { templates, addOns, scopeMappings } from './seed/templates.ts';
import { moduleParents, selectionDecisions } from './seed/templates.ts';
import { OPENING_STAFF, CLOSING_STAFF } from './seed/scripts.ts';
import { derivationCases } from './seed/derivations.ts';
import { FLAG_HINTS } from './seed/flag-hints.ts';

export * from './seed/scripts.ts';
export {
  scopeLabelRegistry, scopeMappings, SCOPE_LABEL_REGISTRY_VERSION, fieldQuantityFeeds, selectionDecisions, selectionRules, moduleParents, planFormulas, FORMULA_CONVENTIONS,
} from './seed/templates.ts';
export { derivationCases, type Derivation, type DerivationCase } from './seed/derivations.ts';
export { sharedModules, sharedChildModules, templateModules, templateChildModules, addOnModules, addOnChildModules, templates, addOns };

export const SEED_VERSION = 1;
/** Server-filled context module so "template ∈ …" / add-on conditions reference a real field; first entry of each of the 7 templates. */
export const contextModules: ModuleDef[] = [visit];
/** Every module definition published by the seed (context module included). */
export const seedModules: ModuleDef[] = [...contextModules, ...sharedModules, ...sharedChildModules, ...templateModules, ...templateChildModules, ...addOnModules, ...addOnChildModules];
// Persist all semantic metadata in the immutable pinned definitions.
for(const module of seedModules){
 if(module.key==='visit')module.context_module=true;
 if(moduleParents[module.key])module.parent_module=moduleParents[module.key];
 for(const field of module.fields){const rule=derivationCases.find(d=>d.kind==='derived'&&d.module===module.key&&d.field===field.key);if(rule)field.derive_cases=rule.cases;
  // Visitor sentence for each flag; the office `issue` keeps its citations (r3 C5).
  [...(field.flag?[field.flag]:[]),...(field.flags??[])].forEach((flag,i)=>{const hint=FLAG_HINTS[`${module.key}.${field.key}${i?`#${i}`:''}`];if(hint)flag.hint=hint;});}
}
for(const template of [...templates,...addOns]){
 template.opening_staff=OPENING_STAFF.map(l=>l.text);template.closing_staff=CLOSING_STAFF.map(l=>l.text);
 const decisions=selectionDecisions[template.key as keyof typeof selectionDecisions];
 const selections=template.modules.find(m=>m.module==='selections');if(selections&&decisions)selections.presets=decisions.map(decision=>({decision}));
}
export const seedRegistry: FormRegistry = { modules: seedModules, mappings: scopeMappings };

/** Runs validate.ts over the whole seed; throws on the first refusal. */
export function validateSeed(): { modules: ModuleDef[]; templates: TemplateDef[]; addOns: TemplateDef[] } {
  const keys = new Set<string>();
  for (const def of [...templates, ...addOns]) {
    if (keys.has(`template:${def.key}`)) throw new Error(`duplicate_template:${def.key}`);
    keys.add(`template:${def.key}`);
  }
  return {
    modules: seedModules.map((m) => validateModule(m, seedRegistry)),
    templates: templates.map((t) => validateTemplate(t, seedRegistry)),
    addOns: addOns.map((t) => validateTemplate(t, seedRegistry)),
  };
}

/** Every ⚑ rule in the seed, with the citations its text carries. */
export interface SeedFlag { key: string; module: string; field: string; when: When; issue: string; citations: string[] }
const CITATION = /(R\d{3}(?:\.\d+)*|Minn\. R\. \d+\.\d+|MN Rules \d+\.\d+|\b1346(?:\.\d+)?\b|\b1322\b|\b4714\b|\b299F\.51\b|\b745\.83\b|\b40 CFR 745\b|UPC)/g;
export const seedFlags: SeedFlag[] = seedModules.flatMap((m) => m.fields.filter((f) => f.flag).map((f) => ({
  key: `${m.key}.${f.key}`, module: m.key, field: f.key, when: f.flag!.when, issue: f.flag!.issue, citations: [...new Set(f.flag!.issue.match(CITATION) ?? [])],
})));

/** jsonb text form: keys ordered by length then bytes, ", " and ": " separators, raw UTF-8. */
export function jsonbText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non_finite_number'); return String(value); }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return escape(value);
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => byteLength(a) - byteLength(b) || compareBytes(a, b));
    return `{${entries.map(([k, v]) => `${escape(k)}: ${jsonbText(v)}`).join(', ')}}`;
  }
  throw new Error('unsupported_json_value');
}
function escape(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"'; else if (ch === '\\') out += '\\\\';
    else if (ch === '\b') out += '\\b'; else if (ch === '\f') out += '\\f'; else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r'; else if (ch === '\t') out += '\\t';
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}
const enc = new TextEncoder();
const byteLength = (s: string) => enc.encode(s).length;
function compareBytes(a: string, b: string): number {
  const x = enc.encode(a), y = enc.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** sha256 hex over `jsonbText(definition)`. Intended to equal 0075's `encode(digest(definition::text,'sha256'),'hex')`;
 *  not yet checked against Postgres — the DB stays the authority for stored checksums. */
export async function definitionChecksum(definition: ModuleDef | TemplateDef): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(jsonbText(definition)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SeedChecksum { kind: 'module' | 'template'; key: string; version: number; checksum: string }
export async function seedChecksums(): Promise<SeedChecksum[]> {
  const rows: SeedChecksum[] = [];
  for (const m of seedModules) rows.push({ kind: 'module', key: m.key, version: m.version, checksum: await definitionChecksum(m) });
  for (const t of [...templates, ...addOns]) rows.push({ kind: 'template', key: t.key, version: t.version, checksum: await definitionChecksum(t) });
  return rows;
}

export function seedCounts() {
  const fields = seedModules.flatMap((m) => m.fields);
  const shots = seedModules.flatMap((m) => [...m.shots, ...m.fields.flatMap((f) => f.shots ?? [])]);
  return {
    modules: { shared: sharedModules.length, shared_child: sharedChildModules.length, template_specific: templateModules.length, template_child: templateChildModules.length, add_on: addOnModules.length, add_on_child: addOnChildModules.length, context: contextModules.length },
    templates: templates.length, add_ons: addOns.length, fields: fields.length,
    derived_fields: fields.filter((f) => f.derive).length + derivationCases.filter((c) => c.kind === 'derived').length,
    template_derived: [...templates, ...addOns].reduce((n, t) => n + t.derived.length, 0),
    shots: shots.length, flags: seedFlags.length,
  };
}
