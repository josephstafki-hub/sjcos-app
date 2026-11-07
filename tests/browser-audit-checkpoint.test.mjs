import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {canonical} from '../lib/browser/acceptance-attestation.mjs';
import {createAuditCheckpointClient,verifyExporterAck} from '../lib/browser/audit-checkpoint-client.mjs';
const service=generateKeyPairSync('ed25519'),exporter=generateKeyPairSync('ed25519'),install_id=randomUUID(),boot_id=randomUUID();
const record=(seq=1)=>({seq,digest:'a'.repeat(64)});
const ack=(cp,patch={})=>{const p={v:1,seq:cp.seq,digest:cp.digest,sink:'s3-object-lock',object_key:'anchors/'+cp.seq,version_id:'version-1',retain_until:new Date(Date.now()+86400000).toISOString(),...patch};return {...p,ack_sig:sign(null,Buffer.from(canonical(p)),exporter.privateKey).toString('base64')};};
async function fixture(fn){const directory=await mkdtemp(tmpdir()+'/a3a-checkpoint-');const committed=[];const opts={directory,install_id,boot_id,privateKey:service.privateKey,exporterPublicKey:exporter.publicKey,exchange:async cp=>ack(cp),commit:async x=>committed.push(x),readHead:async()=>record()};try{await fn({opts,directory,committed,client:createAuditCheckpointClient(opts)});}finally{await rm(directory,{recursive:true,force:true});}}
test('forged exporter signature refuses',()=>{const cp=record(),a=ack(cp);a.ack_sig=Buffer.alloc(64).toString('base64');assert.throws(()=>verifyExporterAck(cp,a,exporter.publicKey));});
test('wrong sequence refuses even with valid signature',()=>assert.throws(()=>verifyExporterAck(record(),ack(record(),{seq:2}),exporter.publicKey)));
test('wrong digest refuses even with valid signature',()=>assert.throws(()=>verifyExporterAck(record(),ack(record(),{digest:'b'.repeat(64)}),exporter.publicKey)));
test('wrong sink refuses',()=>assert.throws(()=>verifyExporterAck(record(),ack(record(),{sink:'local'}),exporter.publicKey)));
test('missing acknowledgement leaves spool intact',()=>fixture(async({opts,directory})=>{const c=createAuditCheckpointClient({...opts,exchange:async()=>({v:1,error:'OFFLINE'})});await assert.rejects(c.checkpoint(record()));assert.equal((await readdir(directory)).length,1);}));
test('checkpoint commits before removing outbox',()=>fixture(async({opts,directory})=>{const c=createAuditCheckpointClient({...opts,commit:async()=>{assert.equal((await readdir(directory)).length,1);}});await c.checkpoint(record());assert.equal((await readdir(directory)).filter(x=>x!=='.committed.json').length,0);}));
test('SQL checkpoint failure retains signed entry',()=>fixture(async({opts,directory})=>{await assert.rejects(createAuditCheckpointClient({...opts,commit:async()=>{throw Error();}}).checkpoint(record()));assert.equal((await readdir(directory)).length,1);}));
test('boot replay orders checkpoints by sequence, not filename hash',()=>fixture(async({opts,directory})=>{const off=createAuditCheckpointClient({...opts,exchange:async()=>{throw Error();}});await assert.rejects(off.checkpoint(record(20)));await assert.rejects(off.checkpoint(record(21))); const seen=[];await createAuditCheckpointClient({...opts,commit:async x=>seen.push(x.checkpoint.seq)}).boot();assert.deepEqual(seen,[20]);assert.equal((await readdir(directory)).filter(x=>x!=='.committed.json').length,0);}));
test('spool full refuses before exporter or new effect',()=>fixture(async({opts})=>{let sent=false;const c=createAuditCheckpointClient({...opts,maxBytes:1,exchange:async cp=>{sent=true;return ack(cp);}});await assert.rejects(c.checkpoint(record()),/BROWSER/);assert.equal(sent,false);}));
test('hundred events force checkpoint and shutdown reuses head',()=>fixture(async({opts,committed})=>{const client=createAuditCheckpointClient({...opts,readHead:async()=>record(100)});await client.boot();for(let n=1;n<=100;n++)await client.event(record(n));assert.ok(committed.some(x=>x.checkpoint.seq===100));await client.shutdown();assert.equal(committed.length,1);}));
test('minute tick checkpoints head; no timer needed in tests',()=>fixture(async({opts,committed})=>{let clock=Date.now();const c=createAuditCheckpointClient({...opts,clock:()=>clock});await c.boot();clock+=60000;await c.tick();assert.ok(committed.length>=1);}));

// R2 expectations first: one original signed identity per head across quiet
// ticks, explicit retries, shutdown, restart, and SQL acknowledgement loss.
test('R2 unchanged checkpoint retains exact signed evidence across restart and SQL ACK loss',()=>fixture(async({opts,directory})=>{
 let now=Date.now(),loseSql=true;const originals=new Map(),sent=[];
 const options={...opts,clock:()=>now,exchange:async cp=>{const {replay_at,replay_sig,...original}=cp;void replay_at;void replay_sig;const old=originals.get(cp.seq);if(old)assert.deepEqual(original,old);else originals.set(cp.seq,original);sent.push(original);return ack(cp);},commit:async()=>{if(loseSql){loseSql=false;throw Error('SQL ACK lost');}}};
 let c=createAuditCheckpointClient(options);await c.boot();await assert.rejects(c.checkpoint(record()),/SQL ACK lost/);now+=61000;
 await c.checkpoint(record());await c.tick();await c.checkpoint(record());await c.shutdown();
 c=createAuditCheckpointClient(options);await c.boot();now+=61000;await c.tick();await c.shutdown();
 assert.equal(originals.size,1);assert.equal(sent.length,2);assert.equal((await readdir(directory)).filter(x=>x!=='.committed.json').length,0);
 await assert.rejects(c.checkpoint({...record(),digest:'b'.repeat(64)}),/BROWSER/);
}));
