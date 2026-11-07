// Expectations first. No browser, listener, DB or privileged filesystem writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {canonical,verifyAttestation} from '../lib/browser/acceptance-attestation.mjs';
import {NETWORK_CASES,validateEvidence,coordinatorSequence} from '../lib/browser/acceptance.mjs';
const keys=generateKeyPairSync('ed25519'), other=generateKeyPairSync('ed25519');
const now=1800000000000, hash='a'.repeat(64);
const document=()=>({format:1,purpose:'browser-0b-runtime',issuedAt:now-1000,expiresAt:now+60000,runtimeLockSha256:hash,attestation:{parserTransportIntegrated:false}});
function envelope(doc=document(),key=keys.privateKey,bytes=Buffer.from(canonical(doc))){return {payload:bytes.toString('base64'),signature:sign(null,bytes,key).toString('base64')};}
const verify=(e,options={})=>verifyAttestation(e,{publicKey:keys.publicKey,runtimeLockSha256:hash,now,...options});
test('valid independently signed candidate preserves false integration',()=>assert.equal(verify(envelope()).parserTransportIntegrated,false));
for(const [name,mutate] of [
 ['wrong purpose',d=>d.purpose='browser-0b-read'],
 ['wrong format',d=>d.format=2],
 ['wrong installed lock',d=>d.runtimeLockSha256='b'.repeat(64)],
 ['future document',d=>d.issuedAt=now+1],
 ['expired document',d=>d.expiresAt=now],
 ['unbounded lifetime',d=>d.expiresAt=now+86400001],
 ['extra document field',d=>d.secret='do not accept'],
 ['missing attestation',d=>delete d.attestation],
 ['array attestation',d=>d.attestation=[]],
])test('signed authority rejects '+name,()=>{const d=document();mutate(d);assert.throws(()=>verify(envelope(d)),/BROWSER_ATTESTATION_REFUSED/);});
test('signature from different signer fails',()=>assert.throws(()=>verify(envelope(document(),other.privateKey))));
test('noncanonical signed bytes fail including duplicate JSON keys',()=>{for(const bytes of [Buffer.from(JSON.stringify(document(),null,2)),Buffer.from(canonical(document()).replace('"format":1','"format":1,"format":1'))])assert.throws(()=>verify(envelope(document(),keys.privateKey,bytes)));});
test('extra envelope field and malformed base64 fail',()=>{for(const e of [{...envelope(),key:'caller-key'},{...envelope(),payload:'$bad'},{...envelope(),signature:'AA=='}])assert.throws(()=>verify(e));});
const network=()=>({runId:'nonce',kind:'network',realRuntime:true,simulated:false,runtimeLockSha256:hash,cases:NETWORK_CASES.map(name=>({name,passed:true,measurement:{packets:0}})),unapprovedUpstreamBytes:0,privatePackets:0,captureIngressVerified:true,guardOrderingVerified:true});
test('complete measurement inventory is still not release approval',()=>assert.deepEqual(validateEvidence(network(),{runId:'nonce',kind:'network'}),{ok:true,releaseReady:false}));
for(const [name,measurement] of [['missing',undefined],['null',null],['empty',{}],['array',[]],['string','counter'],['NaN',{packets:NaN}],['infinite',{bytes:Infinity}],['negative',{bytes:-1}],['nested invalid',{capture:{bytes:NaN}}],['oversized',{note:'x'.repeat(32769)}]])test('driver rejects '+name+' measurement',()=>{const e=network();e.cases[0].measurement=measurement;assert.throws(()=>validateEvidence(e,{runId:'nonce',kind:'network'}));});
test('driver rejects stale invocation nonce',()=>assert.throws(()=>validateEvidence(network(),{runId:'stale',kind:'network'})));
test('both plans share complete ordered absolute coordinator sequence',()=>{
 const s=coordinatorSequence({root:process.cwd(),uid:1010,tag:'integration'});
 assert.equal(s.length,6);assert.match(s[0],/unprovision-acceptance\.sh/);assert.match(s[1],/provision-acceptance\.sh/);assert.match(s[2],/runtime-check\.mjs.*--installation-only/);assert.match(s[3],/network-integration/);assert.match(s[4],/rss-integration/);assert.match(s[5],/unprovision-acceptance\.sh/);
 for(const c of s)assert.ok(c.includes(process.cwd()));
});
test('provisioning never installs dependencies, signs its own evidence or changes services',async()=>{
 const source=await readFile('deploy/browser/provision_acceptance.py','utf8');
 assert.doesNotMatch(source,/pip install|npm install|systemctl|next dev|BEGIN PRIVATE KEY/);
 for(const token of ['sjcos-browser','/usr/sbin/nologin','/var/lib/sjcos-browser','installed-hashes.json','credentialFiles','DB-less'])assert.ok(source.includes(token),token);
});
test('real provision journal preserves originals and refuses symlink/permission escapes',()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['-B','deploy/browser/provision_acceptance_tests.py'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 9 tests/);
});
for(const command of ['provision','unprovision'])test(command+' refuses nonroot before side effects',()=>{
 assert.notEqual(process.getuid(),0);
 const r=spawnSync('/bin/bash',['deploy/browser/'+command+'-acceptance.sh'],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/BROWSER_PROVISION_ROOT_REQUIRED/);
});

import {prepareAcceptance,browserMcpDependencies} from '../lib/browser/controller-adapter.mjs';
test('controller candidate cannot bootstrap root operations from an unprivileged caller',async()=>{
 assert.notEqual(process.getuid(),0);
 await assert.rejects(prepareAcceptance({runId:'11111111-1111-4111-8111-111111111111',config:{enabled:true,uid:process.getuid(),gid:process.getgid()}}),/BROWSER_CONTROLLER_REFUSED/);
});
test('explicit DB-less adapter does not import pg or attempt a connection',async()=>{
 const deps=await browserMcpDependencies({config:{databaseEnabled:false}});
 await assert.rejects(deps.connectDb('postgres://sjcos_browser@127.0.0.1/never_connect'),/BROWSER_DB_DISABLED/);
});
test('installed controller wrapper binds its entire source graph before evaluation',async()=>{
 const source=await readFile('deploy/browser/controller-adapter.mjs','utf8');
 for(const name of ['controller-authority','controller-gate','controller-rpc','controller-network','controller-mcp','controller-scenarios','protected-bootstrap','acceptance-attestation','response-budget'])assert.ok(source.includes('lib/browser/'+name+'.mjs'));
 assert.ok(source.indexOf('for(const [name,hash]')<source.indexOf('const implementation=await import'));
});
