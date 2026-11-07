#!/usr/bin/env node
/** Nonroot production entry. No installed state is modified by import. */
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {BrowserService,phase1Hooks} from '../lib/browser/service.mjs';
import {strictStartup} from '../lib/browser/startup.mjs';
import {createProductionRpc,serveProductionController,serveProductionFrames} from '../lib/browser/controller-rpc.mjs';
try{
 if(process.getuid()===0||process.argv.length!==2)throw Error();
 const {adapter,config}=await loadProductionBootstrap();
 const deps=await adapter.serviceDependencies(config);
 const client=await strictStartup('controller',deps.database);
 const service=new BrowserService({io:{...deps.io,hooks:await phase1Hooks()}});
 await deps.verifyReadiness();await deps.verifyAccounting();await service.start();
 const frames=await serveProductionFrames({uid:process.getuid(),...deps.frames});
 const rpc=await serveProductionController({uid:process.getuid(),handle:createProductionRpc({...deps.rpc,handlers:await deps.handlers(service)})});
 let ticking=false,closing=false;
 const interval=setInterval(()=>{if(ticking||closing)return;ticking=true;void service.tick().catch(()=>service.pressure()).finally(()=>ticking=false);},1000);
 const stop=async()=>{if(closing)return;closing=true;clearInterval(interval);try{await rpc.close();await frames.close();await service.shutdown();}finally{await client.end();}};
 process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
}catch{process.stderr.write('BROWSER_SERVICE_STARTUP_REFUSED\n');process.exitCode=1;}
