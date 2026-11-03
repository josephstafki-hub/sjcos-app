import { z } from 'zod';
import type { ConsultScopeFactsV1 } from './scope-facts.ts';
const uuid=z.uuid().refine(v=>v===v.toLowerCase(),'UUID must be lowercase');
const text=z.string();
const unit=z.enum(['in','sf','lf','ea']);
const safe=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uniqueSorted=(values:readonly string[])=>values.every((v,i)=>i===0 || values[i-1]<v);
const date=z.iso.date();
const utc=z.iso.datetime();
export const consultScopeFactsV1Schema:z.ZodType<ConsultScopeFactsV1>=z.strictObject({
 schema_version:z.literal(1),project_id:uuid,scope_key:z.string().min(1),state:z.enum(['reviewed','unreviewed','conflicted','none']),
 source_version:z.strictObject({consult_id:uuid,review_revision:safe,form_checksums:z.array(z.string().regex(/^[0-9a-f]{64}$/)).refine(uniqueSorted),aggregate_hash:z.string().regex(/^[0-9a-f]{64}$/)}).nullable(),
 measurements:z.array(z.strictObject({key:text,label:text,value:z.number().finite(),unit,instance_ids:z.array(uuid).refine(uniqueSorted),answer_revisions:z.array(safe).refine(v=>v.every((n,i)=>i===0||v[i-1]<=n))})),
 conditions:z.array(z.strictObject({key:text,text,source_answer_id:uuid})),
 flags:z.array(z.strictObject({key:text,text,disposition:z.enum(['price_it','allowance','sub_must_look','not_an_issue']).nullable(),reason:text.nullable(),decided_by:uuid.nullable(),decided_at:utc.nullable()})),
 photos:z.array(z.strictObject({file_id:text,shot_key:text,instance_id:uuid,caption:text})),
 assumptions:z.array(z.strictObject({field_path:text,text,quantity:z.number().finite().nullable(),unit:unit.nullable(),responsible_trade:text,verification_point:text})),
 exclusions:z.array(z.strictObject({text,source_answer_id:uuid})),
 trade_walks:z.array(z.strictObject({trade:text,needed:z.boolean(),status:z.enum(['not_scheduled','scheduled','done','not_needed']),work_item_id:uuid.nullable()})),
 permits:z.strictObject({authority:text.nullable(),building_inspector:text.nullable(),electrical_inspector:z.enum(['city','dli']).nullable()}),
 rrp:z.strictObject({applies:z.boolean(),firm_cert:text.nullable(),renovator_name:text.nullable(),renovator_cert:text.nullable(),expiry:date.nullable()}),
 new_work:z.array(z.strictObject({origin:z.enum(['client_requested_optional','found_condition_required']),label:z.enum(['Upsell — optional addition','Scope change — required work']),text})),
 conflicts:z.array(z.strictObject({key:text,source_ids:z.array(uuid),reason:text})),
}).superRefine((v,ctx)=>{
 if((v.state==='none')!==(v.source_version===null))ctx.addIssue({code:'custom',message:'Source version must match state'});
 if(v.state==='none'){
  if([v.measurements,v.conditions,v.flags,v.photos,v.assumptions,v.exclusions,v.trade_walks,v.new_work,v.conflicts].some(a=>a.length)
    || Object.values(v.permits).some(x=>x!==null) || v.rrp.applies || Object.entries(v.rrp).some(([k,x])=>k!=='applies'&&x!==null))ctx.addIssue({code:'custom',message:'none must contain no facts'});
 }
 for(const item of v.new_work)if(item.label!==(item.origin==='client_requested_optional'?'Upsell — optional addition':'Scope change — required work'))ctx.addIssue({code:'custom',message:'New work label must preserve origin'});
});
