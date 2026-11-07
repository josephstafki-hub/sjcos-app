#!/usr/bin/env node
/** Nonroot production controller; root mode only starts the fixed peer relay. */
import {loadProductionBootstrap} from '../lib/browser/protected-bootstrap.mjs';
import {BrowserService,phase1Hooks} from '../lib/browser/service.mjs';
import {strictStartup} from '../lib/browser/startup.mjs';
import {createProductionRpc,serveProductionController,serveProductionFrames} from '../lib/browser/controller-rpc.mjs';
if(process.argv.length===3&&process.argv[2]==='--mcp-peer-relay'){
 try{await (await import('../lib/browser/controller-mcp.mjs')).runProductionMcpPeerRelay();}catch{process.exitCode=1;}
}else{
 let client,service,mcp,frames,rpc,interval,closing=false;
 const stop=async()=>{if(closing)return;closing=true;clearInterval(interval);
  await Promise.allSettled([rpc?.close(),frames?.close(),mcp?.close()]);
  try{await service?.shutdown();}finally{await client?.end();}
 };
 try{
  if(process.getuid()===0||process.argv.length!==2)throw Error();
  const {adapter,config}=await loadProductionBootstrap(),deps=await adapter.serviceDependencies(config);
  client=await strictStartup('controller',deps.database);
  service=new BrowserService({io:{...deps.io,hooks:await phase1Hooks()}});
  await deps.verifyReadiness();await deps.verifyAccounting();await service.start();
  if(!(deps.rpc?.responseKey instanceof Uint8Array)||deps.rpc.responseKey.length!==32||!deps.mcp?.key||typeof deps.mcp?.handle!=='function')throw Error('BROWSER_BOOTSTRAP_REFUSED');
  mcp=await (await import('../lib/browser/controller-mcp.mjs')).serveProductionMcpEndpoint({uid:process.getuid(),...deps.mcp});
  frames=await serveProductionFrames({uid:process.getuid(),...deps.frames});
  rpc=await serveProductionController({uid:process.getuid(),handle:createProductionRpc({...deps.rpc,handlers:await deps.handlers(service)})});
  let ticking=false;
  interval=setInterval(()=>{if(ticking||closing)return;ticking=true;void service.tick().catch(()=>service.pressure()).finally(()=>ticking=false);},1000);
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
 }catch{await stop();process.stderr.write('BROWSER_SERVICE_STARTUP_REFUSED\n');process.exitCode=1;}
}
