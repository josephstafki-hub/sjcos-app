import { selectionDecisions } from './forms/seed/templates.ts';
import type { TemplateDef, When } from './form-types.ts';
/** Preserve pinned definitions; required conditions are ORed, area counts accumulate. */
export function mergeTemplateModules(templates: TemplateDef[], values: Record<string,unknown> = {}) {
 const result: TemplateDef['modules'] = [];
 for (const t of templates) for (const entry of t.modules) {
  const old = result.find(x => x.module === entry.module);
  const presets = entry.presets?.map(p => ({...p, ...(p.decision ? {decision: `${t.title === 'Bathroom' ? 'Bath' : t.title} — ${p.decision}`} : {})}));
  if (!old) { result.push({...entry, presets}); continue; }
  const conditions = [old.required, entry.required];
  old.required = conditions.includes(true) ? true : conditions.every(c => c === false) ? false : {any: conditions.filter(c => typeof c !== 'boolean') as When[]};
  old.min = ['room','plumb_fixture','door','selections'].includes(entry.module) ? (old.min ?? 0) + (entry.min ?? 0) : Math.max(old.min ?? 0, entry.min ?? 0);
  old.presets = [...(old.presets ?? []), ...(presets ?? [])];
 }
 const wanted=values['basement_scope.rooms_wanted'];
 if(templates.some(t=>t.key==='basement')&&Array.isArray(wanted)&&wanted.includes('Bath')){const slot=result.find(x=>x.module==='selections');if(slot){const extra=selectionDecisions.bath.map(decision=>({decision:`Basement bath — ${decision}`}));slot.presets=[...(slot.presets??[]),...extra];slot.min=(slot.min??0)+extra.length;}}
 return result;
}
