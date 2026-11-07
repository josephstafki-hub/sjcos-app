import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {rm,readFile,mkdir,stat,symlink} from 'node:fs/promises';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {buildReadManifest} from '../lib/browser/read-manifest.mjs';
import {qaBrowserDirectory} from '../lib/browser/phase-flags.mjs';
import {qaTarget,qaGuard,qaPrivatePath,QA_ROOT,QA_PEOPLE,cannedFrame,createFakeProtocol,createQaWebsiteHooks,qaIdentity,qaProof,readScenario,writeScenario} from '../scripts/qa-browser-fake-controller.mjs';
import {seedBrowser,writeQaEnvironment,BASE_STATES,RECIPES} from '../scripts/qa-seed-browser.mjs';
import {canonical,digest,metadataBytes,verifyRpcResponse,collectMetadataPages} from '../lib/browser/web-transport.mjs';
import {decodeBinaryFrame,binaryReader} from '../lib/browser/live-view.mjs';
import {appHooks} from './phase0a-fixtures.mjs';
import {withTestDb,stopCluster} from './_harness/testdb.mjs';
appHooks();
const env={SJC_QA_SIDE_BUILD:'1',SJC_QA_BROWSER_FAKE:QA_ROOT+'-test-'+process.pid};
const dbMock=name=>({query:async()=>({rows:[{name}]})});
const oldEnv={SJC_QA_SIDE_BUILD:process.env.SJC_QA_SIDE_BUILD,SJC_QA_BROWSER_FAKE:process.env.SJC_QA_BROWSER_FAKE};
Object.assign(process.env,env);
test.after(async()=>{await rm(env.SJC_QA_BROWSER_FAKE,{recursive:true,force:true});for(const [k,v]of Object.entries(oldEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}stopCluster();});
for(const missing of ['SJC_QA_SIDE_BUILD','SJC_QA_BROWSER_FAKE'])test('hook inert without '+missing,async()=>{const e={...env};delete e[missing];let queried=false;assert.equal(await qaBrowserDirectory({query:()=>{queried=true;throw Error();}},e),null);assert.equal(queried,false);await assert.rejects(qaGuard(dbMock('sjcos_qa_test'),e));});
test('runtime actual DB name overrides QA-looking environment',async()=>{await assert.rejects(qaBrowserDirectory(dbMock('sjcos'),{...env,DATABASE_URL:'postgres://localhost/sjcos_qa_fake'}));assert.equal(await qaBrowserDirectory(dbMock('sjcos_qa_test'),env),env.SJC_QA_BROWSER_FAKE);});
for(const dir of ['/tmp/fake','/home/joe/qa-sjcos/../escape','/home/joe/qa-sjcos/a/','relative','/home/joe/qa-sjcos'])test('reject alternate path '+dir,()=>assert.rejects(qaBrowserDirectory(dbMock('sjcos_qa_test'),{...env,SJC_QA_BROWSER_FAKE:dir})));
test('CLI guards run before connection and never resolve ambient DB',()=>{for(const script of ['qa-seed-browser','qa-browser-fake-controller'])for(const [name,e]of [['sjcos',env],['sjcos_qa_test',{}]]){const r=spawnSync(process.execPath,['scripts/'+script+'.mjs',name],{encoding:'utf8',env:{...process.env,...e,SJC_QA_SIDE_BUILD:e.SJC_QA_SIDE_BUILD??'',SJC_QA_BROWSER_FAKE:e.SJC_QA_BROWSER_FAKE??'',SJC_QA_DATABASE_URL:'postgres://127.0.0.1:1/'+name}});assert.equal(r.status,1);assert.match(r.stderr,/QA_ONLY/);assert.doesNotMatch(r.stderr,/ECONNREFUSED/);}});
test('positional DB and URL must agree',()=>{assert.throws(()=>qaTarget('sjcos','postgres://localhost/sjcos'));assert.throws(()=>qaTarget('sjcos_qa_a','postgres://localhost/sjcos'));assert.throws(()=>qaTarget('sjcos_qa_a',undefined));});
test('metadata cap includes envelopes and rejects over 32KiB',()=>{assert.throws(()=>metadataBytes({padding:'x'.repeat(32768)}),/BROWSER_SERVICE_UNAVAILABLE/);assert.ok(metadataBytes({padding:'x'.repeat(32000)}).length<=32768);});
test('baseline canned JPEGs are original 1280x800 images within frame budget',async()=>{const sharp=(await import('sharp')).default;for(const name of ['permit','property']){const b=cannedFrame(name),m=await sharp(b).metadata();assert.equal(m.width,1280);assert.equal(m.height,800);assert.equal(m.format,'jpeg');assert.ok(b.length<160*1024);}});

test('QA path refuses symlinks and shared fixture directories',async()=>{
 const dir=env.SJC_QA_BROWSER_FAKE+'-paths';await mkdir(dir,{mode:0o700});try{
  await symlink(dir,dir+'/link');await assert.rejects(qaPrivatePath(dir+'/link'));
  await mkdir(dir+'/shared',{mode:0o755});await assert.rejects(qaPrivatePath(dir+'/shared'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
// Exercise B's actual UnixWebController without opening any server or listener.
// Its production socket trust path is retained and mocked only at Node IO.
let wire,wireFrame;const connected=[];
registerHooks({resolve(s,c,next){if(c.parentURL?.endsWith('/lib/browser/web-rpc.ts')&&['node:net','node:fs/promises'].includes(s))return {url:'qa-wire:'+s,shortCircuit:true};return next(s,c);},load(u,c,next){if(u.endsWith('/lib/browser/web-rpc.ts'))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,shortCircuit:true};if(u==='qa-wire:node:net')return {format:'module',source:'export const connect=(...a)=>globalThis.__qaConnect(...a);',shortCircuit:true};if(u==='qa-wire:node:fs/promises')return {format:'module',source:'export const lstat=async path=>({uid:path.startsWith("/home/joe/qa-sjcos/")?process.getuid():0,mode:0o700,isSymbolicLink:()=>false,isSocket:()=>path.endsWith(".sock"),isDirectory:()=>!path.endsWith(".sock")});',shortCircuit:true};return next(u,c);}});
globalThis.__qaConnect=path=>{connected.push(path);const socket=new EventEmitter();socket.setTimeout=()=>{};socket.destroy=()=>{};socket.write=packet=>{void (async()=>{try{const request=JSON.parse(packet.subarray(4));if(path.endsWith('/frames.sock')){socket.emit('data',await wireFrame(request));return;}const response=await wire(request),json=Buffer.from(canonical(response)),size=Buffer.alloc(4);size.writeUInt32BE(json.length);socket.emit('data',Buffer.concat([size,json]));}catch(e){socket.emit('error',e);}})();};queueMicrotask(()=>socket.emit('connect'));return socket;};
const {UnixWebController}=await import('../lib/browser/web-rpc.ts');

test('connected non-QA harness database refuses seed before filesystem writes',()=>withTestDb(async(_url,c)=>{await assert.rejects(seedBrowser(c),/BROWSER_DISABLED/);},{name:'sjcos_guard_browser',fresh:true}));

test('real harness seed idempotence, all recipes, signed fake RPC and frames',async()=>withTestDb(async(url,c)=>{
 await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
 const first=await seedBrowser(c),before=(await c.query('SELECT count(*) n FROM browser_tasks')).rows[0].n;
 await writeQaEnvironment(c,url);const side=await readFile(env.SJC_QA_BROWSER_FAKE+'/side.env','utf8');assert.match(side,/SJC_BROWSER_WEB_RPC_KEY=/);assert.match(side,/session_authorization/);assert.ok((await stat(env.SJC_QA_BROWSER_FAKE+'/side.env')).mode%512===384);
 const second=await seedBrowser(c);assert.deepEqual(second,first);assert.equal((await c.query('SELECT count(*) n FROM browser_tasks')).rows[0].n,before);
 for(const as of ['owner','staff'])for(const state of BASE_STATES){const row=first.states[as+'_'+state];assert.ok(row,as+' '+state);assert.match(row.thread_id,/^[a-f0-9-]{36}$/);}
 for(const state of Object.keys(RECIPES))assert.ok(first.states['owner_'+state]);
 const modes=await Promise.all(['request','response','frame'].map(k=>stat(env.SJC_QA_BROWSER_FAKE+'/keys/'+k+'.hex')));assert.ok(modes.every(s=>(s.mode&0o777)===0o600));
 const keys=Object.fromEntries(await Promise.all(['request','response','frame'].map(async k=>[k,Buffer.from((await readFile(env.SJC_QA_BROWSER_FAKE+'/keys/'+k+'.hex','utf8')).trim(),'hex')])));
 const website=(await c.query("SELECT pg_get_userbyid(relowner) name FROM pg_class WHERE oid='browser_tasks'::regclass")).rows[0].name;
 const protocol=await createFakeProtocol({db:c,keys,website});wire=x=>protocol.rpc(x);
 const client=new UnixWebController(keys.request,keys.response,keys.frame);
 const t=(await qaIdentity(c,website,c=>c.query('SELECT * FROM browser_tasks WHERE id=$1',[first.states.staff_working.task_id]))).rows[0];
 const binding={task_id:t.id,original_run_id:t.current_run_id,viewer_id:null,boot_id:t.controller_boot_id};
 assert.equal((await client.call('health',binding,{proof_id:null,body:{}})).qa_fixture,true);
 assert.equal(connected.at(-1),'/run/sjcos-browser/control.sock');
 const qaClient=new UnixWebController(keys.request,keys.response,keys.frame,c);
 assert.equal((await qaClient.call('health',binding,{proof_id:null,body:{}})).qa_fixture,true);
 assert.equal(connected.at(-1),env.SJC_QA_BROWSER_FAKE+'/control.sock');
 const count=connected.length;
 await assert.rejects(new UnixWebController(keys.request,keys.response,keys.frame,dbMock('sjcos')).call('health',binding,{proof_id:null,body:{}}));assert.equal(connected.length,count);
 const saved=process.env.SJC_QA_SIDE_BUILD;delete process.env.SJC_QA_SIDE_BUILD;
 await assert.rejects(qaClient.call('health',binding,{proof_id:null,body:{}}));assert.equal(connected.at(-1),'/run/sjcos-browser/control.sock');
 process.env.SJC_QA_SIDE_BUILD=saved;
 const bad=new UnixWebController(keys.request,randomBytes(32),keys.frame);await assert.rejects(bad.call('health',binding,{proof_id:null,body:{}}),/BROWSER_SERVICE_UNAVAILABLE/);
 const originalWire=wire;wire=async x=>{const r=await originalWire(x);return {...r,sequence:r.sequence+1};};await assert.rejects(client.call('health',binding,{proof_id:null,body:{}}));wire=originalWire;
 const device=Buffer.alloc(32,5),joinProof=await qaIdentity(c,website,c=>qaProof(c,t,t.initiating_web_session_id,null,'join',{}, {device_secret_hash:device.toString('hex')}));
 const repo=await import('../lib/browser/repository.mjs');const v=await qaIdentity(c,website,c=>repo.browserWebJoin(c,{tid:t.id,session:t.initiating_web_session_id,device_hash:device,role:'initiator',private_view:false,i:joinProof.i,d:joinProof.d}));
 const viewer=(await qaIdentity(c,website,c=>c.query('SELECT * FROM browser_viewers WHERE id=$1',[v.viewer_id]))).rows[0];binding.viewer_id=viewer.id;
 const p=await qaIdentity(c,website,c=>qaProof(c,t,t.initiating_web_session_id,viewer.id,'presence'));
 await client.call('stream_open',binding,{proof_id:p.id,body:{stream_id:viewer.stream_id,stream_generation:Number(viewer.stream_generation),expires_at:new Date(Date.now()+60000).toISOString()}});
 const helloUnsigned={v:1,purpose:'browser-web-frame-open',task_id:t.id,viewer_id:viewer.id,boot_id:t.controller_boot_id,stream_id:viewer.stream_id,stream_generation:Number(viewer.stream_generation),context_generation:Number(t.context_generation),issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+5000).toISOString(),nonce:randomUUID()};const hello={...helloUnsigned,signature:digest(keys.request,helloUnsigned)};
 wireFrame=h=>protocol.frame(h,0);
 const fb={task_id:t.id,viewer_id:viewer.id,boot_id:t.controller_boot_id,stream_id:viewer.stream_id,stream_generation:Number(viewer.stream_generation),context_generation:Number(t.context_generation)};
 let stop;const realFrame=await new Promise((resolve,reject)=>{qaClient.frames(fb,resolve,()=>reject(Error('frame refused'))).then(f=>{stop=f;});});stop?.();assert.deepEqual(realFrame.bytes,cannedFrame());
 const packet=await protocol.frame(hello,0),frame=decodeBinaryFrame(packet,keys.frame,{task_id:t.id,viewer_id:viewer.id});assert.equal(frame.header.width,1280);assert.deepEqual(frame.bytes,cannedFrame());
 let frames=0,errors=0;const read=binaryReader({key:keys.frame,binding:{task_id:t.id},onFrame:()=>frames++,onError:()=>errors++});read(packet.subarray(0,9));read(packet.subarray(9));assert.equal(frames,1);read(packet);assert.equal(errors,1);
 await assert.rejects(protocol.frame(hello,0));
 // A real current manifest page, signed by fake and checked by B.
 const result=await client.pages('read_manifest',binding,async()=>{const p=await qaIdentity(c,website,c=>qaProof(c,t,t.initiating_web_session_id,viewer.id,'presence'));return {proof_id:p.id,body:{}};});assert.equal(result.items.length,1);
 const ownerSid=(await qaIdentity(c,website,c=>c.query('SELECT initiating_web_session_id sid FROM browser_tasks WHERE id=$1',[first.states.owner_working.task_id]))).rows[0].sid;
 const publicWatch=await qaProof(c,t,ownerSid,null,'watch');await repo.browserWebOwnerView(c,{tid:t.id,aid:null,session:ownerSid,local_thread:null,i:publicWatch.i});
 const publicJoin=await qaProof(c,t,ownerSid,null,'join',{}, {device_secret_hash:device.toString('hex')});
 await assert.rejects(repo.browserWebJoin(c,{tid:t.id,session:ownerSid,device_hash:device,role:'owner_review',private_view:true,i:publicJoin.i,d:publicJoin.d}),/BROWSER_PRIVATE_INPUT_REQUIRED/);
 const publicViewer=await repo.browserWebJoin(c,{tid:t.id,session:ownerSid,device_hash:device,role:'owner_review',private_view:false,i:publicJoin.i,d:publicJoin.d});
 const takeoverBody={action:'take_over',viewer_id:viewer.id,device_secret:'a'.repeat(43),expected_epoch:Number(t.control_epoch),idempotency_key:randomUUID()};
 const takeProof=await qaIdentity(c,website,c=>qaProof(c,t,t.initiating_web_session_id,viewer.id,'takeover',takeoverBody));
 const take=await client.call('control',binding,{proof_id:takeProof.id,body:takeoverBody});assert.equal(take.proof_metadata.drained,true);
 const privateTask=(await qaIdentity(c,website,c=>c.query('SELECT * FROM browser_tasks WHERE id=$1',[t.id]))).rows[0];assert.equal(privateTask.private,true);
 assert.equal((await c.query('SELECT owner_private_view_authorized_at FROM browser_viewers WHERE id=$1',[publicViewer.viewer_id])).rows[0].owner_private_view_authorized_at,null);
 const watch=await qaIdentity(c,website,c=>qaProof(c,privateTask,ownerSid,null,'watch'));
 await qaIdentity(c,website,c=>repo.browserWebOwnerView(c,{tid:t.id,aid:null,session:ownerSid,local_thread:null,i:watch.i}));
 const joinOwner=async consent=>{const p=await qaIdentity(c,website,c=>qaProof(c,privateTask,ownerSid,null,'join',{}, {device_secret_hash:device.toString('hex'),...(consent?{private_context_generation:Number(privateTask.context_generation),private_authorization_revision:Number(privateTask.revision)}:{})}));return qaIdentity(c,website,c=>repo.browserWebJoin(c,{tid:t.id,session:ownerSid,device_hash:device,role:'owner_review',private_view:consent,i:p.i,d:p.d}));};
 const ownerViewer=await joinOwner(false),ov=(await qaIdentity(c,website,c=>c.query('SELECT * FROM browser_viewers WHERE id=$1',[ownerViewer.viewer_id]))).rows[0];
 const op=await qaIdentity(c,website,c=>qaProof(c,privateTask,ownerSid,ov.id,'presence'));
 await client.call('stream_open',{...binding,viewer_id:ov.id},{proof_id:op.id,body:{stream_id:ov.stream_id,stream_generation:Number(ov.stream_generation),expires_at:new Date(Date.now()+60000).toISOString()}});
 const ownerHello=()=>{const h={...helloUnsigned,viewer_id:ov.id,stream_id:ov.stream_id,stream_generation:Number(ov.stream_generation),context_generation:Number(privateTask.context_generation),nonce:randomUUID()};return {...h,signature:digest(keys.request,h)};};
 await assert.rejects(protocol.frame(ownerHello(),0));
 await joinOwner(true);await assert.rejects(protocol.frame(ownerHello(),0));const ap=await qaIdentity(c,website,c=>qaProof(c,privateTask,ownerSid,ov.id,'presence',{}, {qa_private_watch:true}));await client.call('presence',{...binding,viewer_id:ov.id},{proof_id:ap.id,body:{viewer_id:ov.id,visible:true,generation:Number(ov.stream_generation),idempotency_key:randomUUID()}});const privatePacket=await protocol.frame(ownerHello(),0);assert.deepEqual(decodeBinaryFrame(privatePacket,keys.frame,{viewer_id:ov.id}).bytes,cannedFrame('property'));
 // Renewing consent invalidates the old checkpoint until a new exact binding is anchored.
 await joinOwner(true);await assert.rejects(protocol.frame(ownerHello(),0));
 const renewed=await qaIdentity(c,website,c=>qaProof(c,privateTask,ownerSid,ov.id,'presence',{}, {qa_private_watch:true}));
 const pendingScenario=await readScenario(c,env.SJC_QA_BROWSER_FAKE);pendingScenario.tasks[t.id].audit_pending=true;await writeScenario(env.SJC_QA_BROWSER_FAKE,pendingScenario);
 await client.call('presence',{...binding,viewer_id:ov.id},{proof_id:renewed.id,body:{viewer_id:ov.id,visible:true,generation:Number(ov.stream_generation),idempotency_key:randomUUID()}});
 await assert.rejects(protocol.frame(ownerHello(),0));
 assert.equal((await c.query('SELECT browser_p1_private_view(t,v) allowed FROM browser_tasks t JOIN browser_viewers v ON v.task_id=t.id WHERE v.id=$1',[ov.id])).rows[0].allowed,false);
 pendingScenario.tasks[t.id].audit_pending=false;await writeScenario(env.SJC_QA_BROWSER_FAKE,pendingScenario);
 const recovery=await qaProof(c,privateTask,ownerSid,ov.id,'presence',{}, {qa_private_watch:true});
 await client.call('presence',{...binding,viewer_id:ov.id},{proof_id:recovery.id,body:{viewer_id:ov.id,visible:true,generation:Number(ov.stream_generation),idempotency_key:randomUUID()}});
 assert.ok(await protocol.frame(ownerHello(),0));
 const next=await seedBrowser(c,{state:'resource_20'});assert.notEqual(next.states.staff_resource_review.task_id,t.id);
 const rt=(await qaIdentity(c,website,c=>c.query('SELECT * FROM browser_tasks WHERE id=$1',[next.states.staff_resource_review.task_id]))).rows[0];
 const liveCount=(await qaIdentity(c,website,c=>c.query("SELECT count(*)::int n FROM browser_tasks WHERE state IN ('queued','starting','active','paused')"))).rows[0].n;assert.equal(liveCount,2);
 const rbind={task_id:rt.id,original_run_id:rt.current_run_id,viewer_id:null,boot_id:rt.controller_boot_id};
 const paged=await collectMetadataPages(async page=>{const p=await qaIdentity(c,website,c=>qaProof(c,rt,rt.initiating_web_session_id,null,'presence'));const {ok,...r}=await client.call('read_manifest',rbind,{proof_id:p.id,body:page});return r;},{limit:1});assert.equal(paged.items.length,20);
 const stored=await readScenario(c,env.SJC_QA_BROWSER_FAKE);assert.equal(stored.selected,'resource_20');
 // Every recipe can be selected and replayed, preserving the two-context limit.
 for(const state of [...BASE_STATES,...Object.keys(RECIPES)].filter(s=>s!=='off')){
  const selected=await seedBrowser(c,{state});assert.equal(selected.selected,state);
  assert.deepEqual(await seedBrowser(c,{state}),selected);
  const row=selected.states['staff_'+state],entry=selected.tasks[row?.task_id];
  if(['guarded_menu','reload_confirm'].includes(state))assert.equal(entry.navigation,true);
  if(state==='pre_frame_close')assert.equal(entry.no_frames,true);
  if(state==='watch_audit_pending')assert.equal(entry.audit_pending,true);
  if(state==='pre_frame_close'||state==='guarded_menu'){
   const st=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[row.task_id])).rows[0],dev=Buffer.alloc(32,11),jp=await qaProof(c,st,st.initiating_web_session_id,null,'join',{}, {device_secret_hash:dev.toString('hex')});
   const joined=await repo.browserWebJoin(c,{tid:st.id,session:st.initiating_web_session_id,device_hash:dev,role:'initiator',private_view:false,i:jp.i,d:jp.d});
   const sv=(await c.query('SELECT * FROM browser_viewers WHERE id=$1',[joined.viewer_id])).rows[0],sb={task_id:st.id,original_run_id:st.current_run_id,viewer_id:sv.id,boot_id:st.controller_boot_id};
   const call=async(method,body)=>{const p=await qaProof(c,st,st.initiating_web_session_id,sv.id,'presence');return client.call(method,sb,{proof_id:p.id,body});};
   if(state==='guarded_menu'){
    const revision=Number((await c.query('SELECT max(revision) revision FROM browser_read_manifests WHERE task_id=$1',[st.id])).rows[0].revision);
    const body={action:'reload',viewer_id:sv.id,device_secret:'a'.repeat(43),idempotency_key:randomUUID(),expected_epoch:Number(st.control_epoch),expected_document_epoch:Number(st.document_epoch),context_generation:Number(st.context_generation),read_manifest_revision:revision};
    assert.equal((await call('control',body)).qa_navigation_only,true);
    await assert.rejects(call('control',{...body,expected_document_epoch:body.expected_document_epoch+1}),/BROWSER_REVIEW_STALE/);
   }else{
    const stream={stream_id:sv.stream_id,stream_generation:Number(sv.stream_generation)};
    await call('stream_open',{...stream,expires_at:new Date(Date.now()+60000).toISOString()});
    const h={...helloUnsigned,task_id:st.id,viewer_id:sv.id,boot_id:st.controller_boot_id,...stream,context_generation:Number(st.context_generation),nonce:randomUUID()};
    assert.equal(await protocol.frame({...h,signature:digest(keys.request,h)},0),null);
    await assert.rejects(call('stream_close',{...stream,stream_generation:stream.stream_generation+1,planned:true}),/BROWSER_STREAM_STALE/);
    assert.equal((await call('stream_close',{...stream,planned:true})).ok,true);
    const closed={...h,nonce:randomUUID()};await assert.rejects(protocol.frame({...closed,signature:digest(keys.request,closed)},0));
    assert.equal((await c.query('SELECT state FROM browser_tasks WHERE id=$1',[st.id])).rows[0].state,'active');
   }
  }

  if(['exact_path_review','exact_resource_review'].includes(state)){
   const m=(await c.query('SELECT public_entries FROM browser_read_manifests WHERE task_id=$1 ORDER BY revision DESC LIMIT 1',[row.task_id])).rows[0].public_entries;
   assert.ok(m.candidates.some(e=>e.role==='document'));
   if(state==='exact_path_review')assert.equal(m.candidates[0].url,'https://city.example/permits/details');
   else assert.ok(m.candidates.some(e=>e.role==='resource'));
  }
 }
 // Real Continue attaches a distinct immutable run and capability after the SQL resume fence.
 const continuing=await seedBrowser(c,{state:'working',refresh:true}),ct=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[continuing.states.staff_working.task_id])).rows[0];
 const device2=Buffer.alloc(32,9),jp=await qaProof(c,ct,ct.initiating_web_session_id,null,'join',{}, {device_secret_hash:device2.toString('hex')});
 const cv=await repo.browserWebJoin(c,{tid:ct.id,session:ct.initiating_web_session_id,device_hash:device2,role:'initiator',private_view:false,i:jp.i,d:jp.d});
 const pool={query:(...args)=>c.query(...args),connect:async()=>({query:(...args)=>c.query(...args),release:()=>{}})};
 const hooks=await createQaWebsiteHooks({db:pool,key:keys.request,dir:env.SJC_QA_BROWSER_FAKE});
 const rp=await qaProof(c,ct,ct.initiating_web_session_id,cv.viewer_id,'resume');
 await repo.browserWebControl(c,{tid:ct.id,vid:cv.viewer_id,op:'resume',epoch:Number(ct.control_epoch),i:rp.i,d:rp.d});
 await hooks.start({task:ct,viewer:{id:cv.viewer_id},session:{sid:ct.initiating_web_session_id}});
 const resumed=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[ct.id])).rows[0];assert.notEqual(resumed.current_run_id,ct.current_run_id);assert.equal(Number(resumed.listener_generation),Number(ct.listener_generation)+1);
 const runRows=(await c.query('SELECT * FROM browser_task_runs WHERE task_id=$1 ORDER BY created_at',[ct.id])).rows;assert.equal(runRows.length,2);assert.equal(runRows[0].disposition,'stopped');assert.ok(runRows[1].capability_expires_at);
 await assert.rejects(hooks.start({task:resumed,viewer:{id:cv.viewer_id},session:{sid:ct.initiating_web_session_id}}),/BROWSER_REVIEW_PENDING/);
 // Fresh keeps the trusted boot, rotates independent generations, and stages new review.
 await qaIdentity(c,'sjcos_browser',c=>repo.browserEnterPrivate(c,{tid:resumed.id,boot:resumed.controller_boot_id,expected_epoch:Number(resumed.control_epoch),mode:'private'}));
 const priv=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[resumed.id])).rows[0];
 const fp=await qaProof(c,priv,priv.initiating_web_session_id,cv.viewer_id,'fresh_browser',{}, {drained:true,fenced:true,context_generation:Number(priv.context_generation),old_generation:Number(priv.context_generation),new_boot_id:priv.controller_boot_id});
 await repo.browserWebControl(c,{tid:priv.id,vid:cv.viewer_id,op:'fresh_browser',epoch:Number(priv.control_epoch),i:fp.i,d:fp.d});
 const fresh=(await c.query('SELECT * FROM browser_tasks WHERE id=$1',[priv.id])).rows[0];assert.equal(fresh.controller_boot_id,priv.controller_boot_id);assert.equal(Number(fresh.context_generation),Number(priv.context_generation)+1);assert.equal(Number(fresh.listener_generation),Number(priv.listener_generation)+1);
 await assert.rejects(hooks.start({task:fresh,viewer:{id:cv.viewer_id},session:{sid:fresh.initiating_web_session_id}}),/BROWSER_REVIEW_REQUIRED/);
 await hooks.discover({task:{...fresh,context_generation:Number(fresh.context_generation)},proposal:{v:1,entries:[{url:'https://city.example/permits/details',role:'document',source:'person'},{url:'https://city.example/assets/public-1.css',role:'resource',source:'page'}]}});
 const discovery=(await c.query('SELECT * FROM browser_read_manifests WHERE task_id=$1 ORDER BY revision DESC LIMIT 1',[fresh.id])).rows[0];assert.equal(discovery.authorization_state,'pending');assert.equal(discovery.public_entries.candidates.length,2);
 await assert.rejects(hooks.start({task:fresh,viewer:{id:cv.viewer_id},session:{sid:fresh.initiating_web_session_id}}),/BROWSER_REVIEW_REQUIRED/);
 const proposal={v:1,entries:discovery.public_entries.candidates.map(e=>({url:e.url,role:e.role,source:e.source}))};
 const manifest=buildReadManifest({proposal,expectedRevision:Number(discovery.revision),actorProof:{key:createHmac('sha256',keys.request).update('browser-phase1-read-manifest-key').digest(),task:{...fresh,document_epoch:Number(fresh.document_epoch),read_manifest_revision:Number(discovery.revision)},confirmedFacts:await hooks.confirmedFacts(),userId:fresh.initiator_user_id,sessionId:fresh.initiating_web_session_id,sessionExpiresAt:Date.now()+3600000,authorize:()=>true}});
 const approval=await qaProof(c,fresh,fresh.initiating_web_session_id,cv.viewer_id,'review');
 await repo.browserWebReads(c,{tid:fresh.id,vid:cv.viewer_id,expected_revision:Number(discovery.revision),proposal:manifest,decision:'approve',i:approval.i,d:approval.d});
 const freshRun=await hooks.start({task:fresh,viewer:{id:cv.viewer_id},session:{sid:fresh.initiating_web_session_id}});assert.notEqual(freshRun.run_id,resumed.current_run_id);
 const off=await seedBrowser(c,{state:'off'});assert.equal(off.selected,'off');assert.equal((await qaIdentity(c,website,c=>c.query("SELECT value FROM app_settings WHERE key='browser.enabled'"))).rows[0].value,'false');

}, {name:'sjcos_qa_browser_fixture',fresh:true}));
