/** Pinned formulas evaluate additive repeat terms per live row, with provenance. */
import type {ModuleDef,TemplateDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
import {canonicalJson} from './queue.ts';
import {seedModules,derivationCases} from './forms/seed.ts';
import {evaluateFormula,formulaReferences,formulaTerms} from './forms/formula.ts';
type Instance={id:string;module_key:string;parent_id?:string|null;removed_at?:string|null};
type Answer={id:string;instance_id:string;field_key:string;status:string;value:unknown;server_revision:string};
export type DerivedValue={value:number;instance_ids:string[];answer_revisions:number[]};
export function pinnedDerivations(modules:ModuleDef[],templates:TemplateDef[],allInstances:Instance[],answers:Answer[]){
 const instances=allInstances.filter(i=>!i.removed_at),cache=new Map<string,DerivedValue|null>(),visiting=new Set<string>();
 let activeTemplate:string|undefined;
 const membership=modules.some(m=>m.key==='room'&&m.fields.some(f=>f.key==='part_of'));
 const scopeTemplate=(i?:Instance)=>i?.module_key.endsWith('_scope')?i.module_key.slice(0,-6):undefined;
 const roomAllowed=(i:Instance,key=activeTemplate)=>i.module_key!=='room'||templates.length===1||!membership||!key||answers.some(a=>a.instance_id===i.id&&a.field_key==='part_of'&&a.status==='answered'&&Array.isArray(a.value)&&a.value.includes(templates.find(t=>t.key===key)?.title));
 const merge=(rows:DerivedValue[],value:number):DerivedValue=>({value,instance_ids:[...new Set(rows.flatMap(r=>r.instance_ids))].sort(),answer_revisions:[...new Set(rows.flatMap(r=>r.answer_revisions))].sort((a,b)=>a-b)});
 const zero=()=>merge([],0);
 function raw(ref:string,instance:Instance):unknown{
  if(ref==='visit.template_count')return templates.length;
  if(ref==='visit.templates')return templates.map(t=>t.key).filter(k=>!['garage','openings','flooring'].includes(k));
  if(ref==='visit.add_ons')return templates.map(t=>t.key).filter(k=>['garage','openings','flooring'].includes(k));
  const parts=ref.split('.');const candidates=parts.length===1?[instance]:instances.filter(i=>i.module_key===parts[0]);const key=parts.at(-1)!;
  const values=candidates.flatMap(i=>answers.filter(a=>a.instance_id===i.id&&a.field_key===key&&a.status==='answered').map(a=>a.value));
  return values.length===1?values[0]:values.length?values:undefined;
 }
 function field(instance:Instance,key:string,part?:string):DerivedValue|null{
  const address=`${activeTemplate??(scopeTemplate(instance)??'')}:${instance.id}:${key}:${part??''}`;if(cache.has(address))return cache.get(address)!;if(visiting.has(address))return null;visiting.add(address);
  const module=modules.find(m=>m.key===instance.module_key),def=module?.fields.find(f=>f.key===key),a=answers.find(a=>a.instance_id===instance.id&&a.field_key===key&&a.status==='answered');
  let result:DerivedValue|null=null;
  // Optional unconditional fields still carry evidence. Only false conditional applicability is zero.
  if(def&&typeof def.required==='object'&&!conditionMatches(def.required,r=>raw(r,instance)))result=zero();
  else if(a){let value=a.value;if(def?.type==='length_pair'&&Array.isArray(value)&&value.length===2)value=part?value[part==='w'?0:1]:value[0]*value[1];if(typeof value==='number'&&Number.isFinite(value))result={value,instance_ids:[instance.id],answer_revisions:[Number(a.server_revision)]};}
  if(!result&&def?.derive)result=formula(def.derive,instance);
  else if(!result&&def){
   const seed=module&&seedModules.some(s=>canonicalJson(s)===canonicalJson(module));
   const cases=def.derive_cases??(seed?derivationCases.find(d=>d.kind==='derived'&&d.module===instance.module_key&&d.field===key)?.cases:undefined);
   const choice=cases?.find(c=>conditionMatches(c.when,r=>raw(r,instance)??reference(r,instance)?.value));
   if(choice&&'formula' in choice)result=formula(choice.formula,instance);
  }
  visiting.delete(address);cache.set(address,result);return result;
 }
 const scalarVisiting=new Set<string>();
 function scalar(instance:Instance,key:string):unknown{
  const address=`${instance.id}:${key}`;if(scalarVisiting.has(address))return undefined;scalarVisiting.add(address);
  try{
   const answer=answers.find(a=>a.instance_id===instance.id&&a.field_key===key&&a.status==='answered');if(answer)return answer.value;if(instance.module_key==='visit'&&key==='template_count')return templates.length;
   const module=modules.find(m=>m.key===instance.module_key),def=module?.fields.find(f=>f.key===key);if(!def)return undefined;
   if(typeof def.required==='object'&&!conditionMatches(def.required,r=>raw(r,instance)))return undefined;
   const cases=def.derive_cases??(module&&seedModules.some(s=>canonicalJson(s)===canonicalJson(module))?derivationCases.find(d=>d.module===module.key&&d.field===key)?.cases:undefined);
   const choice=cases?.find(c=>conditionMatches(c.when,ref=>{
    const direct=raw(ref,instance);if(direct!==undefined)return direct;
    if(!ref.includes('.'))return scalar(instance,ref);
    const [m,f]=ref.split('.'),values=instances.filter(i=>i.module_key===m).map(i=>scalar(i,f)).filter(v=>v!==undefined);return values.length===1?values[0]:values.length?values:undefined;
   }));
   if(choice&&'value' in choice)return choice.value;
   return field(instance,key)?.value;
  }finally{scalarVisiting.delete(address);}
 }
 const known=new Set(modules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`,...(f.type==='length_pair'?[`${f.key}.w`,`${f.key}.h`,`${m.key}.${f.key}.w`,`${m.key}.${f.key}.h`]:[])])));
 function reference(ref:string,instance?:Instance):DerivedValue|null{
  const parts=ref.split('.');if(parts.length===1)return instance?field(instance,ref):null;
  if(instance&&['w','h'].includes(parts[1]))return field(instance,parts[0],parts[1]);
  const [module,key,part]=parts;let candidates=instances.filter(i=>i.module_key===module&&roomAllowed(i,activeTemplate??scopeTemplate(instance)));
  if(instance){if(instance.module_key===module)candidates=[instance];else {const related=candidates.filter(i=>i.id===instance.parent_id||i.parent_id===instance.id);if(related.length)candidates=related;}}
  if(candidates.length>1&&!modules.find(m=>m.key===module)?.repeatable&&!['sf','lf','ea'].includes(modules.find(m=>m.key===module)?.fields.find(f=>f.key===key)?.unit??''))return null;
  const rows=candidates.map(i=>field(i,key,part));if(!rows.length)return zero();if(rows.some(r=>!r))return null;
  return merge(rows as DerivedValue[],module==='room'&&key==='ceiling_height'?Math.max(...rows.map(r=>r!.value)):rows.reduce((n,r)=>n+r!.value,0));
 }
 function formula(expression:string,instance?:Instance):DerivedValue|null{
  const results:DerivedValue[]=[];
  for(const term of formulaTerms(expression)){
   const refs=formulaReferences(term,known);
   const repeated=[...new Set(refs.map(r=>r.split('.')[0]).filter(k=>modules.some(m=>m.key===k&&m.repeatable)&&!(k==='room'&&refs.filter(r=>r.startsWith('room.')).every(r=>r==='room.ceiling_height'))))];
   if(repeated.length>1)return null;
   const contexts=repeated.length&&instance?.module_key!==repeated[0]?instances.filter(i=>i.module_key===repeated[0]&&roomAllowed(i,activeTemplate??scopeTemplate(instance))&&(!instance||!instances.some(j=>j.module_key===repeated[0]&&j.parent_id===instance.id)||i.parent_id===instance.id)):[instance];
   for(const context of contexts){const rows=refs.map(r=>reference(r,context));const value=evaluateFormula(term,Object.fromEntries(refs.map((r,i)=>[r,rows[i]?.value])));if(value===null)return null;results.push(merge(rows.filter((r):r is DerivedValue=>!!r),value));}
  }return merge(results,Math.round(results.reduce((n,r)=>n+r.value,0)*10000)/10000);
 }
 for(const i of instances)for(const f of modules.find(m=>m.key===i.module_key)?.fields??[])field(i,f.key);
 const derived=templates.flatMap(t=>t.derived.map(d=>{activeTemplate=t.key;return {definition:d,result:formula(d.formula)};}));
 activeTemplate=undefined;
 return {field,scalar,derived};
}
