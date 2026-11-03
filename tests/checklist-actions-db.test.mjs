import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {withTestDb} from './_harness/testdb.mjs';
const require=createRequire(import.meta.url);
const suffix=crypto.randomUUID();
function actions(c,state) {
 const exports={};
 const stubs={
 '@/lib/dal':{getCurrentUser:async()=>state.user,can:u=>!!u&&(u.role==='owner'||u.permissions.includes('comms')),requireAccess:async()=>state.user,requireRole:async()=>state.user},
 '@/lib/db':{pool:{connect:async()=>({query:(...args)=>c.query(...args),release(){}})},query:(...args)=>c.query(...args),queryOne:async(...args)=>(await c.query(...args)).rows[0],bumpLiveChange(){}},
 '@/lib/checklist-coverage/contract':require('../lib/checklist-coverage/contract.ts'),
 '@/lib/checklist-coverage/manual':require('../lib/checklist-coverage/manual.ts'),
 '@/lib/checklist-coverage/action-result':require('../lib/checklist-coverage/action-result.ts'),
 '@/lib/checklist-coverage/defaults.json':JSON.parse(readFileSync(new URL('../lib/checklist-coverage/defaults.json',import.meta.url))),
 '@/lib/approvals/stage-draft':{stageDraftForApproval:async(...args)=>{if(state.failStage)throw new Error('injected failure');return require('../lib/approvals/stage-draft.ts').stageDraftForApproval(...args);}},
 '@/lib/notify-owner':{notifyOwner:async()=>{}},
 './calls':{placeCallAction:async(phone,name,id)=>{
 state.dials++;
 await c.query(`INSERT INTO calls(id,direction,counterparty_number,business_number,owner_number,status) VALUES($1,'outbound',$2,'+16125550000','+16125550001','ringing')`,[id,phone]);
 await c.query('UPDATE checklist_sessions SET revision=revision+1 WHERE id=$1',[state.session]);
 if(state.interrupt)throw new Error('lost provider response');
 return {ok:true,callId:id};
 }}
 };
 const source=ts.transpileModule(readFileSync(new URL('../lib/actions/discovery-checklist.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 runInNewContext(source,{exports,Error,require:s=>s.startsWith('node:')?require(s):stubs[s]??(()=>{throw Error(s)})()});
 return exports;
}
test('authenticated actions: principals, safe errors, recipient locks, replay, rollback and durable dialing',async()=>{
 await withTestDb(async(_url,c)=>{
 const owner=(await c.query(`INSERT INTO users(email,password_hash,name,role) VALUES('calls-actions-${suffix}@test.invalid','x','Owner','owner') RETURNING id`)).rows[0];owner.role='owner';
 const staff=(await c.query(`INSERT INTO users(email,password_hash,name,role,permissions) VALUES('calls-staff-${suffix}@test.invalid','x','Staff','staff','{comms}') RETURNING id`)).rows[0];Object.assign(staff,{role:'staff',permissions:['comms']});
 const lead=(await c.query(`INSERT INTO leads(slug,name,email,phone,scope,stage) VALUES('calls-actions-${suffix}','Alex','alex@test.invalid','+16125550199','Bath','intake') RETURNING id`)).rows[0].id;
 const other=(await c.query(`INSERT INTO leads(slug,name,email,scope,stage) VALUES('calls-actions-${suffix}-other','Blair','blair@test.invalid','Bath','intake') RETURNING id`)).rows[0].id;
 const state={user:owner,dials:0};const a=actions(c,state);
 const started=await a.startChecklist({lead_id:lead,operation_id:crypto.randomUUID()});assert.equal(started.ok,true);state.session=started.session_id;
 const snapshot=await a.loadChecklist(state.session);
 const op={session_id:state.session,item_id:snapshot.rows[0].identity.item_id,expected_revision:0,operation_id:crypto.randomUUID(),state:'not_applicable',value:null,reason:null};
 assert.equal((await a.setChecklistItem(op,owner.id)).code,'CHECKLIST_INVALID_ANSWER');
 state.user=staff;assert.equal((await a.setChecklistItem({...op,state:'covered'},owner.id)).code,'CHECKLIST_USER_CHANGED');
 assert.equal((await a.saveChecklistNotes({session_id:state.session,notes:'A private note',expected_revision:0,operation_id:crypto.randomUUID()},owner.id)).code,'CHECKLIST_USER_CHANGED');
 state.user=null;assert.equal((await a.setChecklistItem(op,owner.id)).code,'CHECKLIST_FORBIDDEN');state.user=owner;
 const valid={...op,state:'covered'};assert.equal((await a.setChecklistItem(valid,owner.id)).ok,true);
 assert.equal((await a.setChecklistItem({...valid,value:{scope:'changed'}},owner.id)).code,'CHECKLIST_OPERATION_REUSED');
 const settings=await a.loadDiscoveryChecklistSettings();
 const pub={definition_id:settings.definition.id,expected_version:crypto.randomUUID(),items:settings.version.items,screen_phone:false,send_call_link:false,operation_id:crypto.randomUUID()};
 assert.equal((await a.publishDiscoveryChecklist(pub)).code,'CHECKLIST_VERSION_CONFLICT');
 state.user=staff;assert.equal((await a.publishDiscoveryChecklist(pub)).code,'CHECKLIST_OWNER_ONLY');state.user=owner;
 let revision=1;
 const draft=()=>({session_id:state.session,expected_revision:revision,operation_id:crypto.randomUUID(),subject:'Project',body:'Alex private details',reviewed_lead_id:lead,reviewed_email:'alex@test.invalid'});
 await c.query(`UPDATE leads SET email='new@test.invalid' WHERE id=$1`,[lead]);
 assert.equal((await a.stageChecklistFollowup(draft())).code,'CHECKLIST_RECIPIENT_CHANGED');
 await c.query('UPDATE leads SET email=NULL WHERE id=$1',[lead]);
 assert.equal((await a.stageChecklistFollowup({...draft(),reviewed_email:null})).code,'CHECKLIST_NO_EMAIL');
 await c.query(`UPDATE leads SET email='alex@test.invalid' WHERE id=$1`,[lead]);
 const linked=await a.linkChecklist({session_id:state.session,expected_revision:revision,lead_id:other,call_id:null,operation_id:crypto.randomUUID()});revision=linked.revision;
 assert.equal((await a.stageChecklistFollowup(draft())).code,'CHECKLIST_RECIPIENT_CHANGED');
 const back=await a.linkChecklist({session_id:state.session,expected_revision:revision,lead_id:lead,call_id:null,operation_id:crypto.randomUUID()});revision=back.revision;
 state.failStage=true;await assert.rejects(a.stageChecklistFollowup(draft()),/injected/);
 assert.equal((await c.query(`SELECT count(*)::int n FROM work_items WHERE source_id=$1`,[state.session])).rows[0].n,0);
 state.failStage=false;const submitted=draft();const staged=await a.stageChecklistFollowup(submitted);assert.equal(staged.ok,true);
 assert.deepEqual(await a.stageChecklistFollowup(submitted),structuredClone(staged));
 assert.equal((await a.stageChecklistFollowup({...submitted,reviewed_email:'blair@test.invalid'})).code,'CHECKLIST_OPERATION_REUSED');
 // Pre-existing manual start is replayed; dialing races with a tick revision.
 const startOp=crypto.randomUUID();const manual=await a.startChecklist({lead_id:lead,operation_id:startOp});state.session=manual.session_id;
 const dial=await a.startDiscoveryCall({lead_id:lead,operation_id:startOp,checklist_only:false});assert.equal(dial.call.ok,true);
 assert.ok((await a.loadChecklist(state.session)).session.call_id);
 await a.startDiscoveryCall({lead_id:lead,operation_id:startOp,checklist_only:false});assert.equal(state.dials,1);
 // Provider succeeded but response/process was interrupted. Durable ID recovers the call.
 const interruptedOp=crypto.randomUUID();state.session=(await a.startChecklist({lead_id:lead,operation_id:interruptedOp})).session_id;
 state.interrupt=true;await assert.rejects(a.startDiscoveryCall({lead_id:lead,operation_id:interruptedOp,checklist_only:false}),/lost provider/);
 state.interrupt=false;await a.startDiscoveryCall({lead_id:lead,operation_id:interruptedOp,checklist_only:false});
 assert.equal(state.dials,2);assert.ok((await a.loadChecklist(state.session)).session.call_id);
 });
});
test('insurance before linkage and relink create one notice per lead',async()=>{
 await withTestDb(async(_url,c)=>{
 const user=(await c.query(`SELECT id FROM users WHERE email='calls-actions-${suffix}@test.invalid'`)).rows[0];Object.assign(user,{role:'owner'});
 const a=actions(c,{user});const id=(await a.startChecklist({operation_id:crypto.randomUUID()})).session_id;
 const s=await a.loadChecklist(id);const row=s.rows.find(r=>r.spec.key==='paying');
 // Seed exactly the stored value used by the paying-for-it row.
 const item=row??s.rows.find(r=>r.spec.key==='paying_for_it');assert.ok(item);
 await c.query(`UPDATE checklist_item_coverage SET value='{"method":"insurance"}' WHERE session_id=$1 AND item_id=$2`,[id,item.identity.item_id]);
 const leads=(await c.query(`SELECT id FROM leads WHERE slug IN ('calls-actions-${suffix}','calls-actions-${suffix}-other')`)).rows;
 for(const lead of [...leads,leads[0]]) {const fresh=await a.loadChecklist(id);assert.equal((await a.linkChecklist({session_id:id,lead_id:lead.id,call_id:null,expected_revision:fresh.session.revision,operation_id:crypto.randomUUID()})).ok,true);}
 for(const lead of leads)assert.equal((await c.query(`SELECT count(*)::int n FROM work_items WHERE source_id=$1`,['checklist-insurance:'+lead.id])).rows[0].n,1);
 });
});

test('HTTP coverage and registered MCP reads use scoped authenticated checklist records',async()=>{
 const {registerChecklistTools}=await import('../mcp/checklist-tools.mjs');
 await withTestDb(async(_url,c)=>{
 const user=(await c.query(`SELECT id FROM users WHERE email='calls-actions-${suffix}@test.invalid'`)).rows[0];Object.assign(user,{role:'owner'});
 const state={user};const a=actions(c,state);const id=(await a.startChecklist({operation_id:crypto.randomUUID()})).session_id;
 function route(file,stubs,env={}) {
  const exports={};const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,Response,URL,Error,process:{env},require:s=>s.startsWith('node:')?require(s):stubs[s]});return exports;
 }
 const http=route('app/api/calls/coverage/route.ts',{'@/lib/actions/discovery-checklist':a});
 const url=`https://test.invalid/api/calls/coverage?session=${id}`;
 let response=await http.GET(new Request(url));assert.equal(response.status,200);assert.equal((await response.json()).rows.length,13);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal((await http.GET(new Request(url+'&rev=0'))).status,304);
 state.user=null;response=await http.GET(new Request(url));assert.notEqual(response.status,200);state.user=user;
 const internal=route('app/api/internal/checklist/route.ts',{
 '@/lib/db':{query:(...args)=>c.query(...args),queryOne:async(...args)=>(await c.query(...args)).rows[0]},
 '@/lib/authority/mcp-gate':{loadPrincipalUser:async(_run,id)=>id===user.id?user:null},'@/lib/commands/db':{runDirect(){}},'@/lib/checklist-coverage/manual':require('../lib/checklist-coverage/manual.ts')
 },{CRON_SECRET:'isolated-test-secret'});
 const invoke=(body,authorized=true)=>internal.POST(new Request('https://test.invalid/api/internal/checklist',{method:'POST',headers:authorized?{authorization:'Bearer isolated-test-secret'}:{},body:JSON.stringify(body)}));
 assert.equal((await invoke({},false)).status,403);assert.equal((await invoke({principal_user_id:crypto.randomUUID()})).status,403);assert.equal((await invoke({principal_revoked:true})).status,403);
 const tools={};registerChecklistTools({registerTool:(name,_spec,fn)=>{tools[name]=fn;}},{json:v=>v,checklistCall:async(action,input)=>{const response=await invoke({action,...input,principal_user_id:user.id});assert.equal(response.headers.get('cache-control'),'private, no-store');return response.json();}});
 const read=await tools.get_call_coverage({session_id:id});assert.equal(read.ok,true);assert.equal(read.coverage.rows.length,13);
 assert.equal((await tools.get_call_coverage({session_id:id,call_id:crypto.randomUUID()})).code,'CHECKLIST_INVALID_TARGET');
 assert.ok((await tools.list_checklist_definitions({kind:'discovery_call'})).definitions.length);
 });
});
