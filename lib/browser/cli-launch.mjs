/** Detached browser runner construction seam. Not wired into ordinary runner.
 * Trusted launcher must strictStartup + peer registry BEFORE spawn, register PID
 * before releasing stdin; only confirmed task facts may be written to stdin. */
import path from 'node:path';
import {mkdir,writeFile,lstat,chown,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {runtimeReadiness} from './runtime-readiness.mjs';
import {TOOL_NAMES} from './contracts.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(x);
export const ALLOWED_TOOLS=Object.freeze([...TOOL_NAMES.map(x=>'mcp__browser__'+x),...['get_operating_context','get_project','get_lead','get_work_item'].map(x=>'mcp__sjcos__'+x),'mcp__interact__ask_owner']);
export function historyPartition({userId,taskId,profile='browser'}) {
  if(!uuid(userId)||!uuid(taskId)||profile!=='browser')throw Error('BROWSER_BAD_INPUT');
  return createHash('sha256').update(JSON.stringify(['browser-history-v1',userId,taskId,profile])).digest('hex');
}
export async function buildBrowserLaunch({root,userId,taskId,runId,conversationId,sessionId,model,effort='high',maxBudgetUsd=2,maxTurns=60,servers,node=process.execPath,providerEnv={},directoryUid=process.getuid()}) {
  if(!Number.isSafeInteger(directoryUid)||directoryUid<0||!path.isAbsolute(root)||![runId,conversationId,sessionId].every(uuid)||!['sonnet','opus'].includes(model)||!['low','medium','high'].includes(effort)||!Number.isFinite(maxBudgetUsd)||maxBudgetUsd<=0||maxBudgetUsd>10||!Number.isSafeInteger(maxTurns)||maxTurns<1||maxTurns>60||!path.isAbsolute(node))throw Error('BROWSER_BAD_INPUT');
  if(Object.keys(providerEnv).some(x=>x!=='CLAUDE_CODE_OAUTH_TOKEN'))throw Error('BROWSER_FORBIDDEN');
  const base=path.join(root,historyPartition({userId,taskId})),cwd=path.join(base,'runs',runId),home=path.join(base,'home'),tmp=path.join(cwd,'tmp');
  for(const dir of [cwd,home,tmp]){await mkdir(dir,{recursive:true,mode:0o700});for(let p=dir;;p=path.dirname(p)){const s=await lstat(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022)&&p!=='/tmp'||![0,directoryUid].includes(s.uid))throw Error('BROWSER_LAUNCH_REFUSED');if(p===root)break;if(p===path.dirname(p))throw Error('BROWSER_LAUNCH_REFUSED');}}
  const config={mcpServers:{}};
  for(const kind of ['browser','sjcos','interact']) {
    const script=servers?.[kind];if(!path.isAbsolute(script??''))throw Error('BROWSER_BAD_INPUT');
    config.mcpServers[kind]={command:node,args:[script,'--browser-run',runId,'--browser-task',taskId,'--server-kind',kind]};
  }
  const configFile=path.join(cwd,'mcp.json');await writeFile(configFile,JSON.stringify(config),{mode:0o600,flag:'wx'});
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_DATA_HOME:path.join(home,'data'),XDG_CACHE_HOME:path.join(home,'cache'),CLAUDE_CONFIG_DIR:path.join(home,'claude'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TMPDIR:tmp,SJC_RUN_ID:runId,SJC_CONVERSATION_ID:conversationId,SJC_RUN_PROFILE:'browser',SJC_DB_LOGIN:'agent',SJC_DB_STRICT:'1',SJC_BROWSER_TASK_ID:taskId,...providerEnv};
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--strict-mcp-config','--mcp-config',configFile,'--tools','','--allowedTools',ALLOWED_TOOLS.join(' '),'--permission-prompt-tool','mcp__interact__approve_action','--permission-mode','default','--setting-sources','','--settings',JSON.stringify({disableAllHooks:true}),'--safe-mode','--no-chrome','--disable-slash-commands','--model',model,'--effort',effort,'--max-turns',String(maxTurns),'--max-budget-usd',String(maxBudgetUsd),'--session-id',sessionId];
  // Same task resumes only with trusted task-run session id. No operator id input.
  return {args,env,cwd,stdio:['pipe','pipe','pipe'],configFile,partition:base};
}
export function requireCliSupport(help,{managedPolicyAbsent=false}={}) {
  for(const f of ['--strict-mcp-config','--tools','--allowedTools','--setting-sources','--settings','--safe-mode','--no-chrome','--disable-slash-commands','--session-id'])if(!help.includes(f))throw Error('BROWSER_CLI_POLICY_UNSUPPORTED');
  if(managedPolicyAbsent!==true)throw Error('BROWSER_CLI_POLICY_UNSUPPORTED');
}
export function spawnBrowserCli(binary,launch){if(!path.isAbsolute(binary))throw Error('BROWSER_BAD_INPUT');return spawn(binary,launch.args,{env:launch.env,cwd:launch.cwd,stdio:launch.stdio});}
export function browserPrompt({purpose,confirmedFacts}) {
  if(typeof purpose!=='string'||purpose.length>4000||!Array.isArray(confirmedFacts)||confirmedFacts.length>40||confirmedFacts.some(x=>typeof x!=='string'||x.length>2000))throw Error('BROWSER_BAD_INPUT');
  return JSON.stringify({type:'user',message:{role:'user',content:JSON.stringify({trust_profile:'browser',purpose,confirmed_facts:confirmedFacts})}})+'\n';
}

export function parseMcpIdentity(args){
  if(args.length!==6||args[0]!=='--browser-run'||args[2]!=='--browser-task'||args[4]!=='--server-kind'||![args[1],args[3]].every(uuid)||!['browser','sjcos','interact'].includes(args[5]))throw Error('BROWSER_RENDEZVOUS_REFUSED');
  return {runId:args[1],taskId:args[3],kind:args[5]};
}
/** Trusted root bootstrap. Registration is completed while CLI waits for stdin.
 * On broker refusal kill the private process group; never release the prompt.
 * Exact wrapper digests and narrow credential paths come from broker policy. */
export async function launchRegisteredCli({binary,launch,runId,taskId,principalId,prompt,uid,gid,attestation,verifySignature,cliHelp,managedPolicyAbsent}) {
  if(!runtimeReadiness(attestation,verifySignature).ok)throw Error('BROWSER_RUNTIME_NOT_READY');
  requireCliSupport(cliHelp??'',{managedPolicyAbsent});
  if(!path.isAbsolute(binary))throw Error('BROWSER_RENDEZVOUS_REFUSED');
  for(let p=binary;;p=path.dirname(p)){const s=await lstat(p);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_RENDEZVOUS_REFUSED');if(p==='/')break;}
  if(process.getuid()!==0||![runId,taskId,principalId].every(uuid)||!Number.isSafeInteger(uid)||uid<=0||!Number.isSafeInteger(gid)||gid<=0)throw Error('BROWSER_RENDEZVOUS_REFUSED');
  const {registerCliPeer}=await import('./rendezvous-client.mjs');
  const transfer=async p=>{const s=await lstat(p);if(s.isSymbolicLink()||![0,uid].includes(s.uid)||(s.mode&0o077))throw Error('BROWSER_RENDEZVOUS_REFUSED');if(s.isDirectory())for(const item of await readdir(p))await transfer(path.join(p,item));await chown(p,uid,gid);};
  await transfer(launch.partition);
  const child=spawn(binary,launch.args,{env:launch.env,cwd:launch.cwd,stdio:launch.stdio,detached:true,uid,gid});
  try{
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    await registerCliPeer({runId,taskId,principalId,pid:child.pid});
    child.once('exit',()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}});
    child.stdin.end(browserPrompt(prompt));return child;
  }catch{try{process.kill(-child.pid,'SIGKILL');}catch{}throw Error('BROWSER_RENDEZVOUS_REFUSED');}
}

/** Website launcher: dedicated script starts held on a private pipe. No shell,
 * repo cwd, ambient env, provider token or DSN. Broker installs process binding
 * and committed capability before a single byte releases runner startup. */
export function spawnHeldBrowserRunner({runId,spawnProcess=spawn}){
 if(!uuid(runId))throw Error('BROWSER_BAD_INPUT');
 const child=spawnProcess('/usr/bin/node',['/opt/sjcos-browser/node/source/scripts/run-browser-agent.mjs','--run',runId],{cwd:'/var/empty',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',SJC_BROWSER_HELD:'1'},stdio:['ignore','ignore','ignore','pipe']});
 let released=false;const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.once('exit',()=>clearTimeout(timer));child.once('error',()=>clearTimeout(timer));
 return {pid:child.pid,release(){if(released||!Number.isSafeInteger(child.pid))throw Error('BROWSER_REVOKED');released=true;clearTimeout(timer);child.stdio[3].end('1');},cancel(){clearTimeout(timer);child.kill('SIGKILL');}};
}
