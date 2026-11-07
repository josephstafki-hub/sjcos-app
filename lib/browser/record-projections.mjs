/** Real SJC read paths with exact field projections. Uses only sjcos_agent's
 * existing reads/writes; never browser LOGIN table access or ordinary MCP dumps.
 * readTask is the protected controller snapshot, NOT tool arguments. */
import {randomUUID} from 'node:crypto';
import {canonical} from './acceptance-attestation.mjs';
import {createProfileBridge} from './production-bridge.mjs';
import {PROFILE_TOOLS} from '../../mcp/browser-profile-tools.mjs';
const fail=()=>{throw Error('BROWSER_FORBIDDEN');};
const iso=x=>x===null?null:x instanceof Date?x.toISOString():x;
export function createRecordProjections({transaction,readTask,authorize,questionTransaction,clock=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 if([transaction,readTask,authorize].some(f=>typeof f!=='function'))fail();
 const current=async t=>{const fresh=await readTask(t.id);if(!fresh||fresh.id!==t.id||fresh.initiator_user_id!==t.initiator_user_id||fresh.conversation_id!==t.conversation_id||await authorize(fresh)!==true)fail();return fresh;};
 const read=async(t,fn)=>{const fresh=await current(t);const result=await transaction(async c=>{const login=(await c.query('SELECT session_user::text AS login,current_user::text AS effective')).rows[0];if(login?.login!=='sjcos_agent'||login.effective!=='sjcos_agent')fail();return fn(c,fresh);});const after=await current(t);for(const k of ['project_id','lead_slug','work_item_id','revision','confirmed_answers'])if(canonical(after[k]??null)!==canonical(fresh[k]??null))fail();return result;};
 // Existing business rows have no general "confirmed" flag. Browser's explicit
 // initiator-confirmed answer revision is required as well as exact record match.
 const confirmed=(t,key,value)=>typeof value==='string'&&value.length<=4000&&t.confirmed_answers?.some(a=>a.field_key===key&&a.value===value)?value:null;
 const records={
  async project(id,t){if(id!==t.project_id)fail();return read(t,async(c,f)=>{if(id!==f.project_id)fail();const p=(await c.query('SELECT p.address,l.scope FROM projects p LEFT JOIN leads l ON l.id=p.lead_id WHERE p.id=$1',[id])).rows[0];if(!p)fail();const permit_checklist=[],license_facts=[];
   // Compliance is a real shared business table, but its notes/owner/step never
   // enter the projection. The person must explicitly confirm this task's item.
   const answers=(f.required_areas?.includes('compliance')?f.confirmed_answers??[]:[]).filter(a=>/^(project\.permit|company\.license):[0-9a-f-]{36}$/.test(a.field_key));
   if(answers.length>70)fail();
   if(answers.length){const ids=answers.map(a=>a.field_key.split(':')[1]);const {rows}=await c.query('SELECT id,title,kind,resolved FROM compliance_items WHERE id=ANY($1::uuid[]) ORDER BY id LIMIT 70',[ids]);
    for(const row of rows){const a=answers.find(a=>a.field_key.endsWith(':'+row.id)&&a.value===row.title);if(!a)continue;
     if(row.kind==='permit'&&a.field_key.startsWith('project.permit:'))permit_checklist.push({id:row.id,label:row.title,completed:row.resolved});
     if(row.kind==='license'&&a.field_key.startsWith('company.license:'))license_facts.push({id:row.id,kind:'license',value:row.title,confirmed_revision:a.revision});
    }
   }
   return PROFILE_TOOLS.sjcos.get_project.output.shape.confirmed_facts.parse({address:confirmed(f,'project.address',p.address),scope:confirmed(f,'project.scope',p.scope),permit_checklist,license_facts});});},
  async lead(slug,t){if(slug!==t.lead_slug)fail();return read(t,async(c,f)=>{if(slug!==f.lead_slug)fail();const l=(await c.query('SELECT address,scope FROM leads WHERE slug=$1',[slug])).rows[0];if(!l)fail();return {address:confirmed(f,'lead.address',l.address),scope:confirmed(f,'lead.scope',l.scope)};});},
  async workItem(id,t){if(id!==t.work_item_id)fail();return read(t,async(c,f)=>{if(id!==f.work_item_id)fail();const w=(await c.query('SELECT w.status,w.due_at,w.source_kind AS type,w.project_id,l.slug AS lead_slug FROM work_items w LEFT JOIN leads l ON l.id=w.lead_id WHERE w.id=$1',[id])).rows[0];if(!w||w.project_id!==(f.project_id??null)||w.lead_slug!==(f.lead_slug??null))fail();return {status:w.status,due_at:iso(w.due_at),type:w.type};});},
  async operatingContext(t){const f=await current(t);return PROFILE_TOOLS.sjcos.get_operating_context.output.parse({browser_rules_version:1,required_areas:f.required_areas});},
 };
 /** Real agent_interactions row, always bound to the initiating person's own
  * conversation/current browser run. No orphan/global owner question fallback. */
 const question=async input=>{
  const t=await readTask(input.task_id);if(!t||input.user_id!==t.initiator_user_id||input.conversation_id!==t.conversation_id)fail();
  PROFILE_TOOLS.interact.ask_owner.input.parse({question:input.question});
  if(typeof questionTransaction!=='function')fail();
  const id=randomUUID(),deadline=clock()+60000;
  const scoped=async fn=>{const f=await current(t);const result=await questionTransaction(async c=>{
   const login=(await c.query("SELECT session_user::text AS login,current_user::text AS effective,pg_get_userbyid(relowner)::text AS owner FROM pg_class WHERE oid='public.agent_interactions'::regclass")).rows[0];
   if(!login||login.login!==login.owner||login.effective!==login.owner)fail();
   await c.query("SELECT set_config('sjcos.ask_actor',$1,true)",[f.initiator_user_id]);
   const run=(await c.query("SELECT r.id FROM dev_agent_runs r JOIN ai_conversations a ON a.id=r.conversation_id JOIN browser_tasks t ON t.current_run_id=r.id WHERE t.id=$4 AND t.initiator_user_id=$2 AND t.conversation_id=$3 AND t.state IN ('active','paused') AND r.id=$1 AND r.profile='browser' AND r.launch_source='panel_web' AND r.status IN ('pending','running') AND NOT r.cancellation_requested AND r.principal_user_id=$2 AND r.conversation_id=$3 AND a.owner_user_id=$2 AND a.deleted_at IS NULL",[f.current_run_id,f.initiator_user_id,f.conversation_id,f.id])).rows[0];if(!run)fail();
   return fn(c,f);
  });await current(t);return result;};
  await scoped((c,f)=>c.query("INSERT INTO agent_interactions(id,run_id,conversation_id,agent,kind,payload) VALUES($1,$2,$3,'claude','question',$4::jsonb)",[id,f.current_run_id,f.conversation_id,JSON.stringify({questions:[{question:input.question,options:[],allowOther:true}]})]));
  try{
   while(clock()<deadline){
    const row=await scoped(async(c,f)=>(await c.query('SELECT status,response FROM agent_interactions WHERE id=$1 AND run_id=$2 AND conversation_id=$3',[id,f.current_run_id,f.conversation_id])).rows[0]);
    if(row?.status==='answered'){
     const response=row.response;if(response?.kind!=='question'||response.answers?.length!==1||response.answers[0].question!==input.question)fail();
     const a=response.answers[0],answer=[...(a.choices??[]),...(a.other?[a.other]:[])].join('\n');
     return PROFILE_TOOLS.interact.ask_owner.output.parse({answer});
    }
    if(!row||row.status!=='pending')fail();await wait(1000);
   }fail();
  }finally{await scoped((c,f)=>c.query("UPDATE agent_interactions SET status='expired' WHERE id=$1 AND run_id=$2 AND conversation_id=$3 AND status='pending'",[id,f.current_run_id,f.conversation_id])).catch(()=>{});}
 };
 return Object.freeze({...records,question});
}

/** Install behind the per-process profile authority; neither ordinary MCP nor
 * the model selects these database adapters. */
export function createRecordProfileBridge({task,...dependencies}){
 const records=createRecordProjections(dependencies);
 return createProfileBridge({task,authorize:dependencies.authorize,records,question:records.question});
}

/** Owner bridge helper: journal recovery/deletion lock surrounds every question
 * transaction. Explicit pool only, never imports the website's ambient pool. */
export function createQuestionTransaction(pool,options){
 if(typeof pool?.connect!=='function')fail();
 return async fn=>{
  const {withAskJournal}=await import('../ask-thread-journal.mjs');
  const {committedTransaction}=await import('./production-bridge.mjs');
  return withAskJournal(pool,()=>committedTransaction(pool)(fn),options);
 };
}

/** Internal denial facts, NEVER an MCP result. Include unconfirmed private
 * business values too: lack of confirmation cannot make them public URL data. */
export async function privateRecordFacts({transaction},task){
 if(typeof transaction!=='function')fail();
 return transaction(async c=>{
  const values=[];
  const add=rows=>{for(const row of rows)for(const value of Object.values(row))if(typeof value==='string'&&value.length)values.push(value);};
  if(task.project_id)add((await c.query('SELECT p.name,p.client_name,p.address,l.scope,l.email,l.phone FROM projects p LEFT JOIN leads l ON l.id=p.lead_id WHERE p.id=$1',[task.project_id])).rows);
  if(task.lead_slug)add((await c.query('SELECT name,address,scope,email,phone FROM leads WHERE slug=$1',[task.lead_slug])).rows);
  for(const a of task.confirmed_answers??[])if(typeof a.value==='string'&&a.value.length)values.push(a.value);
  return [...new Set(values)];
 });
}
