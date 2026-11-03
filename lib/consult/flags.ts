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
 const unknownYear = field.key==='year_override_reason' && typeof values['house.year_built']!=='number';
 return [...(field.flag?[field.flag]:[]),...(field.flags??[])].flatMap((flag,index)=>
 Object.values(values).some(v=>v!==undefined&&v!==null&&v!=='')&&matches(flag.when,values)?[{...flag,...(field.key==='toilet_front_clearance'&&values['toilet_plan']==='Keep'?{hint:"Less than 24″ in front of the toilet. It’s staying where it is, so Joe decides whether it needs to change."}:{}),kind:field.key==='toilet_front_clearance'&&values['toilet_plan']==='Keep'?'advisory':'code',...(unknownYear?{issue:'No year on record and the pre-1978 answer is No — write how we know before closing',hint:'How do we know it was built in 1978 or later? Write down how we know.'}:{}),key:index?`${address}:${index}`:address}]:[]);
}
