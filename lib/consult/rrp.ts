import type {When} from './form-types.ts';
import {compileCondition} from './forms/conditions.ts';
const eq = (field:string,value:unknown):When => ({field,op:'eq',value});
const answered = (field:string):When => ({field,op:'answered'});
export const rrpBefore: When = {any:[eq('era.before_1978',true),{all:[{not:answered('era.before_1978')},{not:{field:'house.year_built',op:'gt',value:1977}}]}]};
export const rrpYearConflict: When = {all:[eq('era.before_1978',false),{not:{field:'house.year_built',op:'gt',value:1977}}]};
export const rrpApplies: When = {all:[rrpBefore,{any:[{not:eq('era.disturbs_paint',false)},eq('era.window_door_replacement',true)]}]};
/** Derive the legal close gate from captured facts, never from wrap-sheet checkboxes. */
export function rrpFacts(values: Record<string, unknown>, initials: boolean, visitDate: string, plannedStart?: string | null) {
 const applies = compileCondition(rrpApplies,new Set(['era.before_1978','house.year_built','era.disturbs_paint','era.window_door_replacement']))(values);
 const day = [visitDate.slice(0,10), plannedStart?.slice(0,10) ?? ''].sort().at(-1)!;
 const current = (key: string) => typeof values[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(values[key] as string) && (values[key] as string) >= day;
 return { applies, receipt: values['era.pamphlet_given'] === true && initials, firm_current: current('era.firm_cert_expiry'), renovator_current: current('era.renovator_expiry') };
}

/** Advisory only: expiry during the planned job never changes the close gate. */
export interface CertificationWarning { who:string; expiry_date:string; planned_finish:string; field_address:string; message:string }
export function certificationWarnings(values:Record<string,unknown>, finish?:string|null):CertificationWarning[]{
 if(!finish || !compileCondition(rrpApplies,new Set(['era.before_1978','house.year_built','era.disturbs_paint','era.window_door_replacement']))(values))return [];
 const format=(date:string)=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
 return ['era.firm_cert_expiry','era.renovator_expiry'].flatMap(key=>{
 const date=values[key]; if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=finish.slice(0,10))return [];
 const firm=key==='era.firm_cert_expiry',who=firm?'SJC firm':String(values['era.renovator_name']||'Assigned renovator');
 return [{who,expiry_date:date,planned_finish:finish.slice(0,10),field_address:key,message:`${firm?who:'Certified renovator ('+who+')'} certification runs out ${format(date)} — before the planned finish, ${format(finish.slice(0,10))}. Joe ${firm?'renews it before then.':'renews it or assigns another renovator.'}`}];
 });
}
