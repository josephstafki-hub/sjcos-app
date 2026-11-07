import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {withTestDb,withLogin} from './_harness/testdb.mjs';
import {phase1Fixture,hash} from './browser-schema-fixtures.mjs';
import {browserWebReadCandidates,browserWebPresence,browserReadConsume} from '../lib/browser/repository.mjs';
const check=(name,fn)=>test(name,()=>withTestDb((url,db)=>phase1Fixture(url,db,x=>fn({...x,url}))));
function candidate(task){return {id:id(),url:'https://portal.example/public',role:'document',source:'page',code:'BROWSER_REVIEW_REQUIRED',server_deadline:new Date(Date.now()+55000).toISOString(),parent_document_epoch:Number(task.document_epoch)+1};}
check('candidate staging is pending, immutable and gives no transmit authority',async({c,task,viewer,proof})=>{
 const proposal={v:1,candidates:[candidate(task)]},i=await proof('review');
 const result=await browserWebReadCandidates(c,{tid:task.id,vid:viewer.id,expected_revision:1,proposal,i,d:hash});
 assert.equal(result.revision,2);assert.deepEqual(result.candidates,proposal.candidates);
 const row=(await c.query('SELECT * FROM browser_read_manifests WHERE task_id=$1',[task.id])).rows[0];
 assert.equal(row.authorization_state,'pending');assert.equal(row.approved_by_user_id,null);
 await assert.rejects(c.query("UPDATE browser_read_manifests SET public_entries='{}' WHERE task_id=$1",[task.id]));
 await assert.rejects(c.query("UPDATE browser_read_manifests SET authorization_state='approved',approved_by_user_id=$2,approved_by_session_id=$3 WHERE task_id=$1",[task.id,viewer.user_id,viewer.web_session_id]));
});
check('two concurrent candidate revisions serialize to one winner',async({c,task,viewer,proof})=>{
 const request={tid:task.id,vid:viewer.id,expected_revision:1,proposal:{v:1,candidates:[candidate(task)]},d:hash};
 const a=await proof('review'),b=await proof('review');const results=await Promise.allSettled([browserWebReadCandidates(c,{...request,i:a}),browserWebReadCandidates(c,{...request,i:b})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});
for(const kind of ['expired','overlong','origin','epoch','private'])check('candidates refuse '+kind,async({c,task,viewer,proof})=>{
 const value=candidate(task);
 if(kind==='expired')value.server_deadline=new Date(Date.now()-1).toISOString();
 if(kind==='overlong')value.server_deadline=new Date(Date.now()+65000).toISOString();
 if(kind==='origin')value.url='https://evil.example/public';
 if(kind==='epoch')value.parent_document_epoch++;
 if(kind==='private')await c.query("UPDATE browser_tasks SET private=true,privacy_mode='private' WHERE id=$1",[task.id]);

 const i=await proof('review');

 await assert.rejects(browserWebReadCandidates(c,{tid:task.id,vid:viewer.id,expected_revision:1,proposal:{v:1,candidates:[value]},i,d:hash}));
});
check('service cannot stage candidates even with guessed website proof',async({url,task,viewer,proof})=>{
 const i=await proof('review');await withLogin(url,'sjcos_browser',c=>assert.rejects(browserWebReadCandidates(c,{tid:task.id,vid:viewer.id,expected_revision:1,proposal:{v:1,candidates:[candidate(task)]},i,d:hash})));
});
check('presence renews only matching unexpired exclusive control',async({c,task,viewer,proof})=>{
 await c.query('UPDATE browser_tasks SET controller_user_id=$2,controller_device_hash=$3,control_expires_at=clock_timestamp()+interval \'2 seconds\' WHERE id=$1',[task.id,viewer.user_id,viewer.device_hash]);
 const i=await proof('presence',{safe_result:{conversation_id:task.conversation_id}});
 const result=await browserWebPresence(c,{vid:viewer.id,visible:true,generation:Number(viewer.stream_generation),i});assert.equal(typeof result.control_expires_at,'string');assert.equal(result.control_expires_at,result.present_until);
});
check('expired task control never revives through presence',async({c,task,viewer,proof})=>{
 await c.query('UPDATE browser_tasks SET controller_user_id=$2,controller_device_hash=$3,control_expires_at=clock_timestamp()-interval \'1 second\' WHERE id=$1',[task.id,viewer.user_id,viewer.device_hash]);
 const i=await proof('presence',{safe_result:{conversation_id:task.conversation_id}});
 const result=await browserWebPresence(c,{vid:viewer.id,visible:true,generation:Number(viewer.stream_generation),i});assert.equal(result.control_expires_at,null);
});

import {browserWebModelBudget} from '../lib/browser/repository.mjs';
check('model budget is durable and cannot decrease after interrupted turn',async({c,task,run})=>{
 const args={tid:task.id,rid:run,elapsed_ms:1200,turn_count:3,cost_micros:500};
 const b=await browserWebModelBudget(c,args);assert.equal(b.active_ms,1200);assert.equal(b.turns,3);
 await assert.rejects(browserWebModelBudget(c,{...args,elapsed_ms:1199}));
 assert.deepEqual(await browserWebModelBudget(c,args),b);
});
check('model budget exhausts at sixty turns and one-use reads still require audit ACK',async({c,task,run,viewer,proof,url})=>{
 const b=await browserWebModelBudget(c,{tid:task.id,rid:run,elapsed_ms:2000,turn_count:60,cost_micros:100});assert.equal(b.exhausted,true);
 await withLogin(url,'sjcos_browser',service=>assert.rejects(browserReadConsume(service,{tid:task.id,boot:task.controller_boot_id,revision:1,entry:id(),manifest_d:hash,request_d:hash,flow_nonce:id(),generation:1,epoch:Number(task.control_epoch)})));
});
import {runBrowserRetention} from '../lib/browser/retention.mjs';
check('owner retention scrubs old approved read payload but retains digest and revision',async({c,people,staffSid,thread})=>{
 const task=(await c.query("INSERT INTO browser_tasks(initiator_user_id,conversation_id,purpose,required_areas,origins,state,initiating_web_session_id,closed_at,created_at,updated_at) VALUES($1,$2,'old terminal',ARRAY['ai'],'{}','closed',$3,now()-interval '31 days',now()-interval '32 days',now()-interval '31 days') RETURNING *",[people.staff.id,thread,staffSid])).rows[0];
 await c.query("INSERT INTO browser_read_manifests(task_id,revision,task_origins_revision,public_entries,manifest_hmac,initial_entry_id,authorization_state,approved_by_user_id,approved_by_session_id,expires_at,created_at) VALUES($1,1,1,'{\"old_public_query\":\"payload\"}',$2,$3,'approved',$4,$5,now()-interval '31 days',now()-interval '32 days')",[task.id,hash,id(),people.staff.id,staffSid]);
 const result=await runBrowserRetention({transaction:async fn=>{await c.query('BEGIN');try{const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}},cache:Object.fromEntries(['tombstone','invalidate','purge','complete'].map(k=>[k,async()=>{}]))});
 assert.equal(result.tasks_scrubbed,1);
 const row=(await c.query('SELECT public_entries,payload_purged_at,manifest_hmac,revision FROM browser_read_manifests WHERE task_id=$1',[task.id])).rows[0];assert.deepEqual(row.public_entries,{});assert.ok(row.payload_purged_at);assert.equal(row.revision,1);assert.ok(row.manifest_hmac.equals(hash));
});
