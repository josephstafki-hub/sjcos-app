// Builders for the executable in-home consultation seed (plan §7.1).
// Pure data helpers: nothing here evaluates a formula or a condition.
import type { AtomicWhen, FieldDef, FieldType, ShotDef, Unit, When } from '../../form-types.ts';

export type Req = boolean | When;
type Extra = Partial<Omit<FieldDef, 'key' | 'label' | 'type' | 'required'>>;

/** Tier rule (§7.1 "Required tiers"): every R/R? row is Price-critical unless the
 *  plan lists it as Record; O rows are optional and carry the Record tier unless
 *  an `extra.tier` says otherwise; derived rows feed quantities and are Price-critical. */
const tierFor = (required: Req): FieldDef['tier'] => (required === false ? 'record' : 'price_critical');

export function field(key: string, label: string, type: FieldType, required: Req, extra: Extra = {}): FieldDef {
  const def: FieldDef = { key, label, type, required, tier: tierFor(required), ...extra };
  for (const k of Object.keys(def) as (keyof FieldDef)[]) if (def[k] === undefined) delete def[k];
  return def;
}
export const text = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'text', required, extra);
export const yesno = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'yesno', required, extra);
export const count = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'count', required, { unit: 'ea', ...extra });
export const num = (key: string, label: string, unit: Unit | undefined, required: Req, extra: Extra = {}) => field(key, label, 'number', required, { unit, ...extra });
export const year = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'year', required, extra);
export const date = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'date', required, extra);
export const signature = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'signature', required, extra);
export const len = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'length', required, { unit: 'in', ...extra });
export const pair = (key: string, label: string, required: Req, extra: Extra = {}) => field(key, label, 'length_pair', required, { unit: 'in', ...extra });
export const choice = (key: string, label: string, options: string[], required: Req, extra: Extra = {}) => field(key, label, 'choice', required, { options, ...extra });
export const multi = (key: string, label: string, options: string[], required: Req, extra: Extra = {}) => field(key, label, 'multi', required, { options, ...extra });
/** A derived row (plan "derived" / "Derived"): never typed, never required, Price-critical. */
export const derived = (key: string, label: string, type: FieldType, derive: string, extra: Extra = {}) =>
  field(key, label, type, false, { derive, tier: 'price_critical', ...extra });

/** A derived row whose value comes from `derivationCases` (branches, yes/no tests, indicators) — no `derive`
 *  string because formula.ts has no comparisons or branches. Never typed, never required. */
export const caseField = (key: string, label: string, type: FieldType, extra: Extra = {}) =>
  field(key, label, type, false, { tier: 'price_critical', help: 'Derived — not asked; value from the seed derivation cases', ...extra });

/** Every shot is Price-critical (§7.1: "Shots … are always Price-critical"). */
export const shot = (key: string, label: string, required: Req, hint?: string): ShotDef => {
  const s: ShotDef = { key, label, required, tier: 'price_critical' };
  if (hint) s.hint = hint;
  return s;
};

// Condition AST helpers (compiled by forms/conditions.ts; data only).
export const eq = (field: string, value: unknown): AtomicWhen => ({ field, op: 'eq', value });
export const ne = (field: string, value: unknown): AtomicWhen => ({ field, op: 'ne', value });
export const isIn = (field: string, value: unknown[]): AtomicWhen => ({ field, op: 'in', value });
export const lt = (field: string, value: number): AtomicWhen => ({ field, op: 'lt', value });
export const gt = (field: string, value: number): AtomicWhen => ({ field, op: 'gt', value });
export const answered = (field: string): AtomicWhen => ({ field, op: 'answered' });
export const all = (...nodes: When[]): When => ({ all: nodes });
export const any = (...nodes: When[]): When => ({ any: nodes });
export const not = (node: When): When => ({ not: node });

/** "template ∈ …" — the consult's pinned templates (whole-home includes the nested area templates it was scheduled with). */
export const tpl = (...keys: string[]): AtomicWhen => isIn('visit.templates', keys);
/** Add-on ticked at scheduling. */
export const addon = (...keys: string[]): AtomicWhen => isIn('visit.add_ons', keys);

/** "tile floor" (structure, room): a new tile floor — the bath template (plan §7.4 `structure` R (tile floor)). */
export const tileFloor: When = tpl('bath');
/** "wall removal" (structure): walls listed in Structure or Kitchen › Walls to open. */
export const wallRemoval = (sibling = 'structure.walls_to_remove'): When => any(answered(sibling), answered('kitchen_scope.walls_to_open'));
