import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {ConsultContext} from './uploads.ts';
import {hash} from './protocol.ts';
export const proposalInput=z.strictObject({consult_id:z.string().uuid(),operation_id:z.string().uuid(),answers:z.array(z.strictObject({instance_id:z.string().uuid(),field_key:z.string().min(1),base_revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),value:z.unknown().optional(),unit:z.string().optional(),skip_reason:z.string().optional(),skip_note:z.string().max(8000).optional(),source_note:z.string().min(1).max(8000)})).min(1).max(100)});
/** Agent source never enters consult_answers. Person commands alone accept it. */
export async function proposeConsultAnswers(c:PoolClient,ctx:ConsultContext,input:unknown){
 const v=proposalInput.parse(input);
 const actor=(await c.query('SELECT consult_verify_context($1,$2,$3) actor',[ctx,v.consult_id,'propose_answers'])).rows[0].actor;
 const s=(await c.query('SELECT status,completion_generation FROM consults WHERE id=$1 FOR UPDATE',[v.consult_id])).rows[0];
 if(s.status==='complete')throw new Error('complete_locked');
 const receipts=[];
 for(const a of v.answers){
  if(!(await c.query(`SELECT 1 FROM consult_instances i JOIN consult_form_pins p ON p.consult_id=i.consult_id AND p.key=i.module_key AND p.kind='module' JOIN consult_form_versions v ON v.id=p.form_id WHERE i.consult_id=$1 AND i.id=$2 AND i.removed_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.definition->'fields') f WHERE f->>'key'=$3 AND NOT f ? 'derive')`,[v.consult_id,a.instance_id,a.field_key])).rowCount)throw new Error('unknown_field');
  const answer={status:a.skip_reason?'skipped':'answered',...(a.value!==undefined?{value:a.value}:{}),...(a.unit?{unit:a.unit}:{}),...(a.skip_reason?{skip_reason:a.skip_reason}:{}),...(a.skip_note?{skip_note:a.skip_note}:{})};
  const old=(await c.query('SELECT * FROM consult_agent_proposals WHERE consult_id=$1 AND operation_id=$2 AND instance_id=$3 AND field_key=$4',[v.consult_id,v.operation_id,a.instance_id,a.field_key])).rows[0];
  if(old&&(hash(old.answer)!==hash(answer)||Number(old.base_revision)!==a.base_revision||old.source_note!==a.source_note))throw new Error('idempotency_mismatch');
  const row=old??(await c.query(`INSERT INTO consult_agent_proposals(consult_id,operation_id,actor,generation,instance_id,field_key,base_revision,answer,source_note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[v.consult_id,v.operation_id,actor,s.completion_generation,a.instance_id,a.field_key,a.base_revision,answer,a.source_note])).rows[0];
  receipts.push({proposal_id:row.id,instance_id:a.instance_id,field_key:a.field_key,status:'suggested',revision:a.base_revision});
 }
 return receipts;
}
