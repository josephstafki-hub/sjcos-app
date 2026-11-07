/** Root-installed adapter implementation. No service, database or browser starts
 * at import time. The coordinator supplies independent signed authority. */
import {readFile,lstat,mkdir,chmod} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {canonical,verifyAttestation} from './acceptance-attestation.mjs';
import {trustedPath} from './protected-bootstrap.mjs';
import {sha256} from './runtime-readiness.mjs';
import {strictDatabaseUrl} from './startup.mjs';
import {createControllerPolicy,createFixtureCA,validateIdentity} from './controller.mjs';
import {createAuthority,DurableJournal,verifySigned,uuid,hex} from './controller-authority.mjs';
import {createGateAuthority} from './controller-gate.mjs';
import {unixCall,serveController} from './controller-rpc.mjs';
import {runCases,networkIO} from './controller-network.mjs';
const fail=()=>{throw Error('BROWSER_CONTROLLER_REFUSED');};
async function protectedRead(file,max=65536){await trustedPath(file);const s=await lstat(file);if(!s.isFile()||s.size>max)fail();return readFile(file,'utf8');}
const active=new Map();
export async function prepareAcceptance({runId,config}){
  if(process.getuid()!==0||config?.enabled!==true||!uuid(runId))fail();
  const {uid,gid}=validateIdentity(config);
  // Verify provisioned name -> numeric identity; no account IDs in source and
  // no accepting a config that happens to point at another nonroot account.
  const account=(await readFile('/etc/passwd','utf8')).split('\n').find(x=>x.startsWith('sjcos-browser:'))?.split(':');
  if(!account||Number(account[2])!==uid||Number(account[3])!==gid)fail();
  const lockBytes=await protectedRead('/opt/sjcos-browser/runtime-lock.json',1048576),lockDigest=sha256(lockBytes);
  const envelope=JSON.parse(await protectedRead('/etc/sjcos-browser/attestation.json'));
  const reviewer=await protectedRead('/etc/sjcos-browser/reviewer-ed25519.pub',4096);
  const attestation=verifyAttestation(envelope,{publicKey:reviewer,runtimeLockSha256:lockDigest});
  const verifySignature=value=>{try{return canonical(value)===canonical(verifyAttestation(envelope,{publicKey:reviewer,runtimeLockSha256:lockDigest}));}catch{return false;}};
  const run=JSON.parse(await protectedRead('/etc/sjcos-browser/runs/'+runId+'.json'));
  if(run.runId!==runId||run.bootId!==(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()||![run.userId,run.taskId,run.bootId].every(uuid)||active.has(runId)||!Array.isArray(run.manifests)||!run.manifests.length)fail();
  const dir='/run/sjcos-browser/controller-'+runId;
  await trustedPath('/run/sjcos-browser');await mkdir(dir,{mode:0o700}); // fresh, never reuse a run
  await trustedPath('/var/lib/sjcos-browser/controller-receipts');
  const journalDir='/var/lib/sjcos-browser/controller-receipts/'+runId;await mkdir(journalDir,{mode:0o700});
  let ca,endpoint,policy,closed=false;
  const cleanup=async()=>{if(closed)return;closed=true;try{await policy?.revokeListener();}finally{try{await endpoint?.close();}finally{await ca?.close();active.delete(runId);}}};
  try{
    ca=await createFixtureCA({runDir:dir});
    // Narrow account needs only public CA certificate; key and journal remain
    // root0700. Public export goes in a dedicated root-owned searchable path.
    const {copyFile}=await import('node:fs/promises');const publicCA=dir+'.pem';await copyFile(ca.caFile,publicCA);await chmod(publicCA,0o644);
    const originalClose=ca.close;ca.close=async()=>{const {rm}=await import('node:fs/promises');try{await rm(publicCA,{force:true});}finally{await originalClose();}};
    const publicKey=await protectedRead('/etc/sjcos-browser/controller-ed25519.pub',4096),sinkKey=await protectedRead('/etc/sjcos-browser/checkpoint-ed25519.pub',4096);
    const authority=createAuthority({publicKey,runId,taskId:run.taskId,userId:run.userId,bootId:run.bootId,journal:new DurableJournal(journalDir),
      checkpoint:record=>unixCall('/run/sjcos-browser/checkpoint.sock',{v:1,event:'checkpoint',record}),
      verifyCheckpoint:(ack,record)=>{try{const proof=verifySigned(ack.envelope,sinkKey);return canonical(proof)===canonical({purpose:'browser-controller-checkpoint',...record});}catch{return false;}}});
    for(const manifest of run.manifests)await authority.admit(manifest);
    const gatePath='/run/sjcos-browser/gate-'+runId+'.sock';
    const gate={call:(op,data)=>{if(op==='bind'){const {listener,...binding}=data;const {runId:_,listenerCookie:__,...narrowBinding}=binding;return unixCall(gatePath,{op:'bind',port:listener,binding:narrowBinding});}if(op==='revoke')return unixCall(gatePath,{op:'revoke_all'});if(op==='fetch'||op==='port')return Promise.resolve({ok:true});return unixCall(gatePath,{op,...data});}};
    const fetches=[];
    const trackedGate={call:async(op,data)=>{const ack=await gate.call(op,data);if(op==='fetch'){if(fetches.length>=128)fail();fetches.push(data);}return ack;}};
    policy=createControllerPolicy({runId,taskId:run.taskId,bootId:run.bootId,gate:trackedGate,authority,profile:{caFile:publicCA,caSha256:ca.caSha256}});
    const handle=createGateAuthority({authority,networkConfig:run.networkConfig,bindingFor:policy.bindingFor,registerDigest:(e,b)=>unixCall(gatePath,{op:'fetch',listenerCookie:e.listenerCookie,generation:e.generation,requestDigest:e.requestDigest,guardId:b.guardId,targetId:b.targetId}),
      fetchFor:e=>{const i=fetches.findIndex(x=>x.method===e.method&&x.url===e.url&&x.listener===e.listener&&x.generation===e.generation);return i<0?null:fetches.splice(i,1)[0];},onFatal:()=>policy.revokeListener()});
    endpoint=await serveController('/run/sjcos-browser/controller-'+runId+'.sock',handle);
    const context={runId,run,gate,policy,ca,cleanup};active.set(runId,context);
    return {attestation,verifySignature,userId:run.userId,taskId:run.taskId,uid,gid,policy,onPort:async({port,namespace})=>{if(!Number.isSafeInteger(port)||port<1024||port>65535||!/^b0b-[a-f0-9]{8}-b$/.test(namespace))fail();await gate.call('port',{runId,port,namespace});},cleanup};
  }catch(e){await cleanup();throw e;}
}
export async function runNetworkCases({runtime,runId,namespaces}){
  const context=active.get(runId);if(!context)fail();
  // The assembled runtime must expose actual fault controls and event streams,
  // never booleans/counters. No alternate simulated path in this entrypoint.
  const {executeScenario}=await import('./controller-scenarios.mjs');
  return runCases({runtime,runId,namespaces,io:networkIO({scenario:args=>executeScenario({...args,context})})});
}
export function createMcpDependencies({databaseEnabled=false,connect,call}){
  return {
    async connectDb(dsn){if(databaseEnabled!==true)throw Error('BROWSER_DB_DISABLED');const checked=await strictDatabaseUrl('browser',{env:{DATABASE_URL_BROWSER:dsn}});return connect(checked.dsn);},
    async authorize({name,input,run}){const ack=await call({v:1,op:'mcp_authorize',name,input,run,peerPid:process.pid});return ack.allowed===true;},
    async invoke(_client,name,input,run){
      // Invoke repeats authorization at the authority; the caller cannot reuse
      // a previous allowed boolean to cross a revoke or observation epoch.
      const ack=await call({v:1,op:'mcp_invoke',name,input,run,peerPid:process.pid});return ack.result;
    },
    async observationContext(run){return (await call({v:1,op:'mcp_observation_context',run,peerPid:process.pid})).context;},
  };
}
export async function browserMcpDependencies({config}={}){
  if(!config){const {loadBootstrap}=await import('./protected-bootstrap.mjs');config=(await loadBootstrap()).config;}
  return createMcpDependencies({databaseEnabled:config.databaseEnabled===true,
    connect:async dsn=>{const file='/opt/sjcos-browser/node/node_modules/pg/lib/index.js';await trustedPath(file);const {Client}=createRequire(import.meta.url)(file);const client=new Client({connectionString:dsn});await client.connect();return client;},
    call:payload=>unixCall('/run/sjcos-browser/mcp-controller.sock',payload)});
}

export {prepareFixtureController} from './fixture-controller.mjs';
