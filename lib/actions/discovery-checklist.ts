'use server';

import { randomUUID, createHash } from 'node:crypto';
import { requireAccess, requireRole } from '@/lib/dal';
import { pool, query, queryOne, bumpLiveChange } from '@/lib/db';
import { safeRevision, type ChecklistItem } from '@/lib/checklist-coverage/contract';
import { priorToValue, uuid, validateManualOperation, checklistSummary, type ManualOperation, type ChecklistSnapshot, type CommandResult } from '@/lib/checklist-coverage/manual';
import { placeCallAction } from './calls';
import defaultItems from '@/lib/checklist-coverage/defaults.json';
import { stageDraftForApproval } from '@/lib/approvals/stage-draft';
import { notifyOwner } from '@/lib/notify-owner';

async function context(operation:string,sessionId:string|null,input:unknown=null) {
 const user=await requireAccess('comms');
 const claims={subject:user.id,role:user.role,delegating_subject:null,areas:['comms'],run_id:randomUUID(),session_ids:sessionId?[uuid(sessionId)]:[],create_scope:input,operations:[operation,'read'],expires_at:new Date(Date.now()+60000).toISOString(),nonce:randomUUID()};
 const row=await queryOne<{context:unknown}>('SELECT checklist_mint_context($1::jsonb) AS context',[JSON.stringify(claims)]);
 return row!.context;
}
async function command<T=CommandResult>(name:string,input:Record<string,unknown>,operationId:string):Promise<T> {
 uuid(operationId);
 const c=await context(name,input.session_id as string ?? null,name==='start'?input:null);
 const result=await queryOne<{result:T}>('SELECT checklist_command($1::jsonb,$2,$3::jsonb,$4::uuid) AS result',[JSON.stringify(c),name,JSON.stringify(input),operationId]);
 return result!.result;
}
export async function startChecklist(input:{lead_id?:string|null;call_id?:string|null;operation_id:string}):Promise<CommandResult> {
 return command('start',{kind:'discovery_call',call_id:input.call_id?uuid(input.call_id):null,lead_id:input.lead_id?uuid(input.lead_id):null,project_id:null,source_ref:null},input.operation_id);
}
export async function loadChecklist(sessionId:string):Promise<ChecklistSnapshot> {
 const c=await context('read',uuid(sessionId));
 const row=await queryOne<{result:ChecklistSnapshot}>('SELECT checklist_read($1::jsonb,$2,\'rows\') AS result',[JSON.stringify(c),sessionId]);
 const s=row!.result;
 s.session.revision=safeRevision(Number(s.session.revision));s.session.deletion_epoch=safeRevision(Number(s.session.deletion_epoch));
 for(const row of s.rows) row.coverage.revision=safeRevision(Number(row.coverage.revision));
 return s;
}
export async function loadChecklistForCall(callId:string):Promise<ChecklistSnapshot|null> {
 await requireAccess('comms');uuid(callId);
 const row=await queryOne<{id:string}>('SELECT id FROM checklist_sessions WHERE call_id=$1',[callId]);
 return row?loadChecklist(row.id):null;
}
export async function setChecklistItem(op:ManualOperation):Promise<CommandResult> {
 validateManualOperation(op);
 const {operation_id,...input}=op;
 return command('set_item',input,operation_id);
}
export async function confirmLeadChecklistItem(input:{session_id:string;item_id:string;expected_revision:number;operation_id:string}):Promise<CommandResult> {
 const s=await loadChecklist(input.session_id);const row=s.rows.find(r=>r.identity.item_id===input.item_id);
 if(!row?.prior) throw new Error('CHECKLIST_NO_PRIOR');
 return setChecklistItem({...input,state:'covered',value:priorToValue(row.spec.key,row.prior.value),reason:null});
}
export async function linkChecklist(input:{session_id:string;lead_id:string|null;call_id:string|null;expected_revision:number;operation_id:string}) {
 safeRevision(input.expected_revision); if(input.lead_id) uuid(input.lead_id); if(input.call_id) uuid(input.call_id);
 const {operation_id,...rest}=input;return command('link',rest,operation_id);
}
export async function saveChecklistNotes(input:{session_id:string;notes:string;expected_revision:number;operation_id:string}) {
 safeRevision(input.expected_revision);const {operation_id,...rest}=input;return command('notes',rest,operation_id);
}
export async function finishChecklist(input:{session_id:string;expected_revision:number;operation_id:string}) {
 safeRevision(input.expected_revision); const {operation_id,...rest}=input;
 const result=await command('finish',rest,operation_id);
 return result.ok?{...result,summary:await loadChecklistSummary(input.session_id)}:result;
}
export async function loadChecklistSummary(sessionId:string) {
 const snapshot=await loadChecklist(sessionId);
 const lead=snapshot.session.lead_id?await queryOne<{email:string|null;name:string}>('SELECT email,name FROM leads WHERE id=$1',[snapshot.session.lead_id]):null;
 const drafts=await query<{id:string;status:string;approval_status:string}>(`SELECT id,status,approval_status FROM work_items WHERE source_kind='manual' AND source_id=$1 AND title='Discovery call follow-up' ORDER BY created_at DESC`,[sessionId]);
 return {...checklistSummary(snapshot),lead,drafts:drafts.rows,noEmailCopy:lead?.email?null:'Confirm their email first'};
}
export async function loadLeadChecklistFacts(leadId:string) {
 await requireAccess('comms');uuid(leadId);
 return (await query<{key:string;value:unknown;status:string}>(`SELECT key,value,status FROM lead_facts WHERE lead_id=$1 AND status='known'`,[leadId])).rows;
}
export async function activeCallSnapshot() {
 await requireAccess('comms');
 const calls=await query<{id:string;status:string;direction:string;contact_name:string|null;counterparty_number:string;started_at:string;answered_at:string|null;session_id:string|null}>(
 `SELECT c.id,c.status,c.direction,c.contact_name,c.counterparty_number,c.started_at::text,c.answered_at::text,s.id AS session_id FROM calls c LEFT JOIN checklist_sessions s ON s.call_id=c.id WHERE c.status IN ('ringing','bridged') AND c.started_at>now()-interval '2 hours' ORDER BY c.started_at DESC`);
 const manual=await query<{id:string;lead_id:string|null;started_at:string}>(`SELECT id,lead_id,started_at::text FROM checklist_sessions WHERE call_id IS NULL AND status='open' AND started_at>now()-interval '2 hours' ORDER BY started_at DESC LIMIT 10`);
 return {calls:calls.rows,manual:manual.rows};
}
export async function discoveryCallConfirmData(leadId:string) {
 await requireAccess('comms');uuid(leadId);
 const lead=await queryOne<{id:string;name:string;phone:string|null;email:string|null;scope:string}>('SELECT id,name,phone,email,scope FROM leads WHERE id=$1',[leadId]);
 if(!lead) throw new Error('CHECKLIST_NOT_FOUND');
 return {lead,explanation:'Your cell rings first, then we connect '+lead.name+'.'};
}
export async function startDiscoveryCall(input:{lead_id:string;operation_id:string;checklist_only:boolean}) {
 if(!input.checklist_only) await requireRole('owner');
 const {lead}=await discoveryCallConfirmData(input.lead_id);
 // Start first so a retry can recover the checklist if dialing fails. Dialing
 // remains the existing owner-only exact-number single-use grant path.
 const session=await startChecklist({lead_id:lead.id,operation_id:input.operation_id});
 if(!session.ok || input.checklist_only) return {session};
 await requireRole('owner');
 if(!lead.phone) return {session,error:'CHECKLIST_NO_PHONE'};
 const dialLock=await pool.connect();
 await dialLock.query('SELECT pg_advisory_lock(hashtextextended($1,2))',[session.session_id]);
 try {
 const existing=await loadChecklist(session.session_id);
 if(existing.session.call_id) return {session,call:{ok:true,callId:existing.session.call_id}};
 const call=await placeCallAction(lead.phone,lead.name);
 if(call.ok && call.callId) await linkChecklist({session_id:session.session_id,lead_id:lead.id,call_id:call.callId,expected_revision:existing.session.revision,operation_id:randomUUID()});
 return {session,call};
 } finally {await dialLock.query('SELECT pg_advisory_unlock(hashtextextended($1,2))',[session.session_id]);dialLock.release();}
}
export async function unknownCallerChoice(input:{call_id:string;choice:'link'|'new_lead'|'not_lead';lead_id?:string;operation_id:string}) {
 await requireAccess('comms');uuid(input.call_id);
 const call=await queryOne<{counterparty_number:string}>('SELECT counterparty_number FROM calls WHERE id=$1',[input.call_id]);
 if(!call) throw new Error('CHECKLIST_NOT_FOUND');
 if(input.choice==='not_lead') return {hidden:true};
 if(input.choice==='new_lead') return {createLead:{phone:call.counterparty_number},linkCallId:input.call_id};
 if(input.choice!=='link' || !input.lead_id) throw new Error('CHECKLIST_INVALID_TARGET');
 return startChecklist({lead_id:input.lead_id,call_id:input.call_id,operation_id:input.operation_id});
}
export async function loadDiscoveryChecklistSettings() {
 await requireRole('owner');
 const definition=await queryOne<{id:string;current_version_id:string}>('SELECT id,current_version_id FROM checklist_definitions WHERE key=\'discovery_call\'');
 const version=await queryOne<{id:string;items:ChecklistItem[];version:number}>('SELECT id,items,version FROM checklist_versions WHERE id=$1',[definition!.current_version_id]);
 const settings=await queryOne<{screen_phone:boolean;send_call_link:boolean}>('SELECT screen_phone,send_call_link FROM checklist_call_settings WHERE id');
 return {definition:definition!,version:version!,settings:settings!,defaults:defaultItems as ChecklistItem[]};
}
export async function publishDiscoveryChecklist(input:{definition_id:string;expected_version:string;items:ChecklistItem[];screen_phone:boolean;send_call_link:boolean;operation_id:string}) {
 await requireRole('owner');uuid(input.definition_id);uuid(input.expected_version);
 const {operation_id,...rest}=input;return command<{ok:true;version_id:string}>('publish',rest,operation_id);
}
/** Same approval records consumed by approve-work-item; never sends. */
export async function stageChecklistFollowup(input:{session_id:string;expected_revision:number;operation_id:string;subject:string;body:string}) {
 const user=await requireAccess('comms'); uuid(input.operation_id);safeRevision(input.expected_revision);
 const snapshot=await loadChecklist(input.session_id);
 if(!snapshot.session.lead_id) throw new Error('CHECKLIST_LINK_LEAD');
 if(!input.body.trim() || input.body.length>30000 || /[\r\n]/.test(input.subject) || !input.subject.trim()) throw new Error('CHECKLIST_INVALID_DRAFT');
 const client=await pool.connect();
 try {
 await client.query('BEGIN');
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.operation_id]);
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const prior=(await client.query('SELECT * FROM checklist_operation_receipts WHERE operation_id=$1',[input.operation_id])).rows[0];
 if(prior) { if(prior.subject!==user.id || prior.input_hash!==hash) throw new Error('CHECKLIST_OPERATION_REUSED');await client.query('COMMIT');return prior.result; }
 const scoped=await context('read',input.session_id);
 await client.query("SELECT checklist_read($1,$2,'rows')",[scoped,input.session_id]);
 const current=(await client.query('SELECT revision FROM checklist_sessions WHERE id=$1 FOR UPDATE',[input.session_id])).rows[0];
 if(Number(current.revision)!==input.expected_revision) {await client.query('ROLLBACK');return {ok:false,code:'CHECKLIST_CONFLICT',status:409,current:await loadChecklist(input.session_id),proposed:input};}
 const lead=(await client.query('SELECT email FROM leads WHERE id=$1',[snapshot.session.lead_id])).rows[0];
 if(!lead?.email) throw new Error('CHECKLIST_NO_EMAIL');
 const draft=`To: ${lead.email}\nSubject: ${input.subject}\n\n${input.body.trim()}`;
 const work=(await client.query(`INSERT INTO work_items(title,body,lead_id,source_kind,source_id,status,approval_status,requires_approval) VALUES('Discovery call follow-up',$1,$2,'manual',$3,'approval_needed','requested',true) RETURNING id`,[input.body,snapshot.session.lead_id,input.session_id])).rows[0];
 const staged=await stageDraftForApproval(async <T>(sql:string,params?:unknown[]) => (await client.query(sql,params)).rows as T[],{work_item_id:work.id,lead_id:snapshot.session.lead_id,draft,created_by:user.id});
 const result={ok:true,work_item_id:work.id,knowledge_id:staged.knowledge_id,never_sent:true};
 await client.query('INSERT INTO checklist_operation_receipts(operation_id,subject,input_hash,result) VALUES($1,$2,$3,$4::jsonb)',[input.operation_id,user.id,hash,JSON.stringify(result)]);
 await client.query('COMMIT'); bumpLiveChange('work_items');
 await notifyOwner({kind:'approval_needed',title:'Discovery call follow-up',href:'/engine',telegram:{workItemId:work.id}});
 return result;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
