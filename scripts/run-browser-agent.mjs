#!/usr/bin/env node
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {runBrowserAgent} from '../lib/browser/agent-runtime.mjs';
import {UUID} from '../lib/browser/phase1-contracts.mjs';
try{
 if(process.argv.length!==4||process.argv[2]!=='--run')throw Error();const runId=UUID.parse(process.argv[3]);
 // Dedicated launcher gives no model access to fd3. Missing/lost release
 // exits before bootstrap, credentials, registration or any model work.
 if(process.env.SJC_BROWSER_HELD!=='1')throw Error();
 const {createReadStream}=await import('node:fs');
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{gate.destroy();reject(Error());},20000),gate=createReadStream(null,{fd:3,autoClose:true});let text='';gate.on('data',b=>{text+=b.toString();if(text.length>1){gate.destroy();clearTimeout(timer);reject(Error());}});gate.once('error',()=>{clearTimeout(timer);reject(Error());});gate.once('end',()=>{clearTimeout(timer);text==='1'?resolve():reject(Error());});});
 delete process.env.SJC_BROWSER_HELD;
 const {adapter,config}=await loadProductionBootstrap();
 if(typeof adapter.agentDependencies!=='function')throw Error();
 const deps=await adapter.agentDependencies(config);await runBrowserAgent({...deps,runId});
}catch{process.stderr.write('BROWSER_AGENT_STARTUP_REFUSED\n');process.exitCode=1;}
