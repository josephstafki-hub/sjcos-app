import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash,createHmac} from 'node:crypto';
import {withTestDb,withLogin} from './_harness/testdb.mjs';
import {phase1Fixture,hash} from './browser-schema-fixtures.mjs';
import {buildReadManifest,validateReadProposal,verifyReadManifest,publishReadManifest} from '../lib/browser/read-manifest.mjs';
import {browserWebReads,browserReadConsume} from '../lib/browser/repository.mjs';
import {canonical} from '../lib/browser/acceptance-attestation.mjs';
import {makeTask,makeManifest,key} from './fixtures/browser-phase1-privacy/helpers.mjs';
const denied=p=>assert.rejects(p,e=>['42501','23514','23505','40001'].includes(e.code));
function actor(task,staffSid,people){return {task,key,userId:people.staff.id,sessionId:staffSid,sessionExpiresAt:Date.now()+120000,now:Date.now(),confirmedFacts:{values:[],classifyPublicUrl:()=>true},authorize:()=>true};}
const proposal={v:1,entries:[{url:'https://portal.example/public',role:'document',source:'person'}]};
const check=(name,fn,reviewedProposal=proposal)=>test(name,()=>withTestDb((url,db)=>phase1Fixture(url,db,async x=>{
 const task={...x.task,private:false,privacy_mode:'public',origins:{v:1,entries:[{origin:'https://portal.example',role:'document'}]},document_epoch:0,read_manifest_revision:1};
 const m=buildReadManifest({proposal:reviewedProposal,actorProof:actor(task,x.staffSid,x.people),expectedRevision:1});
 const i=await x.proof('review');await browserWebReads(x.c,{tid:task.id,vid:x.viewer.id,expected_revision:1,proposal:m,decision:'approve',i,d:hash});
 const args={tid:task.id,boot:x.boot,revision:2,entry:m.initial_entry_id,manifest_d:Buffer.from(m.digest,'hex'),request_d:hash,flow_nonce:randomUUID(),generation:1,epoch:0};
 const anchor=async(a=args)=>withLogin(url,'sjcos_browser',async n=>{
  const head=(await x.c.query('SELECT seq,digest FROM browser_audit_heads WHERE singleton')).rows[0]??{seq:0,digest:Buffer.alloc(32)};
  const epoch=Number((await x.c.query('SELECT document_epoch FROM browser_tasks WHERE id=$1',[task.id])).rows[0].document_epoch);
  const binding={boot_id:a.boot,context_generation:0,revision:a.revision,entry_id:a.entry,manifest_digest:a.manifest_d.toString('hex'),request_hmac:a.request_d.toString('hex'),flow_nonce:a.flow_nonce,listener_generation:a.generation,document_epoch:epoch,control_epoch:a.epoch};
  const event_id=randomUUID(),at=new Date().toISOString(),seq=Number(head.seq)+1,data={v:1,seq,event_id,task_id:task.id,event:'read_consumed',object_id:a.flow_nonce,code:'BROWSER_OK',at,previous_digest:head.digest.toString('hex'),binding};
  const dg=createHash('sha256').update(canonical(data)).digest(),chain={v:1,previous_digest:data.previous_digest,digest:dg.toString('hex'),hmac:createHmac('sha256',key).update(dg).digest('hex'),key_id:'phase1',at,binding};
  await x.c.query('INSERT INTO app_settings(key,value) VALUES($1,$2)',['browser.audit_event.'+event_id,JSON.stringify({verified:true,digest:chain.digest,hmac:chain.hmac,key_id:chain.key_id,expires_at:new Date(Date.now()+60000).toISOString()})]);
  await n.query('SELECT browser_append_audit($1,$2,$3,$4,$5,$6)',[task.id,event_id,'read_consumed',a.flow_nonce,'BROWSER_OK',chain]);
  const ack='fixture_'+randomUUID().replaceAll('-',''),signature=Buffer.alloc(64,1);
  // Harness owner simulates independently verified sink; no production claim.
  await x.c.query('INSERT INTO app_settings(key,value) VALUES($1,$2)',['browser.checkpoint.'+ack,JSON.stringify({verified:true,through_seq:seq,digest:dg.toString('hex'),key_id:'phase1',signature:signature.toString('base64'),install_id:randomUUID(),boot_id:x.boot,sink_key_id:'sink1',sink_signature:signature.toString('base64'),expires_at:new Date(Date.now()+60000).toISOString()})]);
  await n.query('SELECT browser_checkpoint($1,$2,$3,$4,$5)',[seq,dg,'phase1',signature,ack]);return ack;
 });
 const consume=a=>withLogin(url,'sjcos_browser',n=>browserReadConsume(n,a??args));
 await fn({...x,url,db,task,m,args,anchor,consume});
})));
check('first adapter-free exact navigation consumes once after independent checkpoint',async({anchor,consume,m})=>{const ack=await anchor();const p=await consume();assert.equal(p.checkpoint_ack_id,ack);assert.equal(p.entry_id,m.initial_entry_id);assert.equal(p.use_ordinal,1);await denied(consume());});
check('no consume before independent anchor',async({consume})=>denied(consume()));
check('document budget race permits exactly one use',async({anchor,consume,args})=>{await anchor();const results=await Promise.allSettled([consume(),consume({...args,flow_nonce:randomUUID()})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);});
for(const [name,patch]of [['wrong revision',{revision:1}],['wrong digest',{manifest_d:Buffer.alloc(32,2)}],['wrong entry',{entry:randomUUID()}],['wrong listener',{generation:2}],['wrong control epoch',{epoch:1}],['wrong boot',{boot:randomUUID()}]])check(name+' refuses',async({anchor,consume,args})=>{await anchor();await denied(consume({...args,...patch}));});
check('private context cannot consume already confirmed public read',async({c,task,anchor,consume})=>{await anchor();await c.query("UPDATE browser_tasks SET private=true,privacy_mode='private',state='paused' WHERE id=$1",[task.id]);await denied(consume());});
check('lost approving session refuses even after anchor',async({c,staffSid,anchor,consume})=>{await anchor();await c.query('UPDATE web_sessions SET revoked_at=now() WHERE id=$1',[staffSid]);await denied(consume());});
check('lost required area refuses even after anchor',async({c,people,anchor,consume})=>{await anchor();await c.query("UPDATE users SET permissions=ARRAY[]::text[] WHERE id=$1",[people.staff.id]);await denied(consume());});
check('expired person presence denies future timers',async({c,viewer,anchor,consume})=>{await anchor();await c.query("UPDATE browser_viewers SET visible_until=now()-interval '1 second' WHERE id=$1",[viewer.id]);await denied(consume());});
check('later link confirmation replaces immutable revision; old proof refused',async({c,task,people,staffSid,viewer,proof,anchor,consume})=>{await anchor();const m=buildReadManifest({proposal:{v:1,entries:[{url:'https://portal.example/public/next?year=2026',role:'document',source:'page'}]},actorProof:actor({...task,read_manifest_revision:2},staffSid,people),expectedRevision:2});await browserWebReads(c,{tid:task.id,vid:viewer.id,expected_revision:2,proposal:m,decision:'approve',i:await proof('review'),d:hash});await denied(consume());});
test('canonical query order survives signature and edits invalidate HMAC',()=>{const task=makeTask(),m=buildReadManifest({proposal:{v:1,entries:[{url:'https://portal.example/public?z=a%20b&x=%41',role:'document',source:'person'}]},actorProof:{...actor(task,randomUUID(),{staff:{id:randomUUID()}})},expectedRevision:1});assert.equal(m.entries[0].canonical_url,'https://portal.example/public?z=a%20b&x=%41');const raw=structuredClone(m);raw.entries[0].canonical_url='https://portal.example/public?x=%41&z=a%20b';assert.throws(()=>verifyReadManifest(raw,{key}));});
for(const url of ['https://portal.example/a/../public','https://portal.example/%2fpublic','https://portal.example/public?a=1&a=2','https://portal.example/public?x=%252f','https://portal.example./public','https://2130706433/public','https://portal.example/public?x=%ff'])test('ambiguous URL blocked '+url,()=>{assert.equal(validateReadProposal({proposal:{v:1,entries:[{url,role:'document',source:'person'}]},task:makeTask(),confirmedFacts:{values:[],classifyPublicUrl:()=>true}}).entries.length,0);});
test('server approval, revision and session bounds required; resources default blocked',async()=>{const task=makeTask();assert.throws(()=>makeManifest(task,{authorize:()=>false}));assert.throws(()=>makeManifest(task,{sessionExpiresAt:Date.now()-1}));let sent=false;await assert.rejects(publishReadManifest({proposal,actorProof:{...actor(task,randomUUID(),{staff:{id:randomUUID()}}),confirmedFacts:null},expectedRevision:1,repository:{publishReadManifest:async()=>{sent=true;}}}));assert.equal(sent,false);});

check('resource entries bind the committed parent and serialize the last use',async({m,args,anchor,consume})=>{
 const resource={...args,entry:m.entries.find(e=>e.role==='resource').id,flow_nonce:randomUUID()};
 await denied(consume(resource)); // reserved epoch is not current before navigation
 await anchor();await consume();
 for(let i=0;i<31;i++){const a={...resource,flow_nonce:randomUUID()};await anchor(a);assert.equal((await consume(a)).use_ordinal,i+1);}
 const last={...resource,flow_nonce:randomUUID()},other={...resource,flow_nonce:randomUUID()};await anchor(last);await anchor(other);
 const results=await Promise.allSettled([consume(last),consume(other)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const exhausted={...resource,flow_nonce:randomUUID()};await anchor(exhausted);await denied(consume(exhausted));
},{v:1,entries:[...proposal.entries,{url:'https://portal.example/assets/catalog.72fa1e.js',role:'resource',source:'page'}]});
check('origin revision and revoked manifest invalidate approved reads',async({c,task,anchor,consume})=>{await anchor();await c.query('UPDATE browser_tasks SET manifest_revision=manifest_revision+1 WHERE id=$1',[task.id]);await denied(consume());});
test('manifest approval expiry and group size are bounded',()=>{
 const task=makeTask(),m=makeManifest(task);assert.throws(()=>verifyReadManifest(m,{key,now:Date.parse(m.entries[0].expires_at)}));
 const entries=[...proposal.entries,...Array.from({length:21},(_,i)=>({url:'https://portal.example/assets/'+i+'.css',role:'resource',source:'page'}))];assert.throws(()=>buildReadManifest({proposal:{v:1,entries},actorProof:actor(task,randomUUID(),{staff:{id:randomUUID()}}),expectedRevision:1}));
});

// R1 expectations first: asset discovery blocks original flow, persists a
// document+resources human review, and only deliberate new reload consumes it.
check('R1 missing public asset stages durable review without fatal gate or replay',async({c,url,task,m,args,anchor,consume,viewer,proof,people,staffSid})=>{
 await anchor();await consume();
 const {createPhase1ReadAuthority}=await import('../lib/browser/read-authority.mjs'),{createWebsiteDiscovery}=await import('../lib/browser/production-bridge.mjs'),{createProductionGate}=await import('../lib/browser/production-gate.mjs'),{generateKeyPairSync}=await import('node:crypto');
 const keys=generateKeyPairSync('ed25519'),target=randomUUID(),contextId=randomUUID();let fatal=0,handler,sends=[];
 const full=async()=>{const t=(await c.query('SELECT t.*, (SELECT max(revision) FROM browser_read_manifests WHERE task_id=t.id) read_manifest_revision FROM browser_tasks t WHERE id=$1',[task.id])).rows[0];for(const k of ['context_generation','listener_generation','control_epoch','document_epoch','read_manifest_revision'])t[k]=Number(t[k]);return t;};
 const record={task:await full()},stage=createWebsiteDiscovery({transaction:fn=>fn(c),proofKey:key,confirmedFacts:async()=>({values:[],classifyPublicUrl:()=>true})});
 let gate;gate=createProductionGate({call:async()=>({ok:true,listenerCookie:'cookie'}),onFatal:async()=>fatal++,readBridgeFor:async()=>({handle:async()=>({ok:true}),authority:createPhase1ReadAuthority({contextFor:async()=>({task:await full(),manifest:m,binding:gate.bindingForTarget(target),eligible:true,provenance:{classification:'public_nonbusiness'}}),repository:{transaction:async()=>{throw Error('no original-flow consume');}},audit:{anchorReadIntent:async()=>{throw Error('no original-flow audit');}},journal:{claim:async()=>{}},manifestKey:key,requestKey:hash,dispatchPrivateKey:keys.privateKey,dispatchPublicKey:keys.publicKey,stageDiscovery:stage,confirmedFactsFor:async()=>({values:[],classifyPublicUrl:()=>true})})})});
 const lease=await gate.open(),ctx={id:contextId,lease};await gate.attach(ctx,record);const binding=await gate.policy.bindTarget({targetId:target,browserContextId:contextId,type:'page',waitingForDebugger:true});
 await gate.policy.registerFetch({on:(event,fn)=>{if(event==='Fetch.requestPaused')handler=fn;},send:async(...x)=>sends.push(x)},binding,()=>true);
 await handler({requestId:'asset',resourceType:'Stylesheet',request:{method:'GET',url:'https://portal.example/assets/public.css'}});assert.equal(fatal,0);assert.equal(sends.at(-1)[0],'Fetch.failRequest');
 const pending=(await c.query('SELECT * FROM browser_read_manifests WHERE task_id=$1 ORDER BY revision DESC LIMIT 1',[task.id])).rows[0];assert.equal(pending.authorization_state,'pending');assert.deepEqual(pending.public_entries.candidates.map(e=>e.role),['document','resource']);
 const current=await full(),proposal={v:1,entries:pending.public_entries.candidates.map(e=>({url:e.url,role:e.role,source:e.source}))},manifest=buildReadManifest({proposal,expectedRevision:Number(pending.revision),actorProof:actor(current,staffSid,people)});
 await browserWebReads(c,{tid:task.id,vid:viewer.id,expected_revision:Number(pending.revision),proposal:manifest,decision:'approve',i:await proof('review'),d:hash});
 assert.equal((await c.query('SELECT document_epoch FROM browser_tasks WHERE id=$1',[task.id])).rows[0].document_epoch,'1','review did not replay');
 const reload={...args,revision:manifest.revision,entry:manifest.initial_entry_id,manifest_d:Buffer.from(manifest.digest,'hex'),flow_nonce:randomUUID()};await anchor(reload);assert.equal((await consume(reload)).parent_document_epoch,2);
});
