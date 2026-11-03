import type {FieldDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
export function evaluatedFlags(field:FieldDef,address:string,values:Record<string,unknown>) {
 const unknownYear = field.key==='year_override_reason' && typeof values['house.year_built']!=='number';
 return [...(field.flag?[field.flag]:[]),...(field.flags??[])].flatMap((flag,index)=>
 conditionMatches(flag.when,key=>values[key])?[{...flag,...(unknownYear?{issue:'No year on record and the pre-1978 answer is No — write how we know before closing',hint:'How do we know it was built in 1978 or later? Write down how we know.'}:{}),key:index?`${address}:${index}`:address}]:[]);
}
