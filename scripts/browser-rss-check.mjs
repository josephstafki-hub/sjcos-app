#!/usr/bin/env node
// COORDINATOR ONLY. Never run on the live gate or outside a disposable cgroup.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {RSS_CASES,validateEvidence} from '../lib/browser/acceptance.mjs';
if(!process.argv.includes('--run'))console.log(JSON.stringify({requiredCases:RSS_CASES,gateMemoryMax:384*1024**2,gateMemorySwapMax:0,baselineMax:144*1024**2,accountedMax:336*1024**2,headroom:48*1024**2,note:'No process launched. --run requires reviewed real parser driver inside disposable capped gate cgroup.'},null,2));
else {
 const arg=k=>process.argv[process.argv.indexOf(k)+1],driver=arg('--driver'),output=arg('--output');
 if(!driver?.startsWith('/')||!output?.startsWith('/tmp/')||!process.argv.includes('--disposable-only'))throw Error('BROWSER_FIXTURE_PATHS_REQUIRED');
 const s=await lstat(driver);if(!s.isFile()||s.uid!==0||(s.mode&0o022))throw Error('BROWSER_FIXTURE_DRIVER_NOT_TRUSTED');
 const cg=(await readFile('/proc/self/cgroup','utf8')).trim().split(':').at(-1),base='/sys/fs/cgroup'+cg;
 const cap=Number((await readFile(base+'/memory.max','utf8')).trim());
 if(!Number.isFinite(cap)||cap>384*1024**2||(await readFile(base+'/memory.swap.max','utf8')).trim()!=='0')throw Error('BROWSER_GATE_CGROUP_CAP_REQUIRED');
 const before=await readFile(base+'/memory.events','utf8'),runId=randomUUID();
 const r=spawnSync(driver,['--kind','rss','--run-id',runId,'--no-network-outside-fixture'],{encoding:'utf8',timeout:240000,maxBuffer:1024*1024,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin'}});
 if(r.status===137||r.signal==='SIGKILL')throw Error('BROWSER_FIXTURE_KILLED_DO_NOT_RETRY');
 if(r.status!==0)throw Error('BROWSER_RSS_DRIVER_FAILED');
 const evidence=JSON.parse(r.stdout),peak=Number((await readFile(base+'/memory.peak','utf8')).trim());
 if(!Number.isFinite(peak)||peak<=0||peak>336*1024**2||(await readFile(base+'/memory.events','utf8'))!==before)throw Error('BROWSER_RSS_CGROUP_FAILED');
 evidence.cgroupPeakBytes=peak;validateEvidence(evidence,{runId,kind:'rss'});
 await writeFile(output,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});
}
