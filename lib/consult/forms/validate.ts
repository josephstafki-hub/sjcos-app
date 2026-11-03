import { z } from 'zod';
import { compileCondition } from './conditions.ts';
import type { ModuleDef, TemplateDef, When } from '../form-types.ts';
const key = z.string().regex(/^[a-z][a-z0-9_]*$/);
const text = z.string().trim().min(1);
const unit = z.enum(['in','sf','lf','ea','amp','gal','cfm','pct','psi','pitch','V','BTU/h','ton','lb']);
const tier = z.enum(['price_critical','record']);
const atomicWhenSchema = z.strictObject({ field:text,op:z.enum(['eq','ne','in','lt','gt','answered']),value:z.unknown().optional() }).superRefine((v,ctx)=>{
  if(v.op!=='answered' && v.value===undefined)ctx.addIssue({code:'custom',message:'Condition needs a value'});
  if(v.op==='in' && !Array.isArray(v.value))ctx.addIssue({code:'custom',message:'in needs a list'});
  if((v.op==='lt'||v.op==='gt') && (typeof v.value!=='number'||!Number.isFinite(v.value)))ctx.addIssue({code:'custom',message:'Comparison needs a number'});
});
export const whenSchema: z.ZodType<When> = z.lazy(() => z.union([
 atomicWhenSchema,
 z.strictObject({all:z.array(whenSchema).min(1).max(256)}),
 z.strictObject({any:z.array(whenSchema).min(1).max(256)}),
 z.strictObject({not:whenSchema}),
]));
const required=z.union([z.boolean(),whenSchema]);
export const mappingSchema=z.strictObject({scope_key:text,quantity_label:text.optional(),kind:z.enum(['measurement','observation','client_answer','decision','issue','new_work','photo'])});
export const shotSchema=z.strictObject({key,label:text,required,tier,hint:text.optional()});
export const fieldSchema=z.strictObject({
 key,label:text,type:z.enum(['length','length_pair','count','number','choice','multi','yesno','text','year','date','signature']),unit:unit.optional(),
 range:z.tuple([z.number().finite(),z.number().finite()]).optional(),warn:z.strictObject({below:z.number().finite().optional(),above:z.number().finite().optional(),text}).optional(),
 precision:z.union([z.literal(0.0625),z.literal(0.125),z.literal(0.25),z.literal(0.5),z.literal(1)]).optional(),options:z.array(text).min(1).optional(),
 required,tier,say:text.optional(),help:text.optional(),shots:z.array(shotSchema).optional(),derive:text.optional(),
 flag:z.strictObject({when:whenSchema,issue:text}).optional(),maps_to:mappingSchema.optional(),
}).superRefine((v,ctx)=>{
 if(v.range && v.range[0]>v.range[1])ctx.addIssue({code:'custom',message:'Reversed range'});
 if((v.type==='choice'||v.type==='multi') && (!v.options?.length || new Set(v.options).size!==v.options.length))ctx.addIssue({code:'custom',message:'Choices need distinct options'});
 if((v.type==='length'||v.type==='length_pair') && v.unit!=='in')ctx.addIssue({code:'custom',message:'Lengths store inches'});
 if(v.maps_to?.kind==='measurement' && !v.maps_to.quantity_label)ctx.addIssue({code:'custom',message:'Measurements need a registered quantity label'});
});
export const moduleSchema=z.strictObject({key,version:z.number().int().positive(),title:text,repeatable:z.boolean(),instance_label:text.optional(),say:z.array(text),fields:z.array(fieldSchema),shots:z.array(shotSchema),coverage:z.array(z.strictObject({key,text,satisfied_by:z.array(key).min(1)}))});
export const templateSchema=z.strictObject({key,version:z.number().int().positive(),title:text,opening:z.array(text),closing:z.array(text),modules:z.array(z.strictObject({module:key,required,min:z.number().int().nonnegative().optional(),label:text.optional()})).min(1),derived:z.array(z.strictObject({key,label:text,formula:text,maps_to:mappingSchema.optional()}))});
export interface FormRegistry { modules:readonly ModuleDef[]; mappings:Readonly<Record<string,readonly string[]>> }
export function validateModule(value:unknown, registry:FormRegistry):ModuleDef {
 const module=moduleSchema.parse(value);
 const fields=new Set(module.fields.map(f=>f.key));
 if(fields.size!==module.fields.length)throw new Error('duplicate_field_key');
 const shots=[...module.shots,...module.fields.flatMap(f=>f.shots??[])];
 if(new Set(shots.map(s=>s.key)).size!==shots.length)throw new Error('duplicate_shot_key');
 if(new Set(module.coverage.map(c=>c.key)).size!==module.coverage.length)throw new Error('duplicate_coverage_key');
 for(const item of module.coverage)if(item.satisfied_by.some(k=>!fields.has(k)))throw new Error('unknown_coverage_field');
 const knownFields=new Set([...fields,...registry.modules.flatMap(m=>m.fields.map(f=>`${m.key}.${f.key}`))]);
 const validateCondition=(v:boolean|When)=>{compileCondition(v,knownFields);};
 for(const field of module.fields){validateCondition(field.required);if(field.flag)validateCondition(field.flag.when);validateMapping(field.maps_to,registry);}
 for(const shot of shots)validateCondition(shot.required);
 return module;
}
function validateMapping(mapping:ModuleDef['fields'][number]['maps_to'],registry:FormRegistry) {
 if(!mapping)return;
 const labels=registry.mappings[mapping.scope_key];
 if(!labels || (mapping.quantity_label && !labels.includes(mapping.quantity_label)))throw new Error('unknown_scope_mapping');
}
export function validateTemplate(value:unknown,registry:FormRegistry):TemplateDef {
 const template=templateSchema.parse(value);
 if(new Set(template.modules.map(m=>m.module)).size!==template.modules.length)throw new Error('duplicate_module_key');
 for(const item of template.modules)if(!registry.modules.some(m=>m.key===item.module))throw new Error('unknown_module');
 const known=new Set(registry.modules.flatMap(m=>m.fields.map(f=>`${m.key}.${f.key}`)));
 for(const item of template.modules)compileCondition(item.required,known);
 for(const derived of template.derived)validateMapping(derived.maps_to,registry);
 return {...template,derived:template.derived.map(d=>({...d,maps_to:d.maps_to}))};
}
