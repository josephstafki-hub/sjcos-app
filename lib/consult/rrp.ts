import type {When} from './form-types.ts';
import {compileCondition} from './forms/conditions.ts';
const eq = (field:string,value:unknown):When => ({field,op:'eq',value});
const answered = (field:string):When => ({field,op:'answered'});
export const rrpBefore: When = {any:[eq('era.before_1978',true),{all:[{not:answered('era.before_1978')},{field:'house.year_built',op:'lt',value:1978}]}]};
export const rrpYearConflict: When = {all:[eq('era.before_1978',false),{field:'house.year_built',op:'lt',value:1978}]};
export const rrpApplies: When = {all:[rrpBefore,{any:[{not:eq('era.disturbs_paint',false)},eq('era.window_door_replacement',true)]}]};
/** Derive the legal close gate from captured facts, never from wrap-sheet checkboxes. */
export function rrpFacts(values: Record<string, unknown>, initials: boolean, visitDate: string, plannedStart?: string | null) {
 const applies = compileCondition(rrpApplies,new Set(['era.before_1978','house.year_built','era.disturbs_paint','era.window_door_replacement']))(values);
 const day = [visitDate.slice(0,10), plannedStart?.slice(0,10) ?? ''].sort().at(-1)!;
 const current = (key: string) => typeof values[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(values[key] as string) && (values[key] as string) >= day;
 return { applies, receipt: values['era.pamphlet_given'] === true && initials, firm_current: current('era.firm_cert_expiry'), renovator_current: current('era.renovator_expiry') };
}
