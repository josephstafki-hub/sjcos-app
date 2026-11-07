/** Packet acceptance. No helper counter can substitute for packet records and
 * monotonically ordered events from the actual gate and target sessions. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm,readlink} from 'node:fs/promises';
import {sha256} from './runtime-readiness.mjs';
import {uuid,hex} from './controller-authority.mjs';
export const P_CASES=Object.freeze(['host-cdp','listener-cross-context','listener-reuse','popup-first-request','oopif-first-request','worker-never-resumes','controller-loss-keepalive','fetch-detach-buffered-write','gate-crash','addon-uncaught-exception','unauthorized-second-request','origin-401-no-secret','proxy-407','request-hook-order','doh','mixed-dns','cname-private','dns-rebind','peer-mismatch','sni-mismatch','host-mismatch']);
const fail=()=>{throw Error('BROWSER_NETWORK_ACCEPTANCE_FAILED');};
export function pcapMetrics(bytes){
  // RSS cases move 2x25MiB (~70k packets at snaplen 96); the capture must stay complete (tcpdump stopping
  // early fails the case), so the packet and byte budgets cover that with margin.
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>68*1024*1024)fail();
  const magic=bytes.subarray(0,4).toString('hex'),le=['d4c3b2a1','4d3cb2a1'].includes(magic);if(!le&&!['a1b2c3d4','a1b23c4d'].includes(magic))fail();
  const u32=offset=>le?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset);let packets=0,wireBytes=0;
  if(u32(16)>65536||u32(16)<1)fail();
  for(let offset=24;offset<bytes.length;){if(offset+16>bytes.length)fail();const included=u32(offset+8),original=u32(offset+12);if(included>65536||included>original||offset+16+included>bytes.length)fail();packets++;wireBytes+=original;offset+=16+included;}
  return {packets,wireBytes,pcapSha256:sha256(bytes)};
}
export function captureStatus({code,signal,text,early=false}){
  const refuse=reason=>{throw Error('BROWSER_MEASUREMENT_FAILED step=capture reason='+reason);};
  if(early)refuse('early-exit-or-packet-budget');
  if(code!==0||signal)refuse('abnormal-exit:'+String(code??signal));
  const count=label=>{const matches=[...text.matchAll(new RegExp('(?:^|\\n)([0-9]+) packets? '+label+'(?:\\r?\\n|$)','g'))];if(matches.length!==1)refuse('missing-statistics:'+label);const n=Number(matches[0][1]);if(!Number.isSafeInteger(n))refuse('invalid-statistics');return n;};
  const capturedPackets=count('captured'),receivedPackets=count('received by filter'),droppedPackets=count('dropped by kernel');
  if(droppedPackets!==0)refuse('kernel-drops:'+droppedPackets);
  if(capturedPackets>=250000)refuse('packet-budget');
  return {complete:true,capturedPackets,receivedPackets,droppedPackets,exitCode:code,signal:null,stderrSha256:sha256(text)};
}
export async function capturePackets(namespace,file,action,{spawnCapture=spawn,writeCapture=writeFile}={}){
  if(!/^b0b-[a-f0-9]{8}-[bgf]$/.test(namespace))fail();
  // Full IPv6 control messages must be available for semantic validation. Bounded file cap remains enforced.
  const child=spawnCapture('/usr/sbin/ip',['netns','exec',namespace,'/usr/bin/tcpdump','--immediate-mode','-U','-i','any','-s','256','-c','250000','-w',file,'ip or ip6'],{env:{PATH:'/usr/bin:/bin',LANG:'C'},stdio:['ignore','ignore','pipe']});
  let exited=false,text='',overflow=false,stopping=false,early=false;
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>{exited=true;if(!stopping)early=true;});child.once('close',(code,signal)=>resolve({code,signal}));});closed.catch(()=>{});
  let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);
  child.stderr.on('data',b=>{text+=b.toString();if(text.length>16384){overflow=true;text=text.slice(-16384);}if(text.includes('listening on'))readyResolve();});
  let result,error,timer;
  try{
    await Promise.race([ready,closed.then(()=>{throw Error('BROWSER_MEASUREMENT_FAILED step=capture reason=early-exit');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BROWSER_MEASUREMENT_FAILED step=capture reason=readiness-timeout')),3000);})]);clearTimeout(timer);
    result=await action();
  }catch(e){error=e;}finally{
    clearTimeout(timer);stopping=true;if(!exited)child.kill('SIGINT');
    timer=setTimeout(()=>child.kill('SIGKILL'),2000);
    try{const terminal=await closed;if(overflow)throw Error('BROWSER_MEASUREMENT_FAILED step=capture reason=stderr-overflow');const status=captureStatus({...terminal,text,early});await writeCapture(file+'.stderr',text,{mode:0o600});await writeCapture(file+'.terminal.json',JSON.stringify({...terminal,early}),{mode:0o600});if(error)throw error;return {result,capture:status};}finally{clearTimeout(timer);}
  }
}
export function validateCaseEvents(name,events,{runId,caseId}){
  if(!Array.isArray(events)||!events.length||events.length>256)fail();
  let seq=-1;for(const e of events){if(e.runId!==runId||e.caseId!==caseId||!Number.isSafeInteger(e.seq)||e.seq<=seq||typeof e.event!=='string')fail();seq=e.seq;}
  const has=event=>events.some(e=>e.event===event);
  if(!has('case_begin')||!has('case_end')||!has('fixture_ingress_control'))fail();
  if(events.some(e=>e.event==='upstream_write'&&e.authorized!==true)||events.some(e=>e.event==='private_packet')||events.some(e=>e.event==='secret_released'))fail();
  const required={
    'host-cdp':['host_probe_denied'], 'listener-cross-context':['binding_denied'], 'listener-reuse':['generation_denied'],
    'popup-first-request':['target_attached','guard_registered','fetch_paused','upstream_write'],
    'oopif-first-request':['target_attached','guard_registered','fetch_paused','upstream_write'],
    'worker-never-resumes':['worker_denied','boot_revoked'],
    'controller-loss-keepalive':['keepalive_open','boot_revoked','sockets_closed'],
    'fetch-detach-buffered-write':['write_consumed','fetch_detached','write_unknown','sockets_closed'],
    'gate-crash':['gate_disconnected','boot_revoked'], 'addon-uncaught-exception':['addon_exception','boot_revoked','sockets_closed'],
    'unauthorized-second-request':['request_denied'], 'origin-401-no-secret':['origin_401','auth_cancelled'],
    'proxy-407':['proxy_407','auth_cancelled'], 'request-hook-order':['target_attached','guard_registered','fetch_paused','upstream_write'],
    'doh':['doh_denied'], 'mixed-dns':['dns_mixed_denied'], 'cname-private':['dns_private_denied'],
    'dns-rebind':['dns_fresh','dns_rebind_denied'], 'peer-mismatch':['peer_denied'], 'sni-mismatch':['sni_denied'], 'host-mismatch':['host_denied'],
  }[name];if(!required||required.some(e=>!has(e)))fail();
  for(const write of events.filter(e=>e.event==='upstream_write')){
    const before=events.filter(e=>e.seq<write.seq&&e.targetId===write.targetId);
    const order=['target_attached','guard_registered','fetch_paused'];let index=-1;
    for(const event of order){const next=before.find(e=>e.event===event&&e.seq>index);if(!next)fail();index=next.seq;}
    if(write.authorized!==true||!hex(write.requestDigest))fail();
  }
  if(name==='worker-never-resumes'&&has('worker_resumed'))fail();
  return {eventCount:events.length,eventSha256:sha256(JSON.stringify(events)),firstSequence:events[0].seq,lastSequence:events.at(-1).seq};
}
export async function runCases({runtime,runId,namespaces,io}){
  if(!uuid(runId)||!namespaces||!/^b0b-[a-f0-9]{8}-b$/.test(namespaces.browser)||namespaces.gate!==namespaces.browser.slice(0,-1)+'g'||namespaces.fixture!==namespaces.browser.slice(0,-1)+'f')fail();
  await io.assertRootNamespace(namespaces);
  const cases=[];
  for(const name of P_CASES){
    const caseId=runId+':'+name;
    // Packet capture surrounds the entire scenario, including positive control,
    // gate start, Chromium attach, fault injection and final flow drain.
    const sample=await io.capture(namespaces.fixture,name,()=>io.scenario({name,caseId,runId,runtime,namespaces}));
    if(!sample||!sample.pcap||!Array.isArray(sample.events))fail();
    const metrics=pcapMetrics(sample.pcap);if(metrics.packets<1)fail();
    const events=validateCaseEvents(name,sample.events,{runId,caseId});
    cases.push({name,passed:true,measurement:{...metrics,...events}});
  }
  return {runId,kind:'network',realRuntime:true,simulated:false,cases,unapprovedUpstreamBytes:0,privatePackets:0,captureIngressVerified:true,guardOrderingVerified:true};
}
export function networkIO({scenario}){
  return {
    async assertRootNamespace(namespaces){if(process.getuid()!==0||await readlink('/proc/self/ns/net')===await readlink('/proc/1/ns/net'))fail();const {stat}=await import('node:fs/promises');if((await stat('/proc/self/ns/net')).ino!==(await stat('/run/netns/'+namespaces.browser)).ino)fail();},
    async capture(namespace,name,action){const dir=await mkdtemp('/run/sjcos-browser/capture-');const file=dir+'/'+name+'.pcap';try{const result=await capturePackets(namespace,file,action);return {...result.result,capture:result.capture,pcap:await readFile(file)};}finally{await rm(dir,{recursive:true,force:true});}},
    scenario,
  };
}
