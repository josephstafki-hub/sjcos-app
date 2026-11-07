/** Dedicated disposable acceptance launcher. No ordinary runner/app import.
 * Called inside the root-created disposable browser network namespace. The
 * coordinator owns the 3G cgroup, nftables and reviewed readiness verifier. */
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {readFile,readlink,lstat,stat,chown,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {runtimeReadiness,sha256} from './runtime-readiness.mjs';
import {guardTarget} from './target-barrier.mjs';
export const RUNTIME='/opt/sjcos-browser';
// Pinned rev 1248 headless shell (same 156.0.8078.4 as Chrome for Testing). Full Chrome's --headless=new
// builds browser UI: each new tab also spawns an empty 'other' target and two chrome://omnibox browser_ui
// targets that the barrier must refuse. The shell creates only the page target, like Playwright headless.
export const CHROMIUM=RUNTIME+'/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BUNDLE=RUNTIME+'/node/node_modules/playwright-core/lib/coreBundle.js';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
// Fixed check codes (no paths or content) so a root run can name the refusing pre-start check.
const refused=(code)=>Error('BROWSER_LAUNCH_REFUSED'+(code?':'+code:''));
export function validateNamespace({name,current,host}={}){if(!/^b0b-[a-f0-9]{8}-b$/.test(name??'')||!/^net:\[\d+\]$/.test(current??'')||!/^net:\[\d+\]$/.test(host??'')||current===host)throw refused();}
export function chromiumArguments(profile){if(!path.isAbsolute(profile)||profile.includes('\0'))throw refused();return [
 '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-startup-window',`--user-data-dir=${profile}`,
 '--no-first-run','--no-default-browser-check','--disable-extensions',
 // Built-in component extensions otherwise start background service workers (Chrome 156:
 // nkeimhogjd…/thunk.js, glbjnfimca…/background.js) that the target barrier must refuse.
 '--disable-component-extensions-with-background-pages','--disable-component-update',
 // Site isolation: every cross-site frame runs out of process as its own target, so the barrier must pause and
 // guard it before its first request (the headless shell does not isolate sites by default).
 '--site-per-process','--disable-background-networking','--disable-sync','--disable-quic','--disable-http2','--disable-features=DnsOverHttps,MediaRouter,OptimizationHints','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--password-store=basic','--use-mock-keychain'
];}
/** Short per-user/task profile dir prefix. Two full UUIDs pushed Chromium's
 * SingletonSocket past the 108-byte Unix socket path limit ("Socket path too long"). */
export function profilePrefix(userId,taskId){return createHash('sha256').update(String(userId)+'\0'+String(taskId)).digest('hex').slice(0,20)+'-';}
async function fileHash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function rootFile(file){let current=file;for(;;){const s=await lstat(current);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw refused();if(current==='/')break;current=path.dirname(current);}return file;}
async function run(binary,args){const c=spawn(binary,args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:'ignore'});await new Promise((resolve,reject)=>{c.once('error',reject);c.once('exit',code=>code===0?resolve():reject(refused()));});}
async function bounded(action){let timer;try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=setTimeout(()=>reject(refused()),2000);})]);}finally{clearTimeout(timer);}}
async function stop(child){if(!child?.pid)return;child.stdin?.end();await new Promise(r=>setTimeout(r,200));if(child.exitCode!==null||child.signalCode!==null)return;try{process.kill(-child.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,100));try{process.kill(-child.pid,'SIGKILL');}catch{}if(child.exitCode===null&&child.signalCode===null)await new Promise(r=>child.once('exit',r));}
export async function launchBrowser(options={}){
  if(!runtimeReadiness(options.attestation,options.verifySignature).ok)throw Error('BROWSER_RUNTIME_NOT_READY');
  return launchVerified(options);
}
/** Root fixture capability is separate from release readiness. It expires in
 * ten minutes, binds installed bytes + this run, and never returns readiness. */
export async function launchAcceptanceBrowser({runId,...options}){
  if(process.getuid()!==0||!uuid(runId))throw refused('caller');
  const file='/etc/sjcos-browser/runs/'+runId+'.json';await rootFile(file);
  const c=JSON.parse(await readFile(file,'utf8'));
  if(c.purpose!=='browser-0b-candidate'||c.runId!==runId||c.userId!==options.userId||c.taskId!==options.taskId||c.namespace!==options.namespace?.name||c.expiresAt<=Date.now()||c.expiresAt>Date.now()+600000||c.bootId!==(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim())throw refused(c.expiresAt<=Date.now()?'run-config-expired':'run-config');
  await rootFile(RUNTIME+'/installed-hashes.json');await rootFile(RUNTIME+'/runtime-lock.json');
  const inventory=JSON.parse(await readFile(RUNTIME+'/installed-hashes.json','utf8'));
  if(inventory.sourceLockSha256!==sha256(await readFile(RUNTIME+'/runtime-lock.json'))||c.runtimeLockSha256!==inventory.sourceLockSha256)throw refused('lock');
  for(const [name,hash]of Object.entries(inventory.files)){if(name.includes('..')||path.isAbsolute(name))throw refused('inventory-name');await rootFile(RUNTIME+'/'+name);if(await fileHash(RUNTIME+'/'+name)!==hash)throw refused('inventory-hash');}
  const lock=JSON.parse(await readFile(RUNTIME+'/runtime-lock.json','utf8'));
  return launchVerified({...options,candidateDiagnostic:true,attestation:{...lock.acceptance,chromiumSha256:inventory.files['browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell']}});
}
async function launchVerified({namespace,attestation,userId,taskId,policy,onPort,uid,gid,candidateDiagnostic=false}){
  validateNamespace(namespace);
  if(process.getuid()!==0||!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0||!uuid(userId)||!uuid(taskId)||!policy||typeof policy.prepareProfile!=='function'||typeof onPort!=='function')throw refused('options');
  // Do not trust an asserted namespace identity. /proc/1 stays in the host netns
  // under ip netns exec (no PID namespace). No host CDP proxy is ever spawned.
  const [current,host,expected]=await Promise.all([readlink('/proc/self/ns/net'),readlink('/proc/1/ns/net'),stat('/run/netns/'+namespace.name)]);
  validateNamespace({...namespace,current,host});
  const self=await stat('/proc/self/ns/net');
  if(Number(expected.ino)!==Number(self.ino))throw refused('namespace');
  await Promise.all([rootFile(CHROMIUM),rootFile(BUNDLE),rootFile('/opt/sjcos-browser/node/node_modules/playwright-core/lib/sjc-patch.json')]);
  const [bundle,metadata]=await Promise.all([readFile(BUNDLE),readFile(path.dirname(BUNDLE)+'/sjc-patch.json','utf8').then(JSON.parse)]);
  if(!/^[a-f0-9]{64}$/.test(attestation.chromiumSha256??'')||await fileHash(CHROMIUM)!==attestation.chromiumSha256)throw refused('chromium-hash');
  if(sha256(bundle)!==attestation.patchedBundleSha256||metadata.patchedBundleSha256!==attestation.patchedBundleSha256||metadata.playwrightPatchSha256!==attestation.playwrightPatchSha256)throw refused('bundle-hash');
  const base='/run/sjcos-browser/profiles';await rootFile(base);
  const dir=await mkdtemp(path.join(base,profilePrefix(userId,taskId)));
  const home=path.join(dir,'home'),profile=path.join(dir,'profile');await mkdir(home,{mode:0o700});await mkdir(profile,{mode:0o700});
  for(const d of [dir,home,profile])await chown(d,uid,gid);
  let child,transport,browser,port,browserPid,closing,barrierFence=()=>{},closed=false,startupStderr='',barrierReason=null;
  const close=createFatalShutdown({
    fence:()=>{closed=true;policy.fence?.();barrierFence();},
    revoke:()=>policy.revokeListener(),
    kill:async()=>{transport?.close();child?.stdin?.end();if(browserPid)try{process.kill(-browserPid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}await stop(child);},
    cleanup:async()=>{try{if(port)await run('/usr/sbin/nft',['delete','element','inet','sjc_test','cdp_ports',`{ ${port} }`]);}
      finally{await rm(dir,{recursive:true,force:true});process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);process.removeListener('exit',onExit);}},
  });
  policy.setFatalHandler?.(()=>{closed=true;barrierFence();void close().catch(()=>{});});
  const onExit=()=>{child?.stdin?.destroy();}; // EOF reaches independent supervisor even on controller SIGKILL
  const signal=()=>{void close().catch(()=>{});};process.once('exit',onExit);process.once('SIGTERM',signal);process.once('SIGINT',signal);
  try{
    await policy.prepareProfile({home,profile,uid,gid});
    const core=createRequire(import.meta.url)(BUNDLE);
    if(!core.sjcBrowser)throw refused();
    child=spawn(RUNTIME+'/py/bin/python',['-B',RUNTIME+'/fixtures/fixture-io.py','supervise-browser',String(uid),String(gid),CHROMIUM,...chromiumArguments(profile)],{cwd:dir,env:{PATH:'/usr/bin:/bin',HOME:home,XDG_CONFIG_HOME:home,XDG_CACHE_HOME:home,TMPDIR:dir,LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},stdio:['pipe','pipe','pipe'],detached:true});
    let identity='';child.stdout.on('data',b=>{identity+=b;if(identity.length>128){void close().catch(()=>{});return;}if(identity.includes('\n')){try{const value=JSON.parse(identity);if(!Number.isSafeInteger(value.browserPid)||value.browserPid<=1)throw refused();browserPid=value.browserPid;}catch{void close().catch(()=>{});}}});
    // Drain bounded diagnostics without logging page data or browser stderr.
    child.stderr.on('data',b=>{if(candidateDiagnostic&&!port)startupStderr=(startupStderr+b.toString()).slice(-4096);});
    const exited=new Promise((_,reject)=>{child.once('error',reject);child.once('exit',()=>{void close().catch(()=>{});reject(refused());});});exited.catch(()=>{});
    const endpoint=await Promise.race([exited,(async()=>{const end=Date.now()+10000;while(!closed&&Date.now()<end){try{const rows=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');if(rows.length!==2||!/^\d+$/.test(rows[0])||!/^\/devtools\/browser\/[a-f0-9-]+$/.test(rows[1]))throw refused();const p=Number(rows[0]);if(p<1024||p>65535)throw refused();return {port:p,path:rows[1]};}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,25));}throw refused();})()]);
    port=endpoint.port;await run('/usr/sbin/nft',['add','element','inet','sjc_test','cdp_ports',`{ ${port} }`]);
    await onPort({port,namespace:namespace.name}); // measurement only; no host mapping
    transport=await core.server.WebSocketTransport.connect(core.server.nullProgress,`ws://127.0.0.1:${port}${endpoint.path}`);
    const playwright=core.server.createPlaywright({sdkLanguage:'javascript',isInternalPlaywright:true});
    browser=await core.sjcBrowser.connect(playwright,transport,{name:'chromium',browserType:'chromium',headful:false,artifactsDir:dir,downloadsPath:dir,tracesDir:dir,originalLaunchOptions:{},protocolLogger:()=>{},browserProcess:{close,kill:close},browserLogsCollector:{recentLogs:()=>[]},__sjcBarrier:{...policy,registerFence:f=>{barrierFence=f;if(closed)f();},guardTarget,revokeListener:async(reason)=>{if(barrierReason===null&&typeof reason==='string')barrierReason=reason.replace(/[^a-z0-9:_-]/gi,'').slice(0,80);try{await bounded(()=>policy.revokeListener());}finally{void close().catch(()=>{});}}}});
    return {browser,port,namespace:namespace.name,progress:core.server.nullProgress,close,barrierReason:()=>barrierReason};
  }catch{await close();if(candidateDiagnostic)throw Error('BROWSER_LAUNCH_REFUSED step=chromium command='+JSON.stringify([CHROMIUM,...chromiumArguments(profile)])+' exit='+(child?.exitCode??child?.signalCode??'initialization')+'\n'+startupStderr);throw refused();}
  finally{if(closed){process.removeListener('SIGTERM',signal);process.removeListener('SIGINT',signal);process.removeListener('exit',onExit);}}
}

export function createFatalShutdown({fence,revoke,kill,cleanup,timeout=2000}){
 let closing;
 return ()=>{
  if(closing)return closing;
  fence(); // all authority/barrier checks observe death in the caller's stack
  closing=(async()=>{let timer;try{
   const revoked=Promise.race([Promise.resolve().then(revoke),new Promise((_,reject)=>{timer=setTimeout(()=>reject(refused()),timeout);})]);
   const outcomes=await Promise.allSettled([revoked,Promise.resolve().then(kill)]);
   await cleanup();if(outcomes.some(x=>x.status==='rejected'))throw refused();
  }finally{clearTimeout(timer);}})();return closing;
 };
}
