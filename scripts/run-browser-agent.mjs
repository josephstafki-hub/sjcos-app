#!/usr/bin/env node
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {runBrowserAgent} from '../lib/browser/agent-runtime.mjs';
import {UUID} from '../lib/browser/phase1-contracts.mjs';
try{
 if(process.argv.length!==4||process.argv[2]!=='--run')throw Error();const runId=UUID.parse(process.argv[3]);
 const {adapter,config}=await loadProductionBootstrap();
 if(typeof adapter.agentDependencies!=='function')throw Error();
 const deps=await adapter.agentDependencies(config);await runBrowserAgent({...deps,runId});
}catch{process.stderr.write('BROWSER_AGENT_STARTUP_REFUSED\n');process.exitCode=1;}
