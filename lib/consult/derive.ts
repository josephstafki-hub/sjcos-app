/** Resolve pinned arithmetic with answer provenance. Qualified repeated dimensions
 * are ambiguous; only disjoint area/run/count references may aggregate. */
import type {ModuleDef,TemplateDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
import {canonicalJson} from './queue.ts';
import {seedModules,derivationCases} from './forms/seed.ts';
import {evaluateFormula,formulaReferences} from './forms/formula.ts';
type Instance={id:string;module_key:string;parent_id?:string|null};
type Answer={id:string;instance_id:string;field_key:string;status:string;value:unknown;server_revision:string};
export type DerivedValue={value:number;instance_ids:string[];answer_revisions:number[]};
export function pinnedDerivations(modules:ModuleDef[],templates:TemplateDef[],instances:Instance[],answers:Answer[]){
 const cache=new Map<string,DerivedValue|null>(),visiting=new Set<string>();
 const merge=(rows:DerivedValue[],value:number):DerivedValue=>({value,instance_ids:[...new Set(rows.flatMap(r=>r.instance_ids))].sort(),answer_revisions:[...new Set(rows.flatMap(r=>r.answer_revisions))].sort((a,b)=>a-b)});
 function field(instance:Instance,key:string):DerivedValue|null{
  const address=`${instance.id}:${key}`;if(cache.has(address))return cache.get(address)!;if(visiting.has(address))return null;visiting.add(address);
  const def=modules.find(m=>m.key===instance.module_key)?.fields.find(f=>f.key===key),a=answers.find(a=>a.instance_id===instance.id&&a.field_key===key&&a.status==='answered');
  let result:DerivedValue|null=null;
  if(a&&typeof a.value==='number'&&Number.isFinite(a.value))result={value:a.value,instance_ids:[instance.id],answer_revisions:[Number(a.server_revision)]};
  else if(def?.derive)result=formula(def.derive,instance);
  else if(def&&modules.some(m=>m.key===instance.module_key&&seedModules.some(seed=>canonicalJson(seed)===canonicalJson(m)))){
   const rule=derivationCases.find(d=>d.kind==='derived'&&d.module===instance.module_key&&d.field===key);
   const choice=rule?.cases.find(c=>conditionMatches(c.when,ref=>{
    if(ref.includes('.')){const [module,field]=ref.split('.');const rows=instances.filter(i=>i.module_key===module).flatMap(i=>answers.filter(a=>a.instance_id===i.id&&a.field_key===field&&a.status==='answered'));return rows.length===1?rows[0].value:reference(ref,instance)?.value;}
    return answers.find(a=>a.instance_id===instance.id&&a.field_key===ref&&a.status==='answered')?.value??field(instance,ref)?.value;
   }));
   if(choice&&'formula' in choice)result=formula(choice.formula,instance);
  }
  visiting.delete(address);cache.set(address,result);return result;
 }
 const known=new Set(modules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`])));
 function reference(ref:string,instance?:Instance):DerivedValue|null{
  if(!ref.includes('.'))return instance?field(instance,ref):null;
  const [module,key]=ref.split('.');let candidates=instances.filter(i=>i.module_key===module);
  if(instance){const related=candidates.filter(i=>i.id===instance.parent_id||i.parent_id===instance.id);if(related.length)candidates=related;}
  const rows=candidates.map(i=>field(i,key));if(!rows.length||rows.some(r=>!r))return null;
  if(rows.length>1&&!['sf','lf','ea'].includes(modules.find(m=>m.key===module)?.fields.find(f=>f.key===key)?.unit??''))return null;
  return merge(rows as DerivedValue[],rows.reduce((n,r)=>n+r!.value,0));
 }
 function formula(expression:string,instance?:Instance):DerivedValue|null{
  const refs=formulaReferences(expression,known),rows=refs.map(r=>reference(r,instance));if(rows.some(r=>!r))return null;
  const value=evaluateFormula(expression,Object.fromEntries(refs.map((r,i)=>[r,rows[i]!.value])));return value===null?null:merge(rows as DerivedValue[],value);
 }
 for(const i of instances)for(const f of modules.find(m=>m.key===i.module_key)?.fields??[])field(i,f.key);
 const derived=templates.flatMap(t=>t.derived.map(d=>({definition:d,result:formula(d.formula)})));
 return {field,derived};
}
