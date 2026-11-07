import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {withTestDb,withLogin} from './_harness/testdb.mjs';
import {phase1Fixture,hash} from './browser-schema-fixtures.mjs';
import {browserWebReadCandidates,browserWebPresence,browserReadConsume} from '../lib/browser/repository.mjs';
const check=(name,fn)=>test(name,()=>withTestDb((url,db)=>phase1Fixture(url,db,x=>fn({...x,url})),{fresh:true}));
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

// R1 expectations first: completed retention batches advance, including cache-only
// tasks; a SQL commit/cache completion crash retries safely before advancing.
check('R1 retention advances past completed bounded tasks and reconciles cache ACK loss',async({c,people,staffSid,thread})=>{
 const retentionSid=(await c.query("INSERT INTO web_sessions(user_id,auth_at,expires_at) VALUES($1,now()-interval '2 hours',now()+interval '1 hour') RETURNING id",[people.staff.id])).rows[0].id;
 const ids=[];for(let n=0;n<3;n++){
 const message=(await c.query("INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','confirmed') RETURNING id",[thread])).rows[0].id;
 const answers=n===2?[]:[{id:id(),revision:1,field_key:'test',label:'Test',value:'confirmed',source_message_id:message,confirmed_at:new Date().toISOString()}];
 ids.push((await c.query("INSERT INTO browser_tasks(initiator_user_id,conversation_id,purpose,required_areas,origins,state,initiating_web_session_id,closed_at,confirmed_answers) VALUES($1,$2,'old answers/cache',ARRAY['ai'],'{}','closed',$3,now()-interval '31 days',$4) RETURNING id",[people.staff.id,thread,retentionSid,JSON.stringify(answers)])).rows[0].id);
 }
 await c.query("UPDATE web_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[retentionSid]);
 const tx=async fn=>{await c.query('BEGIN');try{const v=await fn(c);await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}};const completed=new Set();let crash=true;
 const cache={tombstone:async()=>{},invalidate:async()=>{},purge:async()=>{},complete:async id=>{if(crash){crash=false;throw Error('lost cache ACK');}completed.add(id);}};
 await assert.rejects(runBrowserRetention({transaction:tx,cache,limit:1}));for(let n=0;n<3;n++)assert.equal((await runBrowserRetention({transaction:tx,cache,limit:1})).tasks_scrubbed,1);
 assert.equal(completed.size,3);assert.equal((await c.query('SELECT sum(jsonb_array_length(confirmed_answers)) n FROM browser_tasks WHERE id=ANY($1)',[ids])).rows[0].n,'0');assert.equal((await runBrowserRetention({transaction:tx,cache,limit:1})).tasks_scrubbed,0);
});
check('R1 private Watch refuses advance consent and clears all old consent on boundary',async({c,url,task,run,ownerSid,people,proof,boot})=>{
 await c.query("INSERT INTO browser_owner_views(task_id,original_run_id,viewing_owner_user_id,web_session_id,initiator_user_id,conversation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '1 hour')",[task.id,run,people.owner.id,ownerSid,people.staff.id,task.conversation_id]);
 const {browserWebJoin,browserEnterPrivate}=await import('../lib/browser/repository.mjs');
 const p=async()=>{const t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id])).rows[0];return proof('join',{sid:ownerSid,vid:null,safe_result:{device_secret_hash:hash.toString('hex'),private_context_generation:Number(t.context_generation),private_authorization_revision:Number(t.revision)}});};
 await assert.rejects(browserWebJoin(c,{tid:task.id,session:ownerSid,device_hash:hash,role:'owner_review',private_view:true,i:await p(),d:hash}),/BROWSER_PRIVATE_INPUT_REQUIRED/);
 const joined=await browserWebJoin(c,{tid:task.id,session:ownerSid,device_hash:hash,role:'owner_review',private_view:false,i:await p(),d:hash});
 await c.query('UPDATE browser_viewers SET owner_private_view_authorized_at=now(),owner_private_context_generation=0,owner_private_authorization_revision=1 WHERE id=$1',[joined.viewer_id]);
 const beforeTransitionProof=await p();
 await withLogin(url,'sjcos_browser',s=>browserEnterPrivate(s,{tid:task.id,boot,expected_epoch:Number(task.control_epoch),mode:'private'}));
 const v=(await c.query('SELECT * FROM browser_viewers WHERE id=$1',[joined.viewer_id])).rows[0];assert.equal(v.owner_private_view_authorized_at,null);assert.equal(v.owner_private_context_generation,null);
 await assert.rejects(browserWebJoin(c,{tid:task.id,session:ownerSid,device_hash:hash,role:'owner_review',private_view:true,i:beforeTransitionProof,d:hash}),/BROWSER_REVIEW_STALE/);
 await browserWebJoin(c,{tid:task.id,session:ownerSid,device_hash:hash,role:'owner_review',private_view:true,i:await p(),d:hash});
 const allowed=(await c.query('SELECT browser_p1_private_view(t,v) AS allowed FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[joined.viewer_id])).rows[0];assert.equal(allowed.allowed,false,'outbox or consent without independent audit ACK cannot release images');
 const {mkdtemp,rm,readdir}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{generateKeyPairSync,createHash,createHmac,sign}=await import('node:crypto'),{canonical}=await import('../lib/browser/acceptance-attestation.mjs');
 const directory=await mkdtemp(tmpdir()+'/private-watch-'),install=generateKeyPairSync('ed25519'),sink=generateKeyPairSync('ed25519');let offline=true,loseSqlAck=true;const sinkAcks=new Map();
 const {createProtectedAuditWriter}=await import('../lib/browser/audit-service.mjs'),{createProductionAudit}=await import('../lib/browser/audit-checkpoint-client.mjs');
 const writer=createProtectedAuditWriter({transaction:fn=>fn(c),eventKey:hash,installationPublicKey:install.publicKey,sinkPublicKey:sink.publicKey});
 const head=async()=>{const h=(await c.query('SELECT seq,digest FROM browser_audit_heads WHERE singleton')).rows[0];return h?{seq:Number(h.seq),digest:h.digest.toString('hex')}:{seq:0,digest:'00'.repeat(32)};};
 const binding=(await c.query('SELECT browser_p1_private_binding(t,v) binding FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[joined.viewer_id])).rows[0].binding;
 try{await withLogin(url,'sjcos_browser',async n=>{
  const audit=createProductionAudit({directory,install_id:id(),boot_id:boot,privateKey:install.privateKey,exporterPublicKey:sink.publicKey,writer,transaction:async fn=>{const result=await fn(n);if(result.recorded&&loseSqlAck){loseSqlAck=false;throw Error('lost SQL ACK after commit');}return result;},readHead:head,exchange:async cp=>{if(offline)throw Error('sink down');if(sinkAcks.has(cp.seq))return sinkAcks.get(cp.seq);const a={v:1,seq:cp.seq,digest:cp.digest,sink:'s3-object-lock',object_key:'anchor/'+cp.seq,version_id:'v1',retain_until:new Date(Date.now()+86400000).toISOString()};const ack={...a,ack_sig:sign(null,Buffer.from(canonical(a)),sink.privateKey).toString('base64')};sinkAcks.set(cp.seq,ack);return ack;},stageEvent:async intent=>{
   const h=await head(),event={v:1,seq:h.seq+1,event_id:id(),task_id:task.id,event:'viewer_joined',object_id:joined.viewer_id,code:'BROWSER_OK',at:new Date().toISOString(),previous_digest:h.digest,binding:intent.binding};
   const chain={v:1,previous_digest:h.digest,digest:createHash('sha256').update(canonical(event)).digest('hex'),hmac:createHmac('sha256',hash).update('browser-phase1-audit\0').update(canonical(event)).digest('hex'),key_id:'test',at:event.at,binding:event.binding};
   await writer.event({event,chain});return {tid:task.id,event_id:event.event_id,event:event.event,object_id:event.object_id,code:event.code,chain};
  }});
  const {createRuntimeAccess}=await import('../lib/browser/production-bridge.mjs'),access=createRuntimeAccess({transaction:fn=>fn(n)}),frameBinding={task_id:task.id,viewer_id:joined.viewer_id,boot_id:boot,context_generation:binding.context_generation,stream_id:binding.stream_id,stream_generation:binding.stream_generation};
  assert.equal(await access.authorizeFrame(frameBinding),false);
  await audit.checkpoints.boot();await assert.rejects(audit.anchorPrivateView({binding:{...binding,stream_id:id()}}));
  await assert.rejects(audit.anchorPrivateView({binding}));assert.equal((await c.query('SELECT browser_p1_private_view(t,v) allowed FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[joined.viewer_id])).rows[0].allowed,false);
  offline=false;await assert.rejects(audit.checkpoints.beforeEffect(),/lost SQL ACK/);assert.equal((await readdir(directory)).length,1);await audit.checkpoints.beforeEffect();assert.equal((await readdir(directory)).length,0);assert.equal((await c.query('SELECT count(*) n FROM browser_audit_checkpoints')).rows[0].n,'1');assert.equal((await c.query('SELECT browser_p1_private_view(t,v) allowed FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[joined.viewer_id])).rows[0].allowed,true);
  assert.equal(await access.authorizeFrame(frameBinding),true);
  await browserWebJoin(c,{tid:task.id,session:ownerSid,device_hash:hash,role:'owner_review',private_view:true,i:await p(),d:hash});assert.equal(await access.authorizeFrame(frameBinding),false,'fresh consent serial needs its own ACK; old timestamp cannot authorize it');
  await c.query('UPDATE browser_viewers SET stream_generation=stream_generation+1 WHERE id=$1',[joined.viewer_id]);assert.equal((await c.query('SELECT browser_p1_private_view(t,v) allowed FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[joined.viewer_id])).rows[0].allowed,false);
 });}finally{await rm(directory,{recursive:true,force:true});}

});

// R1: actual offer/accept records (no invented boot/generation), attach and
// capability flow reach service + gate; Continue retains old immutable runs.
check('R1 actual admission boot and independent listener generation reach service/gate',async({c,url,task,viewer,people,staffSid,thread,boot})=>{
 const repo=await import('../lib/browser/repository.mjs');
 await c.query("UPDATE browser_tasks SET state='closed',closed_at=now() WHERE state IN ('queued','starting','active','paused')");
 const {buildReadManifest}=await import('../lib/browser/read-manifest.mjs'),draft={private:false,privacy_mode:'public',origins:{v:1,entries:[{origin:'https://portal.example',role:'document'}]},document_epoch:0,read_manifest_revision:0};
 const manifest=buildReadManifest({proposal:{v:1,entries:[{url:'https://portal.example/public',role:'document',source:'person'}]},expectedRevision:0,actorProof:{task:draft,confirmedFacts:{values:[],classifyPublicUrl:()=>true},key:hash,userId:people.staff.id,sessionId:staffSid,sessionExpiresAt:Date.now()+300000,authorize:()=>true}});
 const admitted=await repo.browserWebAdmit(c,{conversation:thread,project:null,kind:'public_research',manifest:{purpose:'admitted',origins:draft.origins,initial_read:manifest},session:staffSid,i:id(),d:hash});assert.equal(admitted.controller_boot_id,null);
 const stage=async(op,vid=null,meta={})=>{const i=id();await c.query("INSERT INTO browser_web_commands(task_id,session_id,viewer_id,operation,idempotency_key,body_digest,safe_result,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 seconds')",[admitted.id,staffSid,vid,op,i,hash,meta]);return i;};
 const j=await repo.browserWebJoin(c,{tid:admitted.id,session:staffSid,device_hash:hash,role:'initiator',private_view:false,i:await stage('join',null,{device_secret_hash:hash.toString('hex')}),d:hash});
 await withLogin(url,'sjcos_browser',s=>repo.browserQueueOffer(s,{boot}));
 let t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[admitted.id])).rows[0];assert.equal(t.controller_boot_id,boot);
 await repo.browserWebQueue(c,{tid:t.id,vid:j.viewer_id,op:'accept',i:await stage('accept_offer',j.viewer_id,{boot_id:t.controller_boot_id}),d:hash});
 const run=(await c.query("INSERT INTO dev_agent_runs(prompt,profile,launch_source,with_mcp,principal_user_id,conversation_id,browser_task_id) VALUES('turn','browser','panel_web',true,$1,$2,$3) RETURNING id",[people.staff.id,thread,t.id])).rows[0].id;
 const attached=await repo.browserWebAttachRun(c,{tid:t.id,rid:run,vid:j.viewer_id,expected_epoch:Number(t.control_epoch),i:await stage('attach_run',j.viewer_id)});
 const binding={pid:123,start_ticks:'1',cgroup:'/browser',boot_id:attached.controller_boot_id};await repo.browserWebCapability(c,{tid:t.id,rid:run,vid:j.viewer_id,server_kind:'browser',process_binding:binding,i:await stage('capability',j.viewer_id,{process_binding:binding})});
 t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[t.id])).rows[0];for(const k of ['context_generation','listener_generation'])t[k]=Number(t[k]);assert.equal(t.context_generation,1);
 const {BrowserService}=await import('../lib/browser/service.mjs'),{createRuntimeAccess}=await import('../lib/browser/production-bridge.mjs');
 await withLogin(url,'sjcos_browser',async s=>{const access=createRuntimeAccess({transaction:fn=>fn(s)}),service=new BrowserService({uid:1001,io:{...access,authorize:async()=>access.authorizeLifecycle(t),browser:async()=>({newContext:async()=>({id:id(),close:async()=>{}})})}});service.ready=true;await service.open({...t,person_id:t.initiator_user_id});
 const {createProductionGate}=await import('../lib/browser/production-gate.mjs');let bound;const gate=createProductionGate({readBridgeFor:async()=>({authority:{phase:1},handle:async()=>({ok:true})}),call:async x=>{if(x.op==='bind')bound=x.binding;return {ok:true,listenerCookie:'cookie'};}}),lease=await gate.open(),ctx={id:id(),lease};await gate.attach(ctx,service.contexts.get(t.id));await gate.policy.bindTarget({targetId:id(),browserContextId:ctx.id,type:'page',waitingForDebugger:true});assert.equal(bound.generation,t.listener_generation);});
});
for(const end of ['waiting','completed'])check('R1 '+end+' Continue attaches a new immutable run after final control fence',async({c,url,task,run,viewer,proof,boot})=>{
 const repo=await import('../lib/browser/repository.mjs');await withLogin(url,'sjcos_browser',s=>repo.browserRunEnd(s,{tid:task.id,rid:run,disposition:end,boot}));
 let t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id])).rows[0];assert.equal(t.current_run_id,run);
 await c.query("UPDATE browser_viewers SET visible_until=now()+interval '15 seconds' WHERE id=$1",[viewer.id]);
 await repo.browserWebControl(c,{tid:t.id,vid:viewer.id,op:'resume',epoch:Number(t.control_epoch),i:await proof('resume'),d:hash});t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id])).rows[0];
 await c.query('UPDATE browser_read_manifests SET revoked_at=now() WHERE task_id=$1 AND revoked_at IS NULL',[t.id]);
 const next=(await c.query("INSERT INTO dev_agent_runs(prompt,profile,launch_source,with_mcp,principal_user_id,conversation_id,browser_task_id) VALUES('next','browser','panel_web',true,$1,$2,$3) RETURNING id",[t.initiator_user_id,t.conversation_id,t.id])).rows[0].id;
 await repo.browserWebAttachRun(c,{tid:t.id,rid:next,vid:viewer.id,expected_epoch:Number(t.control_epoch),i:await proof('attach_run')});
 const binding={pid:124,start_ticks:'2',cgroup:'/browser',boot_id:boot},cap=await repo.browserWebCapability(c,{tid:t.id,rid:next,vid:viewer.id,server_kind:'browser',process_binding:binding,i:await proof('capability',{safe_result:{process_binding:binding}})});
 await withLogin(url,'sjcos_browser',async s=>{await repo.browserAuthorize(s,{tid:t.id,rid:next,k:Buffer.from(cap.capability_hash,'hex')});await assert.rejects(repo.browserAuthorize(s,{tid:t.id,rid:run,k:hash}));});assert.equal((await c.query('SELECT count(*) FROM browser_task_runs WHERE task_id=$1',[t.id])).rows[0].count,'2');
});

for(const change of ['master','staff','session','rights','inactive'])check('R1 fenced private lifecycle closes on real DB '+change,async({c,url,task,people,staffSid})=>{
 const {BrowserService}=await import('../lib/browser/service.mjs'),{createRuntimeAccess}=await import('../lib/browser/production-bridge.mjs');
 await withLogin(url,'sjcos_browser',async n=>{const access=createRuntimeAccess({transaction:fn=>fn(n)});let now=Date.now(),closed=0;const saved=(await n.query("SELECT browser_enter_private($1,$2,$3,'private') AS task",[task.id,task.controller_boot_id,Number(task.control_epoch)])).rows[0].task;const current={...task,...saved,person_id:task.initiator_user_id,context_generation:Number(task.context_generation),present_until:now+15000};
 // Fixture starts at generation zero; exercise existing runtime lifecycle only.
 const service=new BrowserService({uid:1001,clock:()=>now,io:{...access,fence:async()=>{},release:async()=>{},transition:async()=>{},authorize:async()=>true}});service.contexts.set(task.id,{task:current,commandsFenced:true,observations:new Set(),reads:new Set(),registry:{clear(){}},outputFence:{fence(){}},context:{close:async()=>closed++},lastProgress:now,presentUntil:now+15000});
 if(change==='master'||change==='staff')await c.query('UPDATE app_settings SET value=\'false\' WHERE key=$1',['browser.'+(change==='master'?'enabled':'staff_enabled')]);
 if(change==='session')await c.query('UPDATE web_sessions SET revoked_at=now() WHERE id=$1',[staffSid]);
 if(change==='rights')await c.query("UPDATE users SET permissions=ARRAY[]::text[] WHERE id=$1",[people.staff.id]);
 if(change==='inactive')await c.query('UPDATE users SET active=false WHERE id=$1',[people.staff.id]);
 now+=5000;await service.tick();assert.equal(closed,1);assert.equal(service.contexts.size,0);
 });
});

check('R1 private fresh browser gets new reviewed public turn through committed continuation adapter',async({c,url,task,run,viewer,proof,boot,staffSid,people})=>{
 const repo=await import('../lib/browser/repository.mjs'),{BrowserService}=await import('../lib/browser/service.mjs'),{createWebsiteStart,createControllerHandlers,createRuntimeAccess}=await import('../lib/browser/production-bridge.mjs');
 await withLogin(url,'sjcos_browser',async n=>{
  await repo.browserEnterPrivate(n,{tid:task.id,boot,expected_epoch:0,mode:'private'});
  let closed=0,opened=0;const access=createRuntimeAccess({transaction:fn=>fn(n)}),service=new BrowserService({uid:1001,io:{...access,authorize:async t=>access.authorizeLifecycle(t),fence:async()=>{},release:async()=>{},browser:async()=>({newContext:async()=>{opened++;return {id:id(),close:async()=>closed++};}})}});service.ready=true;
  const load=async()=>{const t=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[task.id])).rows[0];for(const k of ['context_generation','listener_generation','control_epoch','document_epoch'])t[k]=Number(t[k]);return {...t,person_id:t.initiator_user_id,present_until:Date.now()+15000};};
  let t=await load();service.contexts.set(t.id,{task:t,context:{close:async()=>closed++},commandsFenced:true,outputFence:{fence(){}},observations:new Set(),registry:{clear(){}},tabs:new Set()});
  const handlers=createControllerHandlers({service,key:hash,readMetadata:async()=>({}),readTask:load,authorizeWeb:async x=>{const p=(await c.query("SELECT * FROM browser_web_commands WHERE id=$1 AND task_id=$2 AND operation IN ('fresh_browser','resume') AND expires_at>clock_timestamp()",[x.payload.proof_id,x.task_id])).rows[0];return !!p;}});
  const i=await proof('fresh_browser'),x={task_id:t.id,viewer_id:viewer.id,payload:{proof_id:(await c.query('SELECT id FROM browser_web_commands WHERE idempotency_key=$1',[i])).rows[0].id,body:{action:'fresh_browser'}}},ack=(await handlers.control(x)).proof_metadata;
  assert.equal(closed,1);assert.equal(service.contexts.size,0);await c.query('UPDATE browser_web_commands SET safe_result=$2 WHERE idempotency_key=$1',[i,ack]);
  await repo.browserWebControl(c,{tid:t.id,vid:viewer.id,op:'fresh_browser',epoch:t.control_epoch,i,d:hash});t=await load();assert.equal(t.controller_boot_id,boot);assert.equal(t.private,false);assert.equal(t.context_generation,1);
  const tx=async fn=>{await c.query('BEGIN');try{const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};
  let issued,released=0;const start=createWebsiteStart({transaction:tx,proofKey:hash,authorizeRecord:async()=>true,reconcile:async()=>{},supervisor:async()=>({reservation_id:id()}),controller:{call:async(_m,b,p)=>handlers.control({...b,payload:p})},runner:{spawnHeld:async()=>({}),register:async()=>({pid:125,start_ticks:'3',cgroup:'/browser',boot_id:boot}),bindCapability:async(_r,_p,cap)=>issued=cap,release:async()=>released++,cancel:async()=>{}}});
  const request={task:t,viewer,session:{sid:staffSid},device_secret:'a'.repeat(43),idempotency_key:id()};await assert.rejects(start(request),/BROWSER_REVIEW_REQUIRED/);assert.equal(released,0);
  const {buildReadManifest}=await import('../lib/browser/read-manifest.mjs'),m=buildReadManifest({proposal:{v:1,entries:[{url:'https://portal.example/public',role:'document',source:'person'}]},expectedRevision:1,actorProof:{task:{...t,origins:{v:1,entries:[{origin:'https://portal.example',role:'document'}]},read_manifest_revision:1},key:hash,confirmedFacts:{values:[],classifyPublicUrl:()=>true},userId:people.staff.id,sessionId:staffSid,sessionExpiresAt:Date.now()+300000,authorize:()=>true}});
  await repo.browserWebReads(c,{tid:t.id,vid:viewer.id,expected_revision:1,proposal:m,decision:'approve',i:await proof('review'),d:hash});
  const result=await start({...request,idempotency_key:id()});assert.notEqual(result.run_id,run);assert.equal(opened,1);assert.equal(released,1);assert.equal(service.contexts.get(t.id).task.current_run_id,result.run_id);await repo.browserAuthorize(n,{tid:t.id,rid:result.run_id,k:Buffer.from(issued.capability_hash,'hex')});await assert.rejects(repo.browserAuthorize(n,{tid:t.id,rid:run,k:hash}));
 });
});
