/** Real browser stimuli for the 21 controller cases. Gate/fixture operations
 * are fault controls, NOT acceptance results; packet/event validation is local.
 * Missing controls fail closed. Each destructive case requires a fresh boot. */
import {randomUUID} from 'node:crypto';
import {runCommand} from './controller.mjs';
const fail=()=>{throw Error('BROWSER_SCENARIO_FAILED');};
export async function executeScenario({name,caseId,runId,runtime,namespaces,context}){
  const fixture=await context.gate.call('case_begin',{runId,name,caseId});
  if(fixture.caseId!==caseId||typeof fixture.url!=='string'||!fixture.url.startsWith('https://')||!runtime.openCase)fail();
  const boot=await runtime.openCase({name,caseId,fixture});
  const browser=boot.browser,progress=boot.progress;
  if(!browser||!progress||typeof progress.race!=='function')fail();
  const newContext=listener=>browser.newContext(progress,{serviceWorkers:'block',viewport:{width:800,height:600},proxy:{server:`http://10.203.0.2:${listener}`}});
  let a,b,page;
  try{
    // A live positive-control request is mandatory for each capture interval.
    // This control uses a separately authorized task manifest grant.
    await context.gate.call('fixture_control',{runId,caseId,operation:'positive_control'});
    a=await newContext(18081);page=await a.newPage(progress);
    const navigate=url=>page.mainFrame().goto(progress,url,{waitUntil:'domcontentloaded',timeout:3000});
    const evaluate=expression=>page.mainFrame().evaluateExpression(progress,expression,{isFunction:false});
    const settled=async operation=>{try{await operation();}catch{/* Negative stimuli may refuse; evidence must prove why. */}};
    if(name==='host-cdp'){
      await runCommand('/usr/bin/nsenter',['--net=/proc/1/ns/net','/usr/bin/node','--input-type=module','-e',`import net from 'node:net';const s=net.connect({host:'127.0.0.1',port:${boot.port}});s.setTimeout(500,()=>{s.destroy();process.exit(0)});s.on('connect',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(0));`]);
      await context.gate.call('host_probe_denied',{runId,caseId,port:boot.port});
    }else if(name==='listener-cross-context'){
      b=await newContext(18082);await b.newPage(progress);await settled(()=>context.gate.call('bind',{...boot.binding,listener:18081,contextId:b._browserContextId,guardId:randomUUID()}));
    }else if(name==='listener-reuse'){
      await context.policy.revokeListener();await settled(()=>context.gate.call('bind',{...boot.binding,generation:1}));
    }else if(name==='popup-first-request'||name==='oopif-first-request'||name==='worker-never-resumes'){
      await settled(()=>navigate(fixture.url));
      const target=JSON.stringify(fixture.childUrl);
      if(name==='popup-first-request')await settled(()=>evaluate(`window.open(${target})`));
      else if(name==='oopif-first-request')await settled(()=>evaluate(`{const f=document.createElement('iframe');f.src=${target};document.body.append(f);}`));
      else await settled(()=>evaluate(`new Worker(${target})`));
    }else if(['controller-loss-keepalive','fetch-detach-buffered-write','gate-crash','addon-uncaught-exception'].includes(name)){
      await settled(()=>navigate(fixture.url));
      await context.gate.call('fault_arm',{runId,caseId,fault:name});
      // Fault hooks execute at real parser/send checkpoints, never synthesized
      // outcome helpers. Buffered write uses an exact pre-signed one-use grant.
      await settled(()=>evaluate(`fetch(${JSON.stringify(fixture.childUrl)},{method:'POST',body:'fixture-write'})`));
      if(name==='controller-loss-keepalive')await context.policy.revokeListener();
      if(name==='fetch-detach-buffered-write')await boot.detachFetch();
    }else if(name==='unauthorized-second-request'){
      await settled(()=>navigate(fixture.url));await settled(()=>navigate(fixture.url));
    }else if(name==='origin-401-no-secret'||name==='proxy-407'||name==='request-hook-order'){
      await settled(()=>navigate(fixture.url));
    }else{
      // DNS/peer/SNI/Host faults are applied only to the disposable fixture's
      // real resolver/socket/TLS bytes by the gate's root acceptance control.
      await context.gate.call('fault_arm',{runId,caseId,fault:name});await settled(()=>navigate(fixture.url));
      if(name==='dns-rebind')await settled(()=>navigate(fixture.url));
    }
    const result=await context.gate.call('case_end',{runId,caseId});
    if(result.caseId!==caseId||!Array.isArray(result.events))fail();return {events:result.events};
  }finally{await boot.close();}
}
