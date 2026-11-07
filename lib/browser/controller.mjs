/** Controller side of the target barrier. All asynchronous returns cross a live
 * fence. A lost guard revokes the WHOLE boot before another request can leave. */
import {mkdir,mkdtemp,lstat,readdir,readFile,rm,chown,chmod} from 'node:fs/promises';
import path from 'node:path';
import {X509Certificate,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {sha256} from './runtime-readiness.mjs';
import {hex,uuid} from './controller-authority.mjs';
const refused=()=>Error('BROWSER_CONTROLLER_REFUSED');
export function validateIdentity({uid,gid}={}){if(!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)throw refused();return {uid,gid};}
export function runCommand(binary,args,{uid,gid,env={},timeout=10000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{uid,gid,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',...env},stdio:['ignore','pipe','pipe']});
    const chunks=[];let bytes=0,stderr='',reason='',done=false;
    const timer=setTimeout(()=>{reason='TIMEOUT';child.kill('SIGKILL');},timeout);
    const finish=(code,signal,error)=>{if(done)return;done=true;clearTimeout(timer);
      if(code===0&&!reason&&!error)return resolve(Buffer.concat(chunks));
      reject(Error('BROWSER_CONTROLLER_REFUSED step=fixture-command command='+JSON.stringify([binary,...args])+' exit='+(code??signal??'spawn-error')+(code===137||signal==='SIGKILL'?' KILLED_DO_NOT_RETRY':'')+' '+reason+'\n'+(error?.message??stderr).slice(-4096)));
    };
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>1048576){reason='OUTPUT_LIMIT';child.kill('SIGKILL');}else chunks.push(b);});
    child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4096);});
    child.once('error',error=>finish(null,null,error));child.once('close',(code,signal)=>finish(code,signal));
  });
}
export async function prepareProfile({home,profile,uid,gid,caFile,caSha256,run=runCommand}){
  // Test primitives may use their own uid. Production prepareAcceptance refuses
  // uid=0 and pins this operation to the provisioned nonroot account.
  if(!Number.isSafeInteger(uid)||uid<0||!Number.isSafeInteger(gid)||gid<0||!hex(caSha256)||![home,profile,caFile].every(x=>typeof x==='string'&&path.isAbsolute(x))||path.dirname(home)!==path.dirname(profile)||home===profile)throw refused();
  for(const d of [home,profile]){const s=await lstat(d);if(s.isSymbolicLink()||!s.isDirectory()||s.uid!==uid||s.gid!==gid||(s.mode&0o077)||(await readdir(d)).length)throw refused();}
  const caStat=await lstat(caFile);if(!caStat.isFile()||caStat.isSymbolicLink()||caStat.size>16384||sha256(await readFile(caFile))!==caSha256)throw refused();
  const nss=path.join(home,'.pki','nssdb');await mkdir(nss,{recursive:true,mode:0o700});
  for(const d of [path.join(home,'.pki'),nss])await chown(d,uid,gid);
  const options={uid,gid,env:{HOME:home,LD_LIBRARY_PATH:'/opt/sjcos-browser/nss/usr/lib/x86_64-linux-gnu'}};
  const tool='/opt/sjcos-browser/nss/usr/bin/certutil';
  await run(tool,['-N','--empty-password','-d','sql:'+nss],options);
  await run(tool,['-A','-d','sql:'+nss,'-n','SJC disposable fixture CA','-t','C,,','-i',caFile],options);
  const exported=await run(tool,['-L','-d','sql:'+nss,'-n','SJC disposable fixture CA','-a'],options);
  if(!new X509Certificate(exported).raw.equals(new X509Certificate(await readFile(caFile)).raw))throw refused();
  const list=(await run(tool,['-L','-d','sql:'+nss],options)).toString('utf8');
  const rows=list.split('\n').filter(line=>/\S+\s+[A-Za-z]*,[A-Za-z]*,[A-Za-z]*\s*$/.test(line));
  if(rows.length!==1||!/^SJC disposable fixture CA\s+C,,\s*$/.test(rows[0]))throw refused();
  return {caSha256};
}
export async function createFixtureCA({runDir,run=runCommand}){
  const dir=await mkdtemp(path.join(runDir,'fixture-ca-'));await chmod(dir,0o700);
  const keyFile=path.join(dir,'ca.key'),caFile=path.join(dir,'ca.pem');
  try{
    await run('/usr/bin/openssl',['req','-x509','-newkey','rsa:3072','-sha256','-nodes','-days','1','-subj','/CN=SJC disposable browser fixture CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',keyFile,'-out',caFile]);
    await chmod(keyFile,0o600);await chmod(caFile,0o644);
    return {keyFile,caFile,caSha256:sha256(await readFile(caFile)),close:()=>rm(dir,{recursive:true,force:true})};
  }catch(e){await rm(dir,{recursive:true,force:true});throw e;}
}
export async function withFixtureCA(options,operation){const ca=await createFixtureCA(options);try{return await operation(ca);}finally{await ca.close();}}
export function createControllerPolicy({runId,taskId,bootId,gate,authority,profile:profileOptions}){
  if(![runId,taskId,bootId].every(uuid)||typeof gate?.call!=='function'||!authority)throw refused();
  let live=true,revoking,fatalHandler=()=>{};const contexts=new Map(),targets=new Map(),sessions=new Set();
  const check=(isLive=()=>true)=>{if(!live||isLive()!==true)throw refused();};
  const revokeListener=(reason='BROWSER_CONTROLLER_REVOKE')=>{if(revoking)return revoking;live=false;const shutdown=Promise.resolve(fatalHandler());shutdown.catch(()=>{});revoking=(async()=>{const outcomes=await Promise.allSettled([Promise.resolve().then(()=>authority.unknownAll()),Promise.resolve().then(()=>gate.call('revoke',{runId,bootId,all:true,unknown:true,reason:/^BROWSER_[A-Z_]{1,80}$/.test(reason)?reason:'BROWSER_CONTROLLER_REVOKE'}))]);for(const s of sessions)s.removeListener?.('Fetch.requestPaused',s.__sjcHandler);if(outcomes.some(x=>x.status==='rejected'||x.value?.ok===false))throw refused();})();return revoking;};
  const validateBinding=async(target,b)=>live&&targets.get(target.targetId)===b&&b.contextId===target.browserContextId;
  return {
    revokeListener,validateBinding,fence:()=>{live=false;},isLive:()=>live,setFatalHandler:handler=>{fatalHandler=handler;if(!live)void Promise.resolve(handler()).catch(()=>{});},
    bindingFor:e=>live&&[...targets.values()].find(b=>b.listener===e.listener&&b.guardId===e.guardId),
    async bindTarget(target){
      check();if(!['page','iframe'].includes(target.type)||target.waitingForDebugger!==true||typeof target.targetId!=='string'||!target.browserContextId||targets.has(target.targetId))throw refused();
      let context=contexts.get(target.browserContextId);
      if(!context){if(contexts.size>=2)throw refused();context={listener:18081+contexts.size,generation:1,pages:0};contexts.set(target.browserContextId,context);}
      if(target.type==='page'&&++context.pages>2)throw refused();
      let b=Object.freeze({runId,taskId,bootId,guardId:randomUUID(),contextId:target.browserContextId,targetId:target.targetId,listener:context.listener,generation:context.generation});targets.set(target.targetId,b);
      try{if(!context.bound)context.bound=gate.call('bind',b);const result=await context.bound;check();if(result.ok!==true)throw refused();b=Object.freeze({...b,listenerCookie:result.listenerCookie??null});targets.set(target.targetId,b);return b;}catch{await revokeListener();throw refused();}
    },
    async registerFetch(session,binding,isLive){
      try{check(isLive);if(targets.get(binding.targetId)!==binding||sessions.has(session))throw refused();
      const handler=async event=>{
        try{
          check(isLive);if(!event.requestId||!event.request||!event.resourceType)throw refused();
          const kind=({Document:'document',Stylesheet:'css',Image:'image',Font:'font',Script:'script',XHR:'fetch',Fetch:'fetch',Ping:'beacon',Preflight:'fetch',Other:'resource'})[event.resourceType];if(!kind)throw refused();
          const request={method:event.request.method,url:event.request.url,kind};
          const authorized=await authority.authorizeFetch(request);check(isLive);if(authorized!==true)throw refused();
          const ack=await gate.call('fetch',{...binding,requestId:event.requestId,networkId:event.networkId??null,...request});check(isLive);if(ack.ok!==true)throw refused();
          await session.send('Fetch.continueRequest',{requestId:event.requestId});check(isLive);
        }catch{await revokeListener().catch(()=>{});}
      };
      session.__sjcHandler=handler;sessions.add(session);session.on('Fetch.requestPaused',handler);
      // No credentials ever leave this handler (including origin401/proxy407).
      session.on('Fetch.authRequired',async e=>{try{check(isLive);await session.send('Fetch.continueWithAuth',{requestId:e.requestId,authChallengeResponse:{response:'CancelAuth'}});check(isLive);}catch{await revokeListener().catch(()=>{});}});
      for(const name of ['Disconnected','Inspector.detached','Target.detachedFromTarget','Inspector.targetCrashed','Inspector.targetReloadedAfterCrash'])session.on(name,()=>{void revokeListener().catch(()=>{});});
      const ack=await gate.call('guard',{...binding,attached:true});check(isLive);if(ack.ok!==true)throw refused();
      }catch{await revokeListener().catch(()=>{});throw refused();}
    },
    prepareProfile:options=>prepareProfile({...options,...profileOptions}),
  };
}
