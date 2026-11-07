// A3b expectations first; fake S3 transport in-process, never listens/connects.
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {createPublicKey,generateKeyPairSync,verify} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createAuditCheckpointClient} from '../lib/browser/audit-checkpoint-client.mjs';
for(const scenario of ['valid','forged-signature','stale-signature','rollback','conflict','missing-lock','missing-version','wrong-host','redirect','wrong-peer','oversize','restart-highest'])test('checkpoint exporter '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);if(scenario==='valid'){const {ack,sig,public:pub}=JSON.parse(r.stdout);const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(pub,'base64')]),format:'der',type:'spki'});assert.ok(verify(null,Buffer.from(JSON.stringify(ack,Object.keys(ack).sort())),key,Buffer.from(sig,'base64')));}});
// R1 expectations registered before exporter changes: original bytes survive,
// both signatures are mandatory, head continuity survives uncertain writes.
for(const scenario of ['replay-outage','replay-stale','replay-forged','replay-original-forged','replay-future-original','replay-extra-field','replay-head-jump','replay-conflict','replay-lost-sink-ack','replay-lost-sql-ack'])test('checkpoint exporter '+scenario,()=>{const r=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py',scenario],{encoding:'utf8'});assert.equal(r.status,0,r.stderr+r.stdout);});
test('actual JS outbox restart replays >120s evidence through Python, retains spool until SQL ACK',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'browser-r1-export-'));try{
  const service=generateKeyPairSync('ed25519'),exporterPublicKey=createPublicKey({key:Buffer.from('302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),format:'der',type:'spki'});
  const install_id='11111111-1111-4111-8111-111111111111',head={seq:10,digest:'a'.repeat(64)};let now=Date.now(),offline=true,sqlFails=true,commits=0;const wires=[],stored=[];
  const options={directory,install_id,boot_id:install_id,privateKey:service.privateKey,exporterPublicKey,readHead:async()=>head,clock:()=>now,commit:async()=>{commits++;if(sqlFails)throw Error('SQL_ACK_LOST');},exchange:async wire=>{
   wires.push(wire);if(offline)throw Error('OFFLINE');
   const result=spawnSync('python3',['-I','-B','deploy/browser/checkpoint_exporter_tests.py','wire'],{input:JSON.stringify({wire,now:new Date(now).toISOString(),public:service.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')}),encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);const response=JSON.parse(result.stdout);stored.push(response.stored);return response.ack;
  }};
  await assert.rejects(createAuditCheckpointClient(options).checkpoint(head));const original=(({replay_at,replay_sig,...cp})=>cp)(wires[0]);
  now+=181000;offline=false;await assert.rejects(createAuditCheckpointClient(options).boot(),/SQL_ACK_LOST/);assert.equal(commits,1);assert.ok((await readdir(directory)).some(x=>x.endsWith('.json')));
  sqlFails=false;now+=1000;await createAuditCheckpointClient(options).boot();assert.equal(commits,2);assert.ok(!(await readdir(directory)).some(x=>x.endsWith('.json')));
  assert.deepEqual(stored,[original,original]);for(const w of wires.slice(1)){assert.deepEqual((({replay_at,replay_sig,...cp})=>cp)(w),original);assert.ok(Date.parse(w.replay_at)-Date.parse(w.time)>120000);}
 }finally{await rm(directory,{recursive:true,force:true});}
});
