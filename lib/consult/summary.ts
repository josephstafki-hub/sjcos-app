import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
/** Internal only: caller holds the consult lock and commits initials or a reason in this transaction. */
export async function saveAcknowledgedSummary(c:PoolClient,id:string,instance:string,actor:string,text:string){
 const event=randomUUID();
 await c.query(`INSERT INTO consult_events(consult_id,event_id,actor,source,type,payload,payload_hash,server_revision,generation)
 SELECT id,$2,$3,'typed','answer',jsonb_build_object('summary',$4::text),encode(digest($4::text,'sha256'),'hex'),revision,completion_generation FROM consults WHERE id=$1`,[id,event,actor,text]);
 await c.query(`WITH saved AS (
 INSERT INTO consult_answers(consult_id,instance_id,field_key,status,value,source,actor,event_id,base_revision,server_revision,generation)
 SELECT id,$2,'summary','answered',to_jsonb($4::text),'typed',$3,$5,revision,revision,completion_generation FROM consults WHERE id=$1 RETURNING id,server_revision)
 INSERT INTO consult_field_heads(consult_id,instance_id,field_key,current_answer_id,revision)
 SELECT $1,$2,'summary',id,server_revision FROM saved
 ON CONFLICT(consult_id,instance_id,field_key) DO UPDATE SET current_answer_id=excluded.current_answer_id,revision=excluded.revision`,[id,instance,actor,text,event]);
}
