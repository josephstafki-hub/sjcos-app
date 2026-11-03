import type {FieldDef} from './form-types.ts';
import {conditionMatches} from './completeness.ts';
export function evaluatedFlags(field:FieldDef,address:string,values:Record<string,unknown>) {
 return [...(field.flag?[field.flag]:[]),...(field.flags??[])].flatMap((flag,index)=>
 conditionMatches(flag.when,key=>values[key])?[{...flag,key:index?`${address}:${index}`:address}]:[]);
}
