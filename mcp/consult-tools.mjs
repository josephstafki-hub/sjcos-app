import {z} from 'zod';
const uuid=z.string().uuid();
export const consultToolSchemas={
 list_consults:z.strictObject({project_slug:z.string().optional(),status:z.enum(['scheduled','in_progress','captured','incomplete','complete','cancelled']).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()}),
 list_consult_forms:z.strictObject({kind:z.enum(['module','template']).optional(),key:z.string().optional(),version:z.number().int().positive().optional()}),
 get_consult_form:z.strictObject({kind:z.enum(['module','template']),key:z.string(),version:z.number().int().positive().optional()}),
 propose_consult_form_version:z.strictObject({kind:z.enum(['module','template']),key:z.string(),definition:z.record(z.string(),z.unknown()),note:z.string().min(1),operation_id:uuid}),
 schedule_consult:z.strictObject({project_slug:z.string(),scheduled_for:z.iso.datetime({offset:true}),templates:z.array(z.string()).min(1),add_ons:z.array(z.string()).optional(),conducted_by_user_id:uuid.optional(),notes:z.string().max(8000).optional(),operation_id:uuid}),
 apply_consult_findings:z.strictObject({consult_id:uuid,expected_generation:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),operation_id:uuid}),
 attach_consult_photo:z.strictObject({consult_id:uuid,file_id:z.string(),instance_id:uuid,field_key:z.string().optional(),shot_key:z.string().optional(),operation_id:uuid}),
 get_consult:z.strictObject({consult_id:uuid}),
 record_consult_answers:z.strictObject({consult_id:uuid,operation_id:uuid,answers:z.array(z.strictObject({instance_id:uuid,field_key:z.string().min(1),base_revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:z.unknown().optional(),unit:z.string().optional(),skip_reason:z.string().optional(),skip_note:z.string().max(8000).optional(),source_note:z.string().min(1).max(8000)})).min(1).max(100)}),
 get_consult_scope_facts:z.strictObject({project_slug:z.string().min(1),scope_key:z.string().min(1)})
};
export function registerConsultTools(server,{json,consultCall}){
 for(const [name,schema] of Object.entries(consultToolSchemas))server.registerTool(name,{title:name.replaceAll('_',' '),description:name==='record_consult_answers'?'Propose consultation values. Returns suggested; a person must tap Use. Never writes accepted answers or completes a visit.':'Read assigned consultation evidence. No signed links or financial data.',inputSchema:schema.shape},async input=>{
  const checked=schema.safeParse(input);if(!checked.success)return json({ok:false,error:{code:'invalid_input',message:'Invalid consultation input',retryable:false}});
  return json(await consultCall(name,checked.data));
 });
}
