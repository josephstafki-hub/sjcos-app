#!/usr/bin/env node
/** Explicit protected bootstrap only; never imports an app/owner env file. */
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {runBrowserRetention} from '../lib/browser/retention.mjs';
try{
 if(process.argv.length!==2)throw Error();
 const {adapter,config}=await loadProductionBootstrap();
 if(typeof adapter.retentionDependencies!=='function')throw Error();
 const deps=await adapter.retentionDependencies(config);
 try{const result=await runBrowserRetention(deps);process.stdout.write(JSON.stringify(result)+'\n');}finally{await deps.close?.();}
}catch{process.stderr.write('BROWSER_RETENTION_REFUSED\n');process.exitCode=1;}
