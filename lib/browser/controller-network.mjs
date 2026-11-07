/** Packet acceptance. No helper counter can substitute for packet records and
 * monotonically ordered events from the actual gate and target sessions. */
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,rm,readlink} from 'node:fs/promises';
import {sha256} from './runtime-readiness.mjs';
import {uuid,hex} from './controller-authority.mjs';
export const P_CASES=Object.freeze(['host-cdp','listener-cross-context','listener-reuse','popup-first-request','oopif-first-request','worker-never-resumes','controller-loss-keepalive','fetch-detach-buffered-write','gate-crash','addon-uncaught-exception','unauthorized-second-request','origin-401-no-secret','proxy-407','request-hook-order','doh','mixed-dns','cname-private','dns-rebind','peer-mismatch','sni-mismatch','host-mismatch']);
const fail=()=>{throw Error('BROWSER_NETWORK_ACCEPTANCE_FAILED');};
export function pcapMetrics(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>8*1024*1024)fail();
  const magic=bytes.subarray(0,4).toString('hex'),le=['d4c3b2a1','4d3cb2a1'].includes(magic);if(!le&&!['a1b2c3d4','a1b23c4d'].includes(magic))fail();
  const u32=offset=>le?bytes.readUInt32LE(offset):bytes.readUInt32BE(offset);let packets=0,wireBytes=0;
  if(u32(16)>65536||u32(16)<1)fail();
  for(let offset=24;offset<bytes.length;){if(offset+16>bytes.length)fail();const included=u32(offset+8),original=u32(offset+12);if(included>65536||included>original||offset+16+included>bytes.length)fail();packets++;wireBytes+=original;offset+=16+included;}
  return {packets,wireBytes,pcapSha256:sha256(bytes)};
}
export async function capturePackets(namespace,file,action){
  if(!/^b0b-[a-f0-9]{8}-[bgf]$/.test(namespace))fail();
  const child=spawn('/usr/sbin/ip',['netns','exec',namespace,'/usr/bin/tcpdump','--immediate-mode','-U','-i','any','-s','96','-c','10000','-w',file,'ip or ip6'],{env:{PATH:'/usr/bin:/bin',LANG:'C'},stdio:['ignore','ignore','pipe']});
  let exited=false;const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});}));
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error()),3000);let text='';const ready=()=>{clearTimeout(timer);resolve();};child.once('error',e=>{clearTimeout(timer);reject(e);});child.stderr.on('data',b=>{text=(text+b.toString()).slice(-2048);if(text.includes('listening on'))ready();});exit.then(()=>{clearTimeout(timer);reject(Error());});});
    const result=await action();if(exited)fail();return result;
  }finally{
    if(!exited)child.kill('SIGINT');let timer;try{await Promise.race([exit,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},2000);})]);await exit;}finally{clearTimeout(timer);}
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
    async capture(namespace,name,action){const dir=await mkdtemp('/run/sjcos-browser/capture-');const file=dir+'/'+name+'.pcap';try{const result=await capturePackets(namespace,file,action);return {...result,pcap:await readFile(file)};}finally{await rm(dir,{recursive:true,force:true});}},
    scenario,
  };
}
