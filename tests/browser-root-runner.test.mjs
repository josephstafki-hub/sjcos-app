import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRunnerArgs,commandFailure,withNamespaces,selectedCases,assertMeasuredCase} from '../lib/browser/root-runner.mjs';
import {NETWORK_CASES,validateEvidence,coordinatorSequence} from '../lib/browser/acceptance.mjs';
test('case selection rejects typos before mutation and preserves complete default inventory',()=>{
 assert.deepEqual(selectedCases('network'),NETWORK_CASES);
 assert.deepEqual(selectedCases('network','dns-rebind'),['dns-rebind']);
 assert.throws(()=>selectedCases('network','typo'),/unknown case/);
});
test('argv accepts isolated rerun and retained diagnostics, refuses missing value',()=>{
 assert.deepEqual(parseRunnerArgs(['--case','dns-rebind','--keep-on-failure']),{caseName:'dns-rebind',keepOnFailure:true});
 assert.throws(()=>parseRunnerArgs(['--case']),/value/);
});
test('teardown kills owned namespace children before removing namespaces and dangling veths',async()=>{
 const calls=[];await withNamespaces('1234abcd',async()=>calls.push('action'),async(cmd,args)=>{calls.push([cmd,...args].join(' '));return args[1]==='pids'?'123\n':'';});
 const kill=calls.findIndex(c=>c.includes('kill-netns b0b-1234abcd-f 123')),del=calls.indexOf('ip netns delete b0b-1234abcd-f');
 assert.ok(kill>calls.indexOf('action')&&del>kill);assert.ok(calls.at(-1).startsWith('ip link delete'));
 assert.equal(calls.filter(x=>x==='ip netns delete b0b-1234abcd-b').length,1);
});
test('partial namespace setup cleans only successful creations and propagates step diagnostics',async()=>{
 const calls=[];await assert.rejects(withNamespaces('1234abcd',async()=>assert.fail(),async(cmd,args)=>{calls.push(args.join(' '));if(args[2]==='b0b-1234abcd-g'&&args[1]==='add')throw Error('setup failed');return '';}),/setup failed/);
 assert.ok(calls.includes('netns delete b0b-1234abcd-b'));assert.ok(!calls.includes('netns delete b0b-1234abcd-g'));
});
test('failure includes exact step, case, command, exit and bounded stderr tail',()=>{
 const e=commandFailure('gate boot','dns-rebind','python',['-B','transport_runtime.py'],{code:7,stderr:'x'.repeat(9000)+'last line'});
 assert.match(e.message,/step=gate boot.*case=dns-rebind.*python.*exit=7/s);assert.ok(e.message.endsWith('last line'));assert.ok(e.message.length<5000);
 assert.match(commandFailure('x','y','z',[],{code:137}).message,/DO_NOT_RETRY/);
});
test('positive packet control and actual transport observations are mandatory',()=>{
 const sample={packets:2,pcapSha256:'a'.repeat(64),originRequests:1,events:[{event:'hook'}],remainingFlows:0,remainingReservations:0};
 assert.doesNotThrow(()=>assertMeasuredCase(sample));
 for(const key of ['packets','originRequests'])assert.throws(()=>assertMeasuredCase({...sample,[key]:0}));
 assert.throws(()=>assertMeasuredCase({...sample,events:[]}));
});
test('isolated rerun evidence cannot satisfy full acceptance',()=>{
 assert.throws(()=>validateEvidence({runId:'x',kind:'network',realRuntime:true,simulated:false,runtimeLockSha256:'a'.repeat(64),cases:[{name:'dns-rebind',passed:true,measurement:{packets:1}}]},{runId:'x',kind:'network'}));
});
test('coordinator starts by reversing old lock before reprovision; both scopes delegated',()=>{
 const s=coordinatorSequence({root:process.cwd(),uid:1010,tag:'root01'});
 assert.match(s[0],/unprovision/);assert.match(s[1],/provision/);assert.match(s[2],/installation-only/);
 for(const line of s.slice(3,5))assert.match(line,/-p Delegate=yes/);
});
import {combineRss,verifyOrdering,validateRssCase} from '../lib/browser/root-fixture.mjs';
import {launchAcceptanceBrowser} from '../lib/browser/launcher.mjs';
test('candidate launch refuses nonroot and cannot serve as a release readiness bypass',async()=>{
 await assert.rejects(launchAcceptanceBrowser({runId:'11111111-1111-4111-8111-111111111111'}),/BROWSER_LAUNCH_REFUSED/);
});
test('actual gate flow requires target attach/guard/Fetch order; invented pass bits do not suffice',()=>{
 const events=[{seq:1,event:'target_attached',targetId:'t'},{seq:2,event:'guard_registered',targetId:'t'},{seq:3,event:'fetch_paused',targetId:'t'}],gate=[{event:'flow_closed',upstreamPlaintextBytes:42}];
 assert.equal(verifyOrdering(events,gate),true);
 assert.throws(()=>verifyOrdering([events[0],{...events[1],seq:4},events[2]],gate));
 assert.throws(()=>verifyOrdering(events,[]));
});
test('RSS slow-slot acceptance requires simultaneous observed reservations and terminal cleanup',()=>{
 const s={state:{maxSlots:2,samples:[{slots:2,pools:{response:112*1048576}}]},origins:[{}],result:{received:1},stats:{flows:0,handlers:0,reservations:0,pools:{request:0,response:0,transport:0}}};
 assert.doesNotThrow(()=>validateRssCase('two-25MiB-slow-readers',s));
 assert.throws(()=>validateRssCase('two-25MiB-slow-readers',{...s,state:{...s.state,samples:[]}}));
 assert.throws(()=>validateRssCase('declared-length',{...s,stats:{...s.stats,reservations:1}}));
});
test('RSS reduction preserves worst observed maxima and any OOM latch',()=>{
 const s={poolMaxima:{request:1,response:2,transport:3},baselineRssBytes:3,cgroupPeakBytes:4,rssPeakBytes:4,maxResponseSlots:1,maxContexts:1,maxDirectionalQueueBytes:6,oomEvents:0,remainingFlows:0,remainingReservations:0,retainedCompletedBodies:0,unapprovedUpstreamBytes:0,parserPreallocationObserved:true,backpressureBeforeAllocation:true,oomLatch:true};
 const r=combineRss(s,{...s,oomLatch:false,maxResponseSlots:2,poolMaxima:{request:2,response:1,transport:4}});
 assert.equal(r.oomLatch,true);assert.equal(r.maxResponseSlots,2);assert.deepEqual(r.poolMaxima,{request:2,response:2,transport:4});
});
import {fixturePacketMetrics} from '../lib/browser/root-fixture.mjs';
test('ingress classifier distinguishes allowed fixture HTTPS/DNS from private probes',()=>{
 function packet(dst,port){const h=Buffer.alloc(24);h.writeUInt32LE(0xa1b2c3d4);h.writeUInt16LE(2,4);h.writeUInt16LE(4,6);h.writeUInt32LE(65536,16);h.writeUInt32LE(101,20);const b=Buffer.alloc(40);b[0]=0x45;b[9]=6;b.set([10,204,0,1],12);b.set(dst,16);b.writeUInt16BE(12345,20);b.writeUInt16BE(port,22);const r=Buffer.alloc(16);r.writeUInt32LE(b.length,8);r.writeUInt32LE(b.length,12);return Buffer.concat([h,r,b]);}
 assert.equal(fixturePacketMetrics(packet([8,8,8,8],443)).privatePackets,0);
 assert.equal(fixturePacketMetrics(packet([10,204,0,2],53)).privatePackets,0);
 assert.equal(fixturePacketMetrics(packet([169,254,169,254],80)).privatePackets,1);
});
import {validScope} from '../lib/browser/root-runner.mjs';
test('fresh systemd scope identity accepts real dot suffix and rejects lookalikes or wrong kind',()=>{
 assert.equal(validScope('/user.slice/browser-0b-rss-root01.scope','rss'),true);
 assert.equal(validScope('/user.slice/browser-0b-network-root01.scope','network'),true);
 for(const value of ['/browser-0b-rss-root01Xscope','/browser-0b-rss-root01.scope/child','/browser-0b-network-root01.scope','/sjcos.service'])assert.equal(validScope(value,'rss'),false);
});
import {validScopeCaps} from '../lib/browser/root-runner.mjs';
test('fresh scope refuses unlimited memory, swap, CPU and task ancestry budgets',()=>{
 const caps={memory:'3221225472',swap:'0',cpu:'150000 100000',pids:'256'};
 assert.equal(validScopeCaps(caps),true);
 for(const field of Object.keys(caps))assert.equal(validScopeCaps({...caps,[field]:'max'}),false);
 assert.equal(validScopeCaps({...caps,cpu:'800000 100000'}),false);
 assert.equal(validScopeCaps({...caps,swap:'1073741824'}),false);
});
import {runCommand} from '../lib/browser/controller.mjs';
test('fixture command errors preserve bounded stderr, argv and exit for coordinator diagnostics',async()=>{
 await assert.rejects(runCommand(process.execPath,['-e','process.stderr.write("fixture-diagnostic");process.exit(7)']),e=>e.message.includes('exit=7')&&e.message.includes('fixture-diagnostic')&&e.message.includes(process.execPath));
});

// Coordinator root-run fix: kernel IPv6 link-local NDP/MLD on a fresh fixture veth is link control,
// not private traffic; any other IPv6 (even ICMPv6) remains private.
test('fixturePacketMetrics: link-local MLD is link control; global IPv6 stays private', async () => {
  const {fixturePacketMetrics} = await import('../lib/browser/root-fixture.mjs');
  const pcap = (packets) => { const head = Buffer.alloc(24); head.writeUInt32LE(0xa1b2c3d4,0); head.writeUInt16LE(2,4); head.writeUInt16LE(4,6); head.writeUInt32LE(65535,16); head.writeUInt32LE(276,20);
    return Buffer.concat([head, ...packets.flatMap(p => { const rec = Buffer.alloc(16); rec.writeUInt32LE(p.length,8); rec.writeUInt32LE(p.length,12); return [rec,p]; })]); };
  const v6 = (src, dst, icmpType, hbh) => { const sll = Buffer.alloc(20); const ip = Buffer.alloc(40); ip[0]=0x60; ip[6]=hbh?0:58; ip[7]=1;
    Buffer.from(src,'hex').copy(ip,8); Buffer.from(dst,'hex').copy(ip,24);
    const ext = hbh ? Buffer.from([58,0,5,2,0,0,1,0]) : Buffer.alloc(0); const icmp = Buffer.from([icmpType,0,0,0,0,0,0,0]); return Buffer.concat([sll,ip,ext,icmp]); };
  const ll='fe80000000000000d4f55ffffe09c92e', mld='ff020000000000000000000000000016', global='26064700470000000000000000001111';
  const ok = fixturePacketMetrics(pcap([v6(ll,mld,143,true), v6(ll,'ff020000000000000000000000000002',133,false)]));
  assert.equal(ok.linkControlPackets, 2); assert.equal(ok.privatePackets, 0);
  const bad = fixturePacketMetrics(pcap([v6(ll,global,128,false), v6('fd420000000000000000000000000002',mld,143,true)]));
  assert.equal(bad.privatePackets, 2); assert.equal(bad.linkControlPackets, 0);
});
