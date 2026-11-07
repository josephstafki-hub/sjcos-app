#!/usr/bin/env node
/** Explicit protected bootstrap only; never imports an app/owner env file. */
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {scheduleRetention} from '../lib/browser/production-bridge.mjs';
import {runBrowserRetention} from '../lib/browser/retention.mjs';
try{
 if(process.argv.length>3||process.argv.length===3&&process.argv[2]!=='--schedule')throw Error();
 const {adapter,config}=await loadProductionBootstrap();
 if(typeof adapter.retentionDependencies!=='function')throw Error();
 const deps=await adapter.retentionDependencies(config);
 try{if(process.argv[2]==='--schedule'){
   const schedule=scheduleRetention({run:()=>runBrowserRetention(deps),onError:()=>{process.stderr.write('BROWSER_RETENTION_REFUSED\n');}});
   await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});await schedule.close();
  }else{const result=await runBrowserRetention(deps);process.stdout.write(JSON.stringify(result)+'\n');}}finally{await deps.close?.();}
}catch{process.stderr.write('BROWSER_RETENTION_REFUSED\n');process.exitCode=1;}
