import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {NETWORK_CASES,RSS_CASES,validateEvidence} from '../lib/browser/acceptance.mjs';
for(const name of ['containment','rss'])test(name+' plan prints exact root command without side effects',()=>{
 const r=spawnSync(process.execPath,['scripts/browser-'+name+'-check.mjs','--plan','--tag','ncheck01','--joe-uid','1010'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const plan=JSON.parse(r.stdout);
 assert.match(plan.command,/sudo systemd-run --scope/);
 assert.match(plan.command,/--unit=browser-0b-(network|rss)-ncheck01/);
 assert.match(plan.command,/--slice=user-1010-sjcosbrowser.slice/);
 assert.ok(plan.command.includes(process.cwd()));
 assert.match(plan.command,/\/opt\/sjcos-browser\/fixtures\/(network|rss)-driver/);
});
for(const name of ['network','rss'])test(name+' driver has offline validation, rejects missing nonce without launching',()=>{
 const r=spawnSync('/opt/sjcos-browser/py/bin/python',['deploy/browser/fixtures/'+name+'-driver.py','--kind',name],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.stderr,/arguments are required: --run-id/);
});
test('duplicate or extra evidence cases cannot hide an incomplete capture',()=>{
 const e={runId:'n',kind:'network',realRuntime:true,simulated:false,runtimeLockSha256:'a'.repeat(64),cases:NETWORK_CASES.map(name=>({name,passed:true})),unapprovedUpstreamBytes:0,privatePackets:0,captureIngressVerified:true,guardOrderingVerified:true};
 assert.throws(()=>validateEvidence({...e,cases:[...e.cases,{name:NETWORK_CASES[0],passed:false}]},{runId:'n',kind:'network'}));
 assert.throws(()=>validateEvidence(e,{runId:'n',kind:'other'}));
 assert.throws(()=>validateEvidence({...e,cases:[...e.cases,{name:'unexpected',passed:true}]},{runId:'n',kind:'network'}));
});
test('installer is offline and validates hashes before root writes',async()=>{
 const source=await readFile('deploy/browser/install-acceptance.sh','utf8');
 assert.match(source,/sha256/);assert.match(source,/geteuid/);assert.match(source,/0o755/);
 assert.doesNotMatch(source,/curl|wget|pip install|npm install/);
});
test('both fixture inventories remain exhaustive',()=>{assert.equal(NETWORK_CASES.length,28);assert.equal(RSS_CASES.length,15);});
import {inspectInstalledRuntime,runtimeReadiness} from '../lib/browser/runtime-readiness.mjs';
test('installed runtime checker reports absent pins/ownership without app fallback',async()=>{
 const result=await inspectInstalledRuntime('/nonexistent-sjc-fixture',{});
 assert.equal(result.ok,false);assert.ok(result.failures.includes('node-runtime-pins'));
 assert.ok(result.failures.includes('installed-hashes-manifest'));
});
test('source hashes alone do not attest parser transport integration',()=>{
 const a=Object.fromEntries(['parserPatchSha256','patchedBundleSha256','playwrightPatchSha256','pythonTransitiveLockSha256','namespaceEvidenceSha256','rssEvidenceSha256','cliResolvedPolicyEvidenceSha256','rendezvousEvidenceSha256','sandboxEvidenceSha256','reviewApprovalSha256'].map(k=>[k,'a'.repeat(64)]));
 assert.deepEqual(runtimeReadiness(a,()=>true).blockers,['parser-transport-integration']);
 assert.equal(runtimeReadiness({...a,parserTransportIntegrated:true},()=>true).ok,true);
});
