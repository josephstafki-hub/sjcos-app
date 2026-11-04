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
/** "Mar 1, 2027" — the date form the rest of the screen uses (never ISO). */
export const certDate=(date:string)=>new Date(date.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
/** r10 R10-2 / domain 4: who, both dates and who acts. Split so a screen can keep each date on one line. */
export function certWarningParts(w:Pick<CertificationWarning,'who'|'expiry_date'|'planned_finish'|'field_address'>){
 const firm=w.field_address==='era.firm_cert_expiry';
 return {lead:firm?'SJC’s firm certification runs out':w.who==='The certified renovator'?'The certified renovator’s certification runs out':`${w.who}’s renovator certification runs out`,expiry:certDate(w.expiry_date),mid:'— before the planned finish,',finish:certDate(w.planned_finish),tail:firm?'Joe renews it before then. Apply at least 90 days before it runs out so it doesn’t lapse.':'Joe renews it or puts another certified renovator on the job.'};
}
export function certificationWarnings(values:Record<string,unknown>, finish?:string|null):CertificationWarning[]{
 if(!finish || !compileCondition(rrpApplies,new Set(['era.before_1978','house.year_built','era.disturbs_paint','era.window_door_replacement']))(values))return [];
 return ['era.firm_cert_expiry','era.renovator_expiry'].flatMap(key=>{
 const date=values[key]; if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=finish.slice(0,10))return [];
 const firm=key==='era.firm_cert_expiry',name=String(values['era.renovator_name']??'').trim(),who=firm?'SJC firm':name||'The certified renovator';
 const w={who,expiry_date:date,planned_finish:finish.slice(0,10),field_address:key};
 const p=certWarningParts(w);
 return [{...w,message:`${p.lead} ${p.expiry} ${p.mid} ${p.finish}. ${p.tail}`}];
 });
}

export function redeliveryWindow(start?:string|null){
 if(!start)return null;
 const offset=(days:number)=>{const d=new Date(start.slice(0,10)+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);};
 return {min:offset(60),max:offset(7)};
}
/** r11 domain Fix 1: a picked re-delivery day kept inside the window (typed dates can skip min/max). */
export function clampDay(day:string,window:{min:string;max:string}|null|undefined):string{
 if(!window||!/^\d{4}-\d{2}-\d{2}$/.test(day))return day;
 return day<window.min?window.min:day>window.max?window.max:day;
}
