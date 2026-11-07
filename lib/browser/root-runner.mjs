/** Disposable root acceptance supervisor. Imports and --plan have no effects. */
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm,rmdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {namespacePlan} from '../../deploy/browser/containment.mjs';
import {NETWORK_CASES,RSS_CASES,validateEvidence} from './acceptance.mjs';
import {trustedPath} from './protected-bootstrap.mjs';
import {sha256} from './runtime-readiness.mjs';
import {profilePrefix} from './launcher.mjs';
const activeCommands=new Set();
export const ROOT='/opt/sjcos-browser',SOURCE=ROOT+'/node/source';
export function selectedCases(kind,name){const all=kind==='network'?NETWORK_CASES:kind==='rss'?RSS_CASES:null;if(!all||name&&!all.includes(name))throw Error('BROWSER_RUNNER unknown case: '+name);return name?[name]:[...all];}
export function parseRunnerArgs(args){const out={};for(let i=0;i<args.length;i++){const a=args[i];if(a==='--keep-on-failure')out.keepOnFailure=true;else if(['--case','--run-id','--kind','--browser-ns','--gate-ns','--fixture-ns','--helper-cgroup','--gate-cgroup','--dns-cgroup','--log-dir','--output','--driver','--tag','--joe-uid','--supervisor-pids'].includes(a)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('BROWSER_RUNNER missing value '+a);out[a==='--case'?'caseName':a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[++i];}else if(!['--run','--plan','--disposable-only','--no-network-outside-fixture'].includes(a))throw Error('BROWSER_RUNNER unknown option '+a);}return out;}
export function commandFailure(step,name,cmd,args,{code,signal,stderr=''}={}){return Error(`BROWSER_ROOT_RUNNER step=${step} case=${name??'-'} command=${JSON.stringify([cmd,...args])} exit=${code??signal??'spawn-error'}${code===137||signal==='SIGKILL'?' KILLED_DO_NOT_RETRY':''}\n${stderr.slice(-4096)}`);}
export async function command(cmd,args,{step='command',caseName,timeout=15000,input,env={},cgroup}={}){
 return new Promise((resolve,reject)=>{const argv=cgroup?['-B',ROOT+'/fixtures/fixture-io.py','exec',cgroup,cmd,...args]:args;const executable=cgroup?ROOT+'/py/bin/python':cmd;
 const child=spawn(executable,argv,{env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',...env},stdio:['pipe','pipe','pipe'],detached:true});let stdout='',stderr='',overflow=false,timedOut=false;activeCommands.add(child);
 const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},timeout);
 child.stdout.on('data',b=>{if(Buffer.byteLength(stdout)+b.length>1048576){overflow=true;try{process.kill(-child.pid,'SIGKILL');}catch{}}else stdout+=b;});child.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-4096));
 child.once('error',e=>{activeCommands.delete(child);clearTimeout(timer);reject(commandFailure(step,caseName,cmd,args,{stderr:e.message}));});
 child.once('close',(code,signal)=>{activeCommands.delete(child);clearTimeout(timer);if(code!==0||overflow||timedOut)reject(commandFailure(step,caseName,cmd,args,{code,signal,stderr:stderr+(overflow?' EVIDENCE_LIMIT':'')+(timedOut?' TIMEOUT':'')}));else resolve(stdout);});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export async function withNamespaces(tag,action,run=command){const plan=namespacePlan(tag),made=[],links=[];const nftDir=await mkdtemp(join(tmpdir(),'sjc-nft-'));try{for(const [cmd,raw,input]of plan.commands){let args=raw,stdin=input;
  // nftables 1.0.9 refuses `-f -` from a pipe ("Not a regular file: /dev/stdin"): hand it a private 0600 file instead.
  if(input!=null&&raw.at(-1)==='-'&&raw.at(-2)==='-f'&&raw.includes('nft')){const file=join(nftDir,`rules-${made.length}-${randomBytes(4).toString('hex')}.nft`);await writeFile(file,input,{mode:0o600,flag:'wx'});args=[...raw.slice(0,-1),file];stdin=undefined;}
  await run(cmd,args,{input:stdin,step:'namespace setup'});if(args[0]==='netns'&&args[1]==='add')made.push(args[2]);if(args[0]==='link'&&args[1]==='add')links.push(args[2],args.at(-1));}return await action(plan.names);}finally{const failures=[];for(const n of made.reverse()){try{const p=await run('ip',['netns','pids',n]);for(const pid of p.trim().split(/\s+/).filter(x=>/^\d+$/.test(x)))await run(ROOT+'/py/bin/python',['-B',ROOT+'/fixtures/fixture-io.py','kill-netns',n,pid]);await run('ip',['netns','delete',n]);}catch(e){failures.push(e.message);}}for(const link of links)try{await run('ip',['link','delete',link]);}catch{/* moved links disappear with netns */}await rm(nftDir,{recursive:true,force:true});if(failures.length)throw Error('BROWSER_TEARDOWN_FAILED '+failures.join('\n'));}}
export function assertMeasuredCase(s){if(!s||s.packets<1||s.originRequests<1||!((Array.isArray(s.events)&&s.events.length)||(s.eventCount>0&&/^[a-f0-9]{64}$/.test(s.eventSha256??'')))||s.remainingFlows!==0||s.remainingReservations!==0)throw Error('BROWSER_REAL_MEASUREMENT_REQUIRED');}
export function validScope(relative,kind){return /\/browser-0b-(network|rss)-[a-zA-Z0-9_-]+\.scope$/.exec(relative)?.[1]===kind;}
export function validScopeCaps({memory,swap,cpu,pids}){const [quota,period]=cpu.trim().split(/\s+/).map(Number);return Number(memory)>0&&Number(memory)<=3*1024**3&&swap.trim()==='0'&&quota>0&&period>0&&quota/period<=1.5&&Number(pids)>0&&Number(pids)<=256;}
export async function createGroups(kind,runId){
 const relative=(await readFile('/proc/self/cgroup','utf8')).trim().split(':').at(-1),base='/sys/fs/cgroup'+relative;
 if(!validScope(relative,kind))throw Error('BROWSER_FRESH_ROOT_SCOPE_REQUIRED');
 const caps={};for(const [key,file]of Object.entries({memory:'memory.max',swap:'memory.swap.max',cpu:'cpu.max',pids:'pids.max'}))caps[key]=(await readFile(base+'/'+file,'utf8')).trim();if(!validScopeCaps(caps)||(await readFile(base+'/cgroup.procs','utf8')).trim()!==String(process.pid))throw Error('BROWSER_EMPTY_CAPPED_DELEGATED_SCOPE_REQUIRED');
 const made=[],groups={};
 const close=async()=>{const errors=[];if(groups.supervisor)await writeFile(groups.supervisor+'/cgroup.procs',String(process.pid));for(const dir of [...made].reverse()){if(dir===groups.supervisor)continue;try{await writeFile(dir+'/cgroup.kill','1');const until=Date.now()+5000;while(!/(?:^|\n)populated 0(?:\n|$)/.test(await readFile(dir+'/cgroup.events','utf8'))){if(Date.now()>=until)throw Error('cgroup still populated '+dir);await new Promise(r=>setTimeout(r,25));}await rmdir(dir);}catch(e){errors.push(e.message);}}try{await writeFile(base+'/cgroup.subtree_control','-memory -cpu -pids');await writeFile(base+'/cgroup.procs',String(process.pid));if(groups.supervisor)await rmdir(groups.supervisor);}catch(e){errors.push(e.message);}if(errors.length)throw Error('BROWSER_CGROUP_TEARDOWN '+errors.join(';'));};
 try{groups.supervisor=base+'/supervisor-'+runId;await mkdir(groups.supervisor);made.push(groups.supervisor);await writeFile(groups.supervisor+'/cgroup.procs',String(process.pid));await writeFile(base+'/cgroup.subtree_control','+memory +cpu +pids');
 for(const [name,memory,cpu,pids]of [['supervisor',32,10000,16],['helpers',2048,105000,208],['gate',384,35000,32],['dns',64,10000,8]]){const dir=groups[name]??base+'/'+name+'-'+runId;if(name!=='supervisor'){await mkdir(dir);made.push(dir);groups[name]=dir;}for(const [file,value]of Object.entries({'memory.max':memory*1048576,'memory.swap.max':0,'cpu.max':cpu+' 100000','pids.max':pids}))await writeFile(dir+'/'+file,String(value));}
 await writeFile(groups.gate+'/cgroup.procs',String(process.pid)); // conservative: charge Node supervision to measured gate, never the traffic helpers
 return {...groups,close};}catch(e){await close();throw e;}
}
export async function runAcceptance(kind,args){
 const options=parseRunnerArgs(args);selectedCases(kind,options.caseName);
 if(process.getuid()!==0||!args.includes('--disposable-only')||options.driver!==ROOT+'/fixtures/'+kind+'-driver'||!/^\/tmp\/[A-Za-z0-9_.-]+\.json$/.test(options.output??''))throw Error('BROWSER_ROOT_EXPLICIT_DISPOSABLE_PATHS_REQUIRED');
 await trustedPath(options.driver);const st=await lstat(options.driver);if(!st.isFile())throw Error('BROWSER_DRIVER_REQUIRED');
 const runId=randomUUID(),dir='/run/sjcos-browser/acceptance-'+runId;await mkdir(dir,{mode:0o700});let success=false,groups,cancelled=false,cleaned=false;const abort=()=>{cancelled=true;for(const child of activeCommands)try{process.kill(-child.pid,'SIGTERM');}catch{}};process.once('SIGTERM',abort);process.once('SIGINT',abort);
 try{groups=await createGroups(kind,runId);const tag=randomBytes(4).toString('hex');
 const evidence=await withNamespaces(tag,async namespaces=>{if(cancelled)throw Error('BROWSER_RUN_CANCELLED');const argv=['--kind',kind,'--run-id',runId,'--supervisor-pids',String(process.pid),...Object.entries(namespaces).flatMap(([k,v])=>['--'+k+'-ns',v]),'--helper-cgroup',groups.helpers,'--gate-cgroup',groups.gate,'--dns-cgroup',groups.dns,'--log-dir',dir,...(options.caseName?['--case',options.caseName]:[])];return JSON.parse(await command(options.driver,argv,{step:'suite',caseName:options.caseName,timeout:kind==='rss'?1200000:900000}));},async(cmd,args,options)=>{if(cancelled&&options?.step==='namespace setup')throw Error('BROWSER_RUN_CANCELLED');return command(cmd,args,options);});
 if(evidence.runtimeLockSha256!==sha256(await readFile(ROOT+'/runtime-lock.json')))throw Error('BROWSER_INSTALLED_LOCK_MISMATCH');
 if(!options.caseName)validateEvidence(evidence,{kind,runId});else if(evidence.cases.length!==1||evidence.cases[0].name!==options.caseName||!evidence.cases[0].passed)throw Error('BROWSER_SINGLE_CASE_FAILED');
 await groups.close();groups=null;await cleanupBootArtifacts(dir);cleaned=true;
 const {cp}=await import('node:fs/promises');await mkdir(options.output+'.d',{mode:0o700});await cp(dir,options.output+'.d',{recursive:true});evidence.artifactDirectory=options.output+'.d';
 await writeFile(options.output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});success=true;
 }catch(e){await writeFile(dir+'/failure.json',JSON.stringify({runId,kind,case:options.caseName,error:e.message}),{mode:0o600});throw Error(e.message+'\n'+(options.keepOnFailure?'diagnostics='+dir:'use --keep-on-failure to retain diagnostics'));}
 finally{try{await groups?.close();}finally{try{if(!cleaned)await cleanupBootArtifacts(dir);}finally{process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);if(success||!options.keepOnFailure)await rm(dir,{recursive:true,force:true});}}}
}

/** Emergency cleanup after a boot timeout/SIGKILL. Processes/cgroups must have
 * settled first. Only UUID paths listed in this invocation's root-private log. */
export async function cleanupBootArtifacts(dir){
 const {readdir,cp}=await import('node:fs/promises');
 for(const name of await readdir(dir)){
  if(![...NETWORK_CASES,...RSS_CASES].includes(name))continue;
  const record=dir+'/'+name+'/owned.json';let r;try{r=JSON.parse(await readFile(record,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const uuid=x=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x??'');if(!uuid(r.bootRunId))throw Error('BROWSER_TEARDOWN_OWNER_RECORD');
  const id=r.bootRunId,receipts='/var/lib/sjcos-browser/controller-receipts/'+id;
  try{await lstat(receipts);await cp(receipts,dir+'/'+name+'/receipts',{recursive:true});await rm(receipts,{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const path of ['/etc/sjcos-browser/runs/'+id+'.json','/etc/sjcos-browser/runs/'+id,'/run/sjcos-browser/g-'+id,'/run/sjcos-browser/ca-'+id+'.pem','/run/sjcos-browser/controller-'+id+'.sock','/run/sjcos-browser/controller-'+id.replace(/^./,c=>c==='f'?'0':'f')+'.sock'])await rm(path,{recursive:true,force:true});
  if(uuid(r.userId)&&uuid(r.taskId))for(const profile of await readdir('/run/sjcos-browser/profiles'))if(profile.startsWith(profilePrefix(r.userId,r.taskId)))await rm('/run/sjcos-browser/profiles/'+profile,{recursive:true,force:true});
  for(const path of await readdir(dir+'/'+name))if(path.startsWith('fixture-ca-')||['manifest.key','checkpoint.key','leaf.key','leaf.csr'].includes(path))await rm(dir+'/'+name+'/'+path,{recursive:true,force:true});
 }
}
