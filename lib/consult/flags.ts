import type {FieldDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
import type {When} from './form-types.ts';
export function flagInputs(when:When):string[]{
 if('all' in when)return when.all.flatMap(flagInputs);
 if('any' in when)return when.any.flatMap(flagInputs);
 if('not' in when)return flagInputs(when.not);
 return [when.field];
}
export function evaluatedFlags(field:FieldDef,address:string,values:Record<string,unknown>) {
 if(typeof field.required==='object'&&!conditionMatches(field.required,key=>values[key]))return [];
 const unknownYear = field.key==='year_override_reason' && typeof values['house.year_built']!=='number';
 return [...(field.flag?[field.flag]:[]),...(field.flags??[])].flatMap((flag,index)=>
 flagInputs(flag.when).every(key=>values[key]!==undefined&&values[key]!==null&&values[key]!==''&&(!Array.isArray(values[key])||(values[key] as unknown[]).length>0))&&conditionMatches(flag.when,key=>values[key])?[{...flag,...(unknownYear?{issue:'No year on record and the pre-1978 answer is No — write how we know before closing',hint:'How do we know it was built in 1978 or later? Write down how we know.'}:{}),key:index?`${address}:${index}`:address}]:[]);
}
