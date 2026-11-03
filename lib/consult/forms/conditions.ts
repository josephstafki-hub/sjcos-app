/** Conditions contain data only. Compilation never evaluates supplied JavaScript. */
import type { When } from '../form-types.ts';
export type Condition = When;
export type ConditionValues = Readonly<Record<string, unknown>>;
export function compileCondition(condition: boolean | Condition, knownFields: ReadonlySet<string>): (values: ConditionValues) => boolean {
 let nodes = 0;
 function compile(node: boolean | Condition, depth: number): (values: ConditionValues) => boolean {
  if (++nodes > 256 || depth > 16) throw new Error('condition_too_complex');
  if (typeof node === 'boolean') return () => node;
  if (!node || typeof node !== 'object') throw new Error('invalid_condition');
  if ('all' in node || 'any' in node) {
   const all = 'all' in node;
   const children = all ? node.all : (node as {any: Condition[]}).any;
   if (Object.keys(node).length !== 1 || !Array.isArray(children) || !children.length) throw new Error('invalid_condition');
   const checks = children.map(child => compile(child, depth + 1));
   return values => all ? checks.every(check => check(values)) : checks.some(check => check(values));
  }
  if ('not' in node) {
   if (Object.keys(node).length !== 1) throw new Error('invalid_condition');
   const check = compile(node.not, depth + 1); return values => !check(values);
  }
  if (!knownFields.has(node.field)) throw new Error(`unknown_condition_field:${node.field}`);
  if (Object.keys(node).some(key => !['field','op','value'].includes(key))) throw new Error('invalid_condition');
  const {field, op, value} = node;
  if (!['eq','ne','in','lt','gt','answered'].includes(op)) throw new Error('invalid_condition');
  if (op !== 'answered' && value === undefined) throw new Error('condition_value_required');
  if (op === 'in' && !Array.isArray(value)) throw new Error('condition_list_required');
  if ((op === 'lt' || op === 'gt') && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('condition_number_required');
  return values => {
   const actual = Object.hasOwn(values,field) ? values[field] : undefined;
   // Unknown inputs never turn on a conditional requirement, including !=.
   if (actual === undefined || actual === null) return false;
   const check = (actual:unknown):boolean => { switch(op) {
    case 'answered': return actual !== '';
    case 'eq': return actual === value;
    case 'ne': return actual !== value;
    case 'in': {const contains=(a:unknown):boolean=>Array.isArray(a)?a.some(contains):(value as unknown[]).includes(a);return contains(actual);}
    case 'lt': return typeof actual === 'number' && Number.isFinite(actual) && actual < (value as number);
    case 'gt': return typeof actual === 'number' && Number.isFinite(actual) && actual > (value as number);
   } };
   return Array.isArray(actual)&&op!=='in'?actual.some(check):check(actual);
  };
 }
 return compile(condition,0);
}
