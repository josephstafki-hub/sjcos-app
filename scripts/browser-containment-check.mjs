#!/usr/bin/env node
// COORDINATOR ONLY. --plan has no side effects. --run creates disposable netns.
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {namespacePlan} from '../deploy/browser/containment.mjs';
import {validateEvidence,NETWORK_CASES} from '../lib/browser/acceptance.mjs';
const tag=randomBytes(4).toString('hex'),plan=namespacePlan(tag),runId=randomUUID();
if(!process.argv.includes('--run')){console.log(JSON.stringify({plan,requiredCases:NETWORK_CASES,caps:{child:'3G',gate:'384M',cpu:'150%',tasks:256},note:'No namespaces created. --run requires root, reviewed fixture driver and preexisting capped disposable cgroup.'},null,2));}
else {
 const arg=k=>process.argv[process.argv.indexOf(k)+1];
 const driver=arg('--driver'),output=arg('--output');
 if(process.getuid()!==0||!process.argv.includes('--disposable-only')||!driver?.startsWith('/')||!output?.startsWith('/tmp/'))throw Error('BROWSER_FIXTURE_ROOT_AND_EXPLICIT_PATHS_REQUIRED');
 const s=await lstat(driver);if(!s.isFile()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_FIXTURE_DRIVER_NOT_TRUSTED');
 const cg=(await readFile('/proc/self/cgroup','utf8')).trim().split(':').at(-1);
 const cap=Number((await readFile('/sys/fs/cgroup'+cg+'/memory.max','utf8')).trim());
 if(!Number.isFinite(cap)||cap>3*1024**3)throw Error('BROWSER_FIXTURE_CGROUP_CAP_REQUIRED');
 const made=[],links=[];
 const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{input,encoding:'utf8',timeout:15000,maxBuffer:65536});if(r.status!==0)throw Error('BROWSER_NAMESPACE_COMMAND_FAILED');return r.stdout;};
 try {
  for(const [cmd,args,input]of plan.commands){run(cmd,args,input);if(args[0]==='netns'&&args[1]==='add')made.push(args[2]);if(args[0]==='link'&&args[1]==='add')links.push(args[2],args.at(-1));}
  // The reviewed driver starts gate, validating DNS, hostile HTTPS/CDP fixtures,
  // packet capture and Chromium INSIDE these namespaces only, with own subcaps.
  const result=spawnSync(driver,['--kind','network','--run-id',runId,'--browser-ns',plan.names.browser,'--gate-ns',plan.names.gate,'--fixture-ns',plan.names.fixture],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin'}});
  if(result.status!==0)throw Error('BROWSER_NETWORK_DRIVER_FAILED');
  const evidence=JSON.parse(result.stdout);validateEvidence(evidence,{runId,kind:'network'});await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
 }finally {
  // Kill ONLY processes in namespaces this invocation created; remove every
  // namespace even on driver failure. Never touch host/live named services.
  for(const n of made.reverse()){
   const p=spawnSync('ip',['netns','pids',n],{encoding:'utf8'}).stdout??'';
   for(const pid of p.trim().split(/\s+/).filter(x=>/^\d+$/.test(x)))spawnSync('kill',['-KILL',pid]);
   spawnSync('ip',['netns','delete',n]);
  }
  for(const link of links)spawnSync('ip',['link','delete',link]);
 }
}
