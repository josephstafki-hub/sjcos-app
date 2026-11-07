// R1 expectations BEFORE implementation: fenced contexts still lose eligibility;
// replay retains original evidence, signs fresh envelope, commits before removal;
// frame nonces are burned before await (including failed/disconnected/expired auth);
// fixed navigation hooks bind through service IO; fractional edges remain canonical.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,generateKeyPairSync,verify} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {BrowserService} from '../lib/browser/service.mjs';
import {createAuditCheckpointClient} from '../lib/browser/audit-checkpoint-client.mjs';
import {canonical} from '../lib/browser/acceptance-attestation.mjs';
import * as rpc from '../lib/browser/controller-rpc.mjs';
import {InputEvent,ControlMessage} from '../lib/browser/phase1-contracts.mjs';
import {createServiceIO} from '../lib/browser/production-bridge.mjs';
for(const state of ['private','paused','done'])test('R1 lifecycle revocation closes fenced '+state,async()=>{
 let now=100,closed=0;const io={authorizeLifecycle:async()=>false,authorize:async()=>true,fence:async()=>{},transition:async()=>{},release:async()=>{},browser:async()=>({newContext:async()=>({close:async()=>closed++})})};
 const s=new BrowserService({io,clock:()=>now,uid:1001});s.ready=true;
 const task={id:id(),person_id:id(),state:'active',context_generation:1,present_until:10000};await s.open(task);const r=s.contexts.get(task.id);r.commandsFenced=true;r.task.private=state==='private';r.task.state='paused';now+=5000;await s.tick();assert.equal(closed,1);assert.equal(s.contexts.size,0);
});
test('R1 replay after >120s keeps original signed evidence and waits for SQL commit',async()=>{
 const dir=await mkdtemp(tmpdir()+'/browser-replay-'),keys=generateKeyPairSync('ed25519'),sink=generateKeyPairSync('ed25519');let now=Date.now(),offline=true,sqlDown=false,original,wire;
 const {sign}=await import('node:crypto');
 const exchange=async cp=>{wire=cp;original??=cp;if(offline)throw Error('offline');const {replay_sig,...payload}=cp;assert.equal(cp.time,original.time);assert.equal(cp.sig,original.sig);assert.ok(verify(null,Buffer.from(canonical(payload)),keys.publicKey,Buffer.from(replay_sig,'base64')));const a={v:1,seq:cp.seq,digest:cp.digest,sink:'s3-object-lock',object_key:'fixed',version_id:'v1',retain_until:new Date(now+100000).toISOString()};return {...a,ack_sig:sign(null,Buffer.from(canonical(a)),sink.privateKey).toString('base64')};};
 const opts={directory:dir,install_id:id(),boot_id:id(),privateKey:keys.privateKey,exporterPublicKey:sink.publicKey,clock:()=>now,exchange,readHead:async()=>({seq:0}),commit:async()=>{if(sqlDown)throw Error('SQL ACK lost');}};
 try{let c=createAuditCheckpointClient(opts);await assert.rejects(c.checkpoint({seq:1,digest:'ab'.repeat(32)}));now+=181000;offline=false;sqlDown=true;c=createAuditCheckpointClient({...opts,boot_id:id()});await assert.rejects(c.boot());assert.equal((await readdir(dir)).length,1);sqlDown=false;await c.boot();assert.equal(wire.boot_id,original.boot_id);assert.equal((await readdir(dir)).filter(x=>x!=='.committed.json').length,0);}finally{await rm(dir,{recursive:true,force:true});}
});
for(const reason of ['concurrent','expired','disconnected','failed'])test('R1 frame nonce claim '+reason,async()=>{
 let now=100,closed=false,release,calls=0;const authorize=async()=>{calls++;await new Promise(r=>release=r);return reason!=='failed';};
 const claim=rpc.createFrameHandshakeAuthority({clock:()=>now});const h={nonce:id(),expires_at:new Date(200).toISOString()};const first=claim(h,{authorize,isClosed:()=>closed});await Promise.resolve();await assert.rejects(claim(h,{authorize,isClosed:()=>false}));assert.equal(calls,1);if(reason==='expired')now=201;if(reason==='disconnected')closed=true;release();if(reason==='concurrent')assert.equal(await first,true);else await assert.rejects(first);await assert.rejects(claim(h,{authorize,isClosed:()=>false}));
});
test('R1 service IO binds fixed navigation hooks',()=>{const factory=Object.fromEntries(['browser','deliverInput','fence','release','cancelAndDrainCommands','cancelObservations','stopAndAckScreencast','drainPublicOutputs','stopInputAndCapture','navigationState','prepareNavigation','guardedNavigation','pausePublic','resumePublic'].map(k=>[k,()=>k]));const io=createServiceIO({factory,db:{},common:{}});for(const k of ['navigationState','prepareNavigation','guardedNavigation'])assert.equal(io[k](),k);});
test('R1 navigation requires epochs and target at canonical boundary',()=>{const base={action:'reload',viewer_id:id(),device_secret:'a'.repeat(43),expected_epoch:1,idempotency_key:id()};assert.equal(ControlMessage.safeParse(base).success,false);const full={...base,expected_document_epoch:1,context_generation:1,read_manifest_revision:1};assert.equal(ControlMessage.safeParse(full).success,true);assert.equal(ControlMessage.safeParse({...full,action:'switch_tab'}).success,false);});
test('R1 pointer/wheel fractional edge bounds agree with factory',async()=>{const {cdpInput}=await import('../lib/browser/production-browser.mjs');for(const e of [{type:'pointer',phase:'down',x:1279.5,y:799.5,button:0,buttons:1,modifiers:[]},{type:'wheel',x:1279.5,y:799.5,delta_x:1,delta_y:2}]){assert.deepEqual(cdpInput(InputEvent.parse(e))[1].x,1279.5);for(const p of [{x:1280},{y:800},{x:-0.1},{x:Infinity}])assert.equal(InputEvent.safeParse({...e,...p}).success,false);}});

test('R1 authenticated RPC preserves recoverable review outcome for UI',async()=>{
 const {createProductionRpc}=rpc,{createHmac,createHash}=await import('node:crypto'),now=Date.now(),key=Buffer.alloc(32,1),boot=id(),payload={proof_id:null,body:{}};
 const unsigned={v:1,method:'health',task_id:null,original_run_id:null,viewer_id:null,boot_id:boot,command_id:id(),sequence:1,issued_at:new Date(now).toISOString(),expires_at:new Date(now+5000).toISOString(),nonce:id(),body_digest:createHash('sha256').update(canonical(payload)).digest('hex'),payload};
 const reply=await createProductionRpc({key,bootId:boot,consumeProof:async()=>true,handlers:{health:async()=>{throw Error('BROWSER_REVIEW_REQUIRED');}}})({...unsigned,signature:createHmac('sha256',key).update('browser-phase1-web-rpc\0').update(canonical(unsigned)).digest('hex')});assert.equal(reply.code,'BROWSER_REVIEW_REQUIRED');
});

// Tickets from a prior public turn must not become usable on the new fence.
test('R1 previous-turn public output tickets cannot cross resumed fence',async()=>{
 const {createPublicOutputFence}=await import('../lib/browser/privacy.mjs'),old=createPublicOutputFence({contextGeneration:1}),ticket=old.ticket(),next=createPublicOutputFence({contextGeneration:1});old.fence();let leaked=false;assert.equal(next.publish({ticket,task:{private:false,privacy_mode:'public',context_generation:1},sink:'model',value:'old turn',emit:()=>leaked=true}),false);assert.equal(leaked,false);
});
// Pending/forged private audit ACK cannot invoke the stream subscription adapter.
test('R1 controller frame-open refuses before subscription without verified runtime access',async()=>{const {createControllerHandlers}=await import('../lib/browser/production-bridge.mjs');let subscriptions=0;const handlers=createControllerHandlers({service:{io:{authorizeFrame:async()=>false}},key:Buffer.alloc(32,1),authorizeWeb:async()=>true,readMetadata:async()=>({}),readTask:async()=>({context_generation:1}),streamOpen:async()=>subscriptions++});await assert.rejects(handlers.stream_open({task_id:id(),viewer_id:id(),boot_id:id(),payload:{body:{stream_id:id(),stream_generation:1}}}));assert.equal(subscriptions,0);});

// R2 Watch origin display contains only the active host, never page path/query.
test('R2 runtime projection uses the current active page host',()=>{
 const s=new BrowserService({io:{},uid:1001}),task=id();const page=(target,url)=>({_targetId:target,url:()=>url});
 s.contexts.set(task,{reason:null,lastProgress:Date.now(),tabs:new Set(['a','b']),activeTarget:'b',context:{pages:new Set([page('a','https://old.example/x'),page('b','https://city.example/private?secret=canary')])}});
 assert.equal(s.projection(task).site_label,'city.example');
 const r=s.contexts.get(task);r.activeTarget=null;r.context.pages=new Set([{mainFrame:()=>({url:()=> 'https://county.example/secret?value=canary'})}]);assert.equal(s.projection(task).site_label,'county.example');
});
test('R2 protected website projection preserves the authorized task snapshot at one revision',async()=>{
 const {createWebsiteProjection}=await import('../lib/browser/production-bridge.mjs'),owner=id(),task={id:id(),state:'active',revision:7,controller_user_id:null,controller_boot_id:id(),context_generation:1};let taskReads=0;
 const project=createWebsiteProjection({ownerId:owner,transaction:fn=>fn({query:async sql=>{if(sql.includes('SELECT * FROM browser_tasks')){taskReads++;return {rows:[{...task,state:'paused',revision:8}]};}return {rows:sql.includes('FROM users')?[{name:'Taylor'}]:[{present:false}]};}}),runtimeProjection:async()=>({state_reason:null,site_label:'city.example',window_count:1})});
 const result=await project({task,viewer:null,session:{userId:owner}});assert.equal(taskReads,0);assert.equal(task.state,'active');assert.equal(task.revision,7);assert.equal(result.site_label,'city.example');
 const staff=await project({task,viewer:null,session:{userId:id()}});assert.equal(staff.site_label,null);
});
