import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {guardTarget} from '../lib/browser/target-barrier.mjs';
import {namespacePlan,browserRules,gateRules} from '../deploy/browser/containment.mjs';
import {runtimeReadiness,verifyRuntimeFiles,sha256} from '../lib/browser/runtime-readiness.mjs';
function barrier(type='page'){const calls=[];return {calls,args:{session:{send:async name=>calls.push(name)},target:{type,waitingForDebugger:true},binding:{generation:1},validateBinding:async()=>true,registerFetch:async()=>calls.push('handlers'),registerChildren:async()=>calls.push('children'),closeTarget:async()=>calls.push('close'),revokeListener:async()=>calls.push('revoke')}};}
test('barrier event order installs same-session Fetch before resume',async()=>{const {args,calls}=barrier();assert.equal((await guardTarget(args)).ok,true);assert.deepEqual(calls,['handlers','Fetch.enable','children','Runtime.runIfWaitingForDebugger']);});
for(const type of ['worker','shared_worker','service_worker','other','browser','unknown'])test('never resume '+type,async()=>{const {args,calls}=barrier(type);assert.equal((await guardTarget(args)).ok,false);assert.deepEqual(calls,['revoke','close']);});
test('barrier missing callback, bad binding or Fetch error revoke before closing',async()=>{for(const key of ['validateBinding','registerFetch']){const {args,calls}=barrier();args[key]=async()=>{throw Error('sensitive');};assert.equal((await guardTarget(args)).ok,false);assert.equal(calls.includes('Runtime.runIfWaitingForDebugger'),false);assert.deepEqual(calls.slice(-2),['revoke','close']);}});
test('late timed-out barrier continuation cannot resume',async()=>{const {args,calls}=barrier();let resolve;args.registerFetch=()=>new Promise(r=>resolve=r);args.timeoutMs=5;assert.equal((await guardTarget(args)).ok,false);resolve();await new Promise(r=>setImmediate(r));assert.equal(calls.includes('Runtime.runIfWaitingForDebugger'),false);});
test('disposable namespace recipe has no host NAT, forwarding or live names',()=>{const p=namespacePlan('1234abcd');assert.equal(Object.keys(p.names).length,3);for(const [cmd,args]of p.commands){assert.equal(cmd,'ip');assert.equal(args.includes('sjcos-browser'),false);}assert.match(browserRules(),/policy drop/);assert.match(browserRules(),/18081,18082/);assert.doesNotMatch(browserRules(),/udp.*accept/);assert.match(gateRules(),/168\.63\.129\.16/);assert.match(gateRules(),/ip6 daddr != 2000::\/3/);assert.throws(()=>namespacePlan(';rm'));});
test('static resume census is exhaustive against the pinned source fingerprint',async()=>{const c=JSON.parse(await readFile('deploy/browser/playwright-resume-census.json'));assert.equal(c.bundleSha256,'829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d');assert.equal(c.occurrences.filter(x=>x.text.includes('Runtime.runIfWaitingForDebugger')).length,7);for(const row of c.occurrences)assert.equal(sha256(row.text),row.sha256);});
test('incomplete attestation can never activate runtime',()=>{assert.equal(runtimeReadiness({},()=>true).ok,false);assert.equal(runtimeReadiness({},()=>false).blockers.includes('signed-root-attestation'),true);});
test('Python dispatcher escapes log-and-continue, addon refuses stock runtime',()=>{
 const code=String.raw`
import asyncio,importlib.util,sys,types,contextlib

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,file); mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
m=types.SimpleNamespace();dead=[]
d=load('dispatcher','deploy/browser/closed_dispatcher.py');d.install(m,lambda:dead.append(True))
try:
 with m.safecall():raise ValueError('secret')
except d.GateFatal as e:assert str(e)=='BROWSER_ADDON_FAILED'
else:raise AssertionError('exception forwarded')
assert dead==[True]
class Manager:
 def __init__(self):self.chain=[object()]
 async def trigger_event(self,event):pass
 def trigger(self,event):pass
manager=Manager();d.seal(types.SimpleNamespace(addons=manager),manager.chain[0],lambda:dead.append(True));manager.chain=[]
try:asyncio.run(manager.trigger_event(None))
except d.GateFatal as e:assert str(e)=='BROWSER_ADDON_SET_CHANGED'
else:raise AssertionError('hot removal accepted')
class Master:
 def shutdown(self):self.stopped=True
master=Master();ctx=types.SimpleNamespace(master=master)
sys.modules['mitmproxy']=types.SimpleNamespace(ctx=ctx)
a=load('gate','deploy/browser/egress_gate.py').EgressGate()
try:a.running()
except RuntimeError:pass
else:raise AssertionError('stock runtime accepted')
assert master.stopped and a.dead
class Flow:
 def kill(self):self.killed=True
flow=Flow()
try:asyncio.run(a.request(flow))
except RuntimeError as e:assert str(e)=='BROWSER_REVOKED'
else:raise AssertionError('forwarded after loss')
assert flow.killed
`;
 // request re-raises by design: caller confirms kill before dispatcher fatal.
 const r=spawnSync('python3',['-B','-c',code],{encoding:'utf8',timeout:10000,maxBuffer:8192});assert.equal(r.status,0,r.stderr);
});
test('timeout during final binding recheck cannot schedule a late resume',async()=>{const {args,calls}=barrier();let resolve,n=0;args.validateBinding=async()=>++n===1?true:await new Promise(r=>resolve=r);args.timeoutMs=5;assert.equal((await guardTarget(args)).ok,false);resolve(true);await new Promise(r=>setImmediate(r));assert.equal(calls.includes('Runtime.runIfWaitingForDebugger'),false);});
test('versioned file manifest hashes the exact addon, dispatcher, gate and patch spec',async()=>{const lock=JSON.parse(await readFile('deploy/browser/runtime-lock.json','utf8'));assert.equal((await verifyRuntimeFiles(process.cwd(),lock)).ok,true);assert.equal(lock.acceptance.releaseReady,false);assert.equal(lock.acceptance.parserPatchSha256,null);});
test('Python broker validates kernel identity before credential/claim access',()=>{const code=String.raw`
import sys
sys.path.insert(0,'deploy/browser')
from launch_broker import validate_peer
r={'runId':'run','uid':42,'pid':123,'startTime':'456','cgroup':'isolated','nodeDigest':'node','executables':{'browser':'wrapper'}}
p={'uid':42,'startTime':'457','ancestors':[{'pid':123,'startTime':'456'}],'cgroup':'isolated','executableDigest':'node','scriptDigest':'wrapper'}
q={'runId':'run','kind':'browser'}
assert validate_peer(r,q,p)
for k,v in [('uid',43),('cgroup','host'),('ancestors',[{'pid':123,'startTime':'old'}]),('scriptDigest','other'),('executableDigest','other')]:
 assert not validate_peer(r,q,{**p,k:v})
assert not validate_peer(r,{**q,'capability':'forged'},p)
`;
 const r=spawnSync('python3',['-B','-c',code],{encoding:'utf8',timeout:10000,maxBuffer:8192});assert.equal(r.status,0,r.stderr);
});
