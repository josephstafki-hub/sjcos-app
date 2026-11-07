// A3b expectations first; fake S3 transport in-process, never listens/connects.
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createPublicKey,generateKeyPairSync,verify} from 'node:crypto';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createAuditCheckpointClient} from '../lib/browser/audit-checkpoint-client.mjs';
for(const scenario of ['valid','forged-signature','stale-signature','rollback','conflict','missing-lock','missing-version','wrong-host','redirect','wrong-peer','oversize','restart-highest'])test('checkpoint exporter '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);if(scenario==='valid'){const {ack,sig,public:pub}=JSON.parse(r.stdout);const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(pub,'base64')]),format:'der',type:'spki'});assert.ok(verify(null,Buffer.from(JSON.stringify(ack,Object.keys(ack).sort())),key,Buffer.from(sig,'base64')));}});
// R1 expectations registered before exporter changes: original bytes survive,
// both signatures are mandatory, head continuity survives uncertain writes.
for(const scenario of ['replay-outage','replay-stale','replay-forged','replay-original-forged','replay-future-original','replay-extra-field','replay-head-jump','replay-conflict','replay-lost-sink-ack','replay-lost-sql-ack'])test('checkpoint exporter '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);});
// R2 expectations first: quiet heads reuse the original evidence and immutable
// object version. Same-sequence substitutions must report CONFLICT, not succeed.
for(const scenario of ['unchanged-head','unchanged-restart','unchanged-lost-highest-ack','same-seq-digest','same-seq-time','same-seq-boot'])test('checkpoint exporter '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);});
test('actual JS outbox/Python exporter reconcile lost SQL ACK, then quiet ticks/shutdown/restart reuse original evidence',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'browser-r1-export-'));try{
  const service=generateKeyPairSync('ed25519'),exporterPublicKey=createPublicKey({key:Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),format:'der',type:'spki'});
  const install_id='11111111-1111-4111-8111-111111111111',head={seq:10,digest:'a'.repeat(64)};let now=Date.now(),offline=true,sqlFails=true,commits=0,objects={};const wires=[],stored=[],puts=[];
  const options={directory,install_id,boot_id:install_id,privateKey:service.privateKey,exporterPublicKey,readHead:async()=>head,clock:()=>now,commit:async()=>{commits++;if(sqlFails)throw Error('SQL_ACK_LOST');},exchange:async wire=>{
   wires.push(wire);if(offline)throw Error('OFFLINE');
   const result=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py','wire'],{input:JSON.stringify({wire,objects,now:new Date(now).toISOString(),public:service.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')}),encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);const response=JSON.parse(result.stdout);objects=response.objects;puts.push(response.puts);stored.push(response.stored);return response.ack;
  }};
  await assert.rejects(createAuditCheckpointClient(options).checkpoint(head));const original=(({replay_at,replay_sig,...cp})=>cp)(wires[0]);
  const pending=async()=>(await readdir(directory)).filter(x=>/^[0-9a-f]{64}\.json$/.test(x));
  now+=181000;offline=false;await assert.rejects(createAuditCheckpointClient(options).boot(),/SQL_ACK_LOST/);assert.equal(commits,1);assert.equal((await pending()).length,1);
  sqlFails=false;now+=1000;const resumed=createAuditCheckpointClient(options);await resumed.boot();assert.equal(commits,2);assert.equal((await pending()).length,0);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'.committed.json'),'utf8')),original);
  assert.deepEqual(stored,[original,original]);for(const w of wires.slice(1)){assert.deepEqual((({replay_at,replay_sig,...cp})=>cp)(w),original);assert.ok(Date.parse(w.replay_at)-Date.parse(w.time)>120000);}
  assert.deepEqual(puts,[2,0]);const sent=wires.length;
  for(let minute=0;minute<2;minute++){now+=61000;await resumed.tick();assert.deepEqual((await resumed.checkpoint(head)).checkpoint,original);await resumed.beforeEffect();}
  await resumed.shutdown();const restarted=createAuditCheckpointClient({...options,boot_id:'22222222-2222-4222-8222-222222222222'});await restarted.boot();
  assert.deepEqual((await restarted.checkpoint(head)).checkpoint,original);await restarted.beforeEffect();await restarted.shutdown();assert.equal(wires.length,sent);
  head.seq=100;head.digest='b'.repeat(64);await restarted.boot();await restarted.checkpoint(head);await restarted.beforeEffect();
  assert.equal(wires.length,sent+1);assert.equal(stored.at(-1).seq,100);assert.equal(puts.at(-1),2);assert.equal((await pending()).length,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
