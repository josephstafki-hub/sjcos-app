/** Preserve the pinned form's explicit advisory kind and measured hint in every consumer. */
import type {FieldDef} from '../form-types.ts';
import {evaluatedFlags as evaluate} from '../flags.ts';
export function evaluatedFlags(field:FieldDef,address:string,values:Record<string,unknown>){
 const rules=[...(field.flag?[field.flag]:[]),...(field.flags??[])];
 return evaluate(field,address,values).map(flag=>{
  const index=flag.key===address?0:Number(flag.key.slice(address.length+1));
  const rule=rules[index] as {kind?:'code'|'advisory'}|undefined;
  return {...flag,kind:rule?.kind??flag.kind,hint:flag.hint?.replace('{value}',String(values[field.key]))};
 });
}
