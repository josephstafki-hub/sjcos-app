import type {FieldDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
import type {When} from './form-types.ts';
export function flagInputs(when:When):string[]{
 if('all' in when)return when.all.flatMap(flagInputs);
 if('any' in when)return when.any.flatMap(flagInputs);
 if('not' in when)return flagInputs(when.not);
 return [when.field];
}
function matches(when:When, values:Record<string,unknown>):boolean {
 if('all' in when)return when.all.every(w=>matches(w,values));
 if('any' in when)return when.any.some(w=>matches(w,values));
 if('not' in when){
  if('field' in when.not && when.not.op==='answered')return !conditionMatches(when.not,k=>values[k]);
  return flagInputs(when.not).some(k=>values[k]!==undefined&&values[k]!==null)&&!matches(when.not,values);
 }
 const v=values[when.field];
 return v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length>0)&&conditionMatches(when,k=>values[k]);
}
export function evaluatedFlags(field:FieldDef,address:string,values:Record<string,unknown>) {
 if(typeof field.required==='object'&&!conditionMatches(field.required,key=>values[key]))return [];
 const fixturePlans = Array.isArray(values['toilet_fixture_plans']) ? values['toilet_fixture_plans'] : [];
 const plan = fixturePlans.find(p=>p!=='Keep') ?? values['toilet_plan'];
 if(field.key==='toilet_front_clearance' && plan==='Remove')return [];
 const keptToilet = values['toilet_plan']==='Keep' && (!Array.isArray(values['toilet_fixture_plans']) || values['toilet_fixture_plans'].every(p=>p==='Keep'));
 const unknownYear = field.key==='year_override_reason' && typeof values['house.year_built']!=='number';
 return [...(field.flag?[field.flag]:[]),...(field.flags??[])].flatMap((flag,index)=>
 Object.values(values).some(v=>v!==undefined&&v!==null&&v!=='')&&matches(flag.when,values)?[{...flag,...(field.key==='toilet_front_clearance'&&keptToilet?{hint:"Less than 24″ in front of the toilet. It’s staying where it is, so the code doesn’t force a change. Pick ‘Not an issue’ if it stays, or ‘Price it’ if the client wants it moved."}:field.key==='toilet_front_clearance'?{hint:`Less than 24″ in front of the toilet — ${plan==='Move'?'at its new spot':plan==='Replace'?'the replacement toilet':'a new toilet'} needs at least 24″ (Minnesota plumbing code).`}:{}),kind:field.key==='toilet_front_clearance'&&keptToilet?'advisory':'code',...(unknownYear?{issue:'No year on record and the pre-1978 answer is No — write how we know before closing',hint:'How do we know it was built in 1978 or later? Write down how we know.'}:{}),key:index?`${address}:${index}`:address}]:[]);
}

export function sameBathroom(bath:{id:string;parent_id:string|null},fixture:{parent_id:string|null}):boolean {
 return fixture.parent_id===bath.id || (bath.parent_id!==null && fixture.parent_id===bath.parent_id);
}
