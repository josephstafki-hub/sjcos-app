import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';
test('checklist: signed contexts, raw-role denial, immutable pinned members, replay and revision races',async()=>{
 await withTestDb(async(_url,c)=>{
 const owner=(await c.query(`INSERT INTO users(email,password_hash,name,role) VALUES('checklist-owner@test.invalid','x','Joe','owner') RETURNING id`)).rows[0].id;
 const staff=(await c.query(`INSERT INTO users(email,password_hash,name,role,permissions) VALUES('checklist-staff@test.invalid','x','Staff','staff','{comms}') RETURNING id`)).rows[0].id;
 const context=async(subject,role,ops,ids=[],scope=null)=> (await c.query(`SELECT checklist_mint_context($1::jsonb) c`,[JSON.stringify({subject,role,delegating_subject:null,areas:['comms'],run_id:crypto.randomUUID(),session_ids:ids,create_scope:scope,operations:ops,expires_at:new Date(Date.now()+60000).toISOString(),nonce:crypto.randomUUID()})])).rows[0].c;
 const scope={kind:'discovery_call',call_id:null,lead_id:null,project_id:null,source_ref:null};
 const start=await context(owner,'owner',['start','read'],[],scope);const op=crypto.randomUUID();
 const cmd=async(ctx,name,input,op=crypto.randomUUID())=>(await c.query('SELECT checklist_command($1,$2,$3,$4) result',[ctx,name,input,op])).rows[0].result;
 const s=await cmd(start,'start',scope,op);assert.equal(s.ok,true);
 assert.deepEqual(await cmd(start,'start',scope,op),s);
 await assert.rejects(cmd(start,'start',{...scope,lead_id:crypto.randomUUID()},op));
 const ctx=await context(owner,'owner',['read','set_item','finish'],[s.session_id]);
 const read=async(ctx,id)=>(await c.query(`SELECT checklist_read($1,$2,'rows') s`,[ctx,id])).rows[0].s;
 let snapshot=await read(ctx,s.session_id);assert.equal(snapshot.rows.length,13);
 const item=snapshot.rows[0].identity.item_id;
 const edit={session_id:s.session_id,item_id:item,state:'covered',value:null,reason:null,expected_revision:0};
 const editOp=crypto.randomUUID();assert.equal((await cmd(ctx,'set_item',edit,editOp)).revision,1);
 assert.equal((await cmd(ctx,'set_item',edit,editOp)).revision,1);
 assert.equal((await cmd(ctx,'set_item',edit)).status,409);
 await assert.rejects(cmd(ctx,'set_item',{...edit,expected_revision:1,state:'not_applicable'}));
 await assert.rejects(cmd(ctx,'set_item',{...edit,expected_revision:1,item_id:crypto.randomUUID()}));
 snapshot=await read(ctx,s.session_id);assert.equal(snapshot.rows[0].coverage.manual_lock,true);
 await assert.rejects(read({...ctx,subject:staff},s.session_id));
 const expired=await context(owner,'owner',['read'],[s.session_id]);expired.expires_at='2000-01-01T00:00:00Z';await assert.rejects(read(expired,s.session_id));
 const wrong=await context(owner,'owner',['read'],[]);await assert.rejects(read(wrong,s.session_id));
 await assert.rejects(c.query('UPDATE checklist_versions SET items=items WHERE id=$1',[snapshot.version.id]));
 for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly']) {
  await c.query(`SET ROLE ${role}`);
  try {
   for(const table of ['checklist_sessions','checklist_item_coverage','checklist_session_items','conversation_segments','checklist_events','checklist_jobs','checklist_context_keys','checklist_consent_evidence','checklist_legal_holds','checklist_purge_requests','checklist_purge_targets']) {
    await assert.rejects(c.query(`SELECT * FROM ${table}`),/permission denied/);
    await assert.rejects(c.query(`DELETE FROM ${table}`),/permission denied/);
   }
   await assert.rejects(c.query('SELECT checklist_mint_context($1)',[{}]),/permission denied/);
  }finally{await c.query('RESET ROLE');}
 }
 const st=await context(staff,'staff',['publish']);
 await assert.rejects(cmd(st,'publish',{definition_id:snapshot.version.definition_id,expected_version:snapshot.version.id,items:snapshot.version.items,screen_phone:false,send_call_link:false}),/OWNER_ONLY/);
 const pub=await context(owner,'owner',['publish']);
 const published=await cmd(pub,'publish',{definition_id:snapshot.version.definition_id,expected_version:snapshot.version.id,items:snapshot.version.items.map((i,n)=>n===0?{...i,label:'Work wanted'}:i),screen_phone:false,send_call_link:false});
 assert.equal(published.ok,true);assert.equal((await read(ctx,s.session_id)).version.id,snapshot.version.id);
 await c.query(`UPDATE users SET permissions='{}' WHERE id=$1`,[staff]);
 const staffCtx=await context(staff,'staff',['read'],[s.session_id]);await assert.rejects(read(staffCtx,s.session_id));
 });
});

test('shared v3 late runtime instances pin membership and reject cross-version references',async()=>{
 await withTestDb(async(_url,c)=>{
 const f=JSON.parse((await import('node:fs')).readFileSync(new URL('./fixtures/checklist-coverage/contract-v3/late-instances.json',import.meta.url)));
 const d=(await c.query(`INSERT INTO checklist_definitions(key,kind,label) VALUES('consult:test','in_home_consult','Bath') RETURNING id`)).rows[0].id;
 const item={id:f.definition_item_id,key:'bath.keep_tub',label:'Keep tub'};
 await c.query(`INSERT INTO checklist_definition_items(id,definition_id,key) VALUES($1,$2,$3)`,[item.id,d,item.key]);
 await c.query(`INSERT INTO checklist_versions(id,definition_id,version,items) VALUES($1,$2,1,$3)`,[f.definition_version_id,d,JSON.stringify([item])]);
 await c.query(`INSERT INTO checklist_version_items VALUES($1,$2,$3)`,[f.definition_version_id,item.id,item]);
 await c.query(`INSERT INTO checklist_sessions(id,kind,engine_mode,definition_version_id,source_ref) VALUES($1,'in_home_consult','consult',$2,'fixture-consult')`,[f.session_id,f.definition_version_id]);
 for(const late of f.late_items) await c.query(`INSERT INTO checklist_session_items(session_id,item_id,definition_version_id,definition_item_id,instance_id) VALUES($1,$2,$3,$4,$5)`,[f.session_id,late.item_id,f.definition_version_id,item.id,late.instance_id]);
 const v2=(await c.query(`INSERT INTO checklist_versions(definition_id,version,items) VALUES($1,2,$2) RETURNING id`,[d,JSON.stringify([{...item,label:'Keep bathtub'}])])).rows[0].id;
 await assert.rejects(c.query(`INSERT INTO checklist_session_items(session_id,definition_version_id,definition_item_id,instance_id) VALUES($1,$2,$3,$4)`,[f.session_id,v2,item.id,crypto.randomUUID()]),/foreign key/);
 await assert.rejects(c.query(`UPDATE checklist_sessions SET definition_version_id=$1 WHERE id=$2`,[v2,f.session_id]),/version is fixed/);
 const s=f.segment;
 await c.query(`INSERT INTO conversation_segments(id,session_id,source,source_event_id,source_ref,revision,speaker,track,timing_basis,start_ms,end_ms,text) VALUES($1,$2,$3,$4,$5,1,'unknown','mono','receiver_relative',1000,2000,$6)`,[s.id,s.session_id,s.source,s.source_event_id,s.source_ref,s.text]);
 await c.query(`INSERT INTO checklist_evidence_refs VALUES($1,$2,'suggested',0,$3,1)`,[f.session_id,f.late_items[0].item_id,s.id]);
 await assert.rejects(c.query(`INSERT INTO checklist_evidence_refs VALUES($1,$2,'suggested',1,$3,2)`,[f.session_id,f.late_items[1].item_id,s.id]),/foreign key/);
 const helperKey=crypto.randomUUID()+':'+crypto.randomUUID()+':0';assert.notEqual(helperKey,s.source_event_id);
 });
});

test('hand-typed followup stages the approval receipt and never queues a send',async()=>{
 const {stageDraftForApproval}=await import('../lib/approvals/stage-draft.ts');
 await withTestDb(async(_url,c)=>{
 const lead=(await c.query(`INSERT INTO leads(slug,name,email,scope,stage) VALUES('checklist-draft-test','Alex','alex@test.invalid','Bath','intake') RETURNING id`)).rows[0].id;
 const work=(await c.query(`INSERT INTO work_items(title,lead_id) VALUES('Follow up',$1) RETURNING id`,[lead])).rows[0].id;
 const run=async(sql,params)=>(await c.query(sql,params)).rows;
 await c.query('BEGIN');
 const staged=await stageDraftForApproval(run,{work_item_id:work,lead_id:lead,draft:'To: alex@test.invalid\nSubject: A few details for your project\n\nCould you confirm the address?',created_by:'user'});
 await c.query('COMMIT');
 const row=(await c.query(`SELECT status,approval_status FROM work_items WHERE id=$1`,[work])).rows[0];assert.equal(row.status,'approval_needed');assert.equal(row.approval_status,'requested');
 assert.equal((await c.query(`SELECT uri FROM agent_receipts WHERE work_item_id=$1 AND receipt_kind='draft'`,[work])).rows[0].uri,'knowledge_items/'+staged.knowledge_id);
 assert.equal((await c.query(`SELECT count(*)::int n FROM action_intents WHERE payload::text LIKE $1`,['%'+work+'%'])).rows[0].n,0);
 });
});
