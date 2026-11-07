#!/usr/bin/env node
// COORDINATOR ONLY. Fresh delegated 3G root scope; helpers outside 384M gate.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,lstat,mkdir,rmdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {RSS_CASES,validateEvidence,coordinatorCommand} from '../lib/browser/acceptance.mjs';
const arg=k=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:undefined;
if(!process.argv.includes('--run'))console.log(JSON.stringify({command:coordinatorCommand('rss',{root:process.cwd(),uid:arg('--joe-uid')??process.getuid(),tag:arg('--tag')??'acceptance'}),requiredCases:RSS_CASES,gateMemoryMax:384*1024**2,gateMemorySwapMax:0,baselineMax:144*1024**2,accountedMax:336*1024**2,headroom:48*1024**2,note:'No process launched. Root scope is 3G; helper and gate are sibling subcgroups, gate capped at 384M. Missing delegated cgroup or integrated parser fixture fails closed.'},null,2));
else {
 const driver=arg('--driver'),output=arg('--output');
 if(process.getuid()!==0||!driver?.startsWith('/')||!/^\/tmp\/[a-zA-Z0-9_.-]+\.json$/.test(output??'')||!process.argv.includes('--disposable-only'))throw Error('BROWSER_FIXTURE_PATHS_REQUIRED');
 if(driver!=='/opt/sjcos-browser/fixtures/rss-driver')throw Error('BROWSER_INSTALLED_DRIVER_REQUIRED');
 const s=await lstat(driver);if(!s.isFile()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_FIXTURE_DRIVER_NOT_TRUSTED');
 const cg=(await readFile('/proc/self/cgroup','utf8')).trim().split(':').at(-1),base='/sys/fs/cgroup'+cg;
 if(!/\/browser-0b-rss-[a-zA-Z0-9_-]+\.scope$/.test(cg))throw Error('BROWSER_FRESH_DISPOSABLE_SCOPE_REQUIRED');
 const cap=Number((await readFile(base+'/memory.max','utf8')).trim());
 if(!Number.isFinite(cap)||cap>3*1024**3||(await readFile(base+'/memory.swap.max','utf8')).trim()!=='0')throw Error('BROWSER_PARENT_CGROUP_CAP_REQUIRED');
 const runId=randomUUID(),gate=base+'/gate-'+runId,helper=base+'/helpers-'+runId,supervisor=base+'/supervisor-'+runId;
 const made=[];
 try {
  // cgroup v2 no-internal-process rule: move runner out of the interior BEFORE
  // enabling controllers. Scope must contain ONLY this fresh runner.
  if((await readFile(base+'/cgroup.procs','utf8')).trim()!==String(process.pid))throw Error('BROWSER_SCOPE_NOT_EMPTY');
  for(const dir of [supervisor,gate,helper]){await mkdir(dir);made.push(dir);}
  await writeFile(supervisor+'/cgroup.procs',String(process.pid));
  await writeFile(base+'/cgroup.subtree_control','+memory +cpu +pids');
  for(const [dir,mem,cpu,tasks] of [[supervisor,384*1024**2,'10000 100000',8],[helper,256*1024**2,'25000 100000',16],[gate,384*1024**2,'35000 100000',32]]) {
   await writeFile(dir+'/memory.max',String(mem));await writeFile(dir+'/memory.swap.max','0');await writeFile(dir+'/cpu.max',cpu);await writeFile(dir+'/pids.max',String(tasks));
  }
  await writeFile(gate+'/cgroup.procs',String(process.pid));
  await writeFile(supervisor+'/memory.max',String(32*1024**2));
  const before=await readFile(gate+'/memory.events','utf8');
  const r=spawnSync(driver,['--kind','rss','--run-id',runId,'--no-network-outside-fixture','--helper-cgroup',helper],{encoding:'utf8',timeout:240000,maxBuffer:1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',PYTHONDONTWRITEBYTECODE:'1'}});
  if(r.status===137||r.signal==='SIGKILL')throw Error('BROWSER_FIXTURE_KILLED_DO_NOT_RETRY');
  if(r.status!==0)throw Error('BROWSER_RSS_DRIVER_FAILED');
  const evidence=JSON.parse(r.stdout),peak=Number((await readFile(gate+'/memory.peak','utf8')).trim());
  if(!Number.isFinite(peak)||peak<=0||peak>336*1024**2||(await readFile(gate+'/memory.events','utf8'))!==before)throw Error('BROWSER_RSS_CGROUP_FAILED');
  evidence.cgroupPeakBytes=peak;if(evidence.runtimeLockSha256!==createHash('sha256').update(await readFile('/opt/sjcos-browser/runtime-lock.json')).digest('hex'))throw Error('BROWSER_INSTALLED_LOCK_MISMATCH');validateEvidence(evidence,{runId,kind:'rss'});
  await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
 }finally {
  // cgroup.kill catches grandchildren even when a driver times out. Only fresh
  // invocation-owned groups are killed; never the scope/ancestor/live services.
  if(made.includes(supervisor))await writeFile(supervisor+'/memory.max',String(384*1024**2));
  for(const dir of [helper,gate])if(made.includes(dir)) {
   if(dir===gate)await writeFile(supervisor+'/cgroup.procs',String(process.pid));
   try{await writeFile(dir+'/cgroup.kill','1');}catch{}
  }
  await writeFile(base+'/cgroup.subtree_control','-memory -cpu -pids');
  await writeFile(base+'/cgroup.procs',String(process.pid));
  for(const dir of made.reverse())try{await rmdir(dir);}catch{}
 }
}
