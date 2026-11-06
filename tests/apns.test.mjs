import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {buildPushPayload,categoryFor,providerJwt,sendApns,fakeApnsDeliveries} from '../lib/providers/apns.ts';
const id=crypto.randomUUID();
test('payload stays within 4 KB for Unicode and preserves routing',()=>{
 const m={id,kind:'decision',title:'Approve the draft',body:'😀'.repeat(6000),thread_key:`decision:${id}`,category:'SJC_DECISION',decision_id:id,content_hash:'abcdef',sends:true,href:'/engine/decisions'};
 const p=buildPushPayload(m,3);assert.equal(p.aps.alert.title,m.title);assert.equal(m.title,'Approve the draft');assert.ok(Buffer.byteLength(JSON.stringify(p))<=4096);assert.ok(p.aps.alert.body.endsWith('…'));assert.equal(p.sjc.approvalKey,`decision:${id}`);assert.equal(p.sjc.dest.type,'approval');assert.equal(p.sjc.sends,true);
});
test('categories mirror available verbs',()=>{
 assert.equal(categoryFor({kind:'decision',decision_id:id}),'SJC_DECISION');assert.equal(categoryFor({kind:'grant',decision_id:id}),'SJC_GRANT');
 for(const sends of [false,true])assert.equal(categoryFor({kind:'decision',work_item_id:id,sends}),sends?'SJC_DRAFT_SEND':'SJC_DRAFT');
 for(const kind of ['reply','ack','portal_message'])assert.equal(categoryFor({kind}),'SJC_REPLY');
 for(const kind of ['payment','contract_signed','sms_inbound','voice_call','comms','agent_failure','urgent_item','test'])assert.equal(categoryFor({kind}),'SJC_INFO');
});
test('ES256 JWT signature and 50 minute cache',()=>{
 const dir=mkdtempSync(`${tmpdir()}/sjc-apns-test-`),pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 try{const path=`${dir}/test.p8`;writeFileSync(path,pair.privateKey.export({type:'pkcs8',format:'pem'}));process.env.APNS_KEY_PATH=path;process.env.APNS_KEY_ID='test';
 const now=Date.now(),token=providerJwt(now),[h,c,s]=token.split('.');assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'ES256');assert.ok(verify('sha256',Buffer.from(`${h}.${c}`),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url')));assert.equal(providerJwt(now+49*60_000),token);assert.notEqual(providerJwt(now+51*60_000),token);
 }finally{delete process.env.APNS_KEY_PATH;delete process.env.APNS_KEY_ID;rmSync(dir,{recursive:true});}
});
test('fake delivery records payload without full device token',async()=>{process.env.SJC_OUTBOUND_DISABLED='1';const token=crypto.randomUUID().replaceAll('-','').repeat(2);await sendApns({token,environment:'sandbox'},{aps:{badge:2}});assert.deepEqual(fakeApnsDeliveries.at(-1),{tokenSuffix:token.slice(-6),payload:{aps:{badge:2}}});});
