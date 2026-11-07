#!/usr/bin/env node
/** Offline reversible installer. Default is a plan, never enables/starts units.
 * Runtime provisioning/pins are prerequisite, never downloaded here. A real
 * apply requires an independently signed, root-protected installation bundle.
 * Journal has hashes/metadata/backup paths, never credential bytes.
 */
import path from 'node:path';
import {isIP} from 'node:net';
import {classifyAddress} from '../../lib/browser/network-policy.mjs';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,lstat,mkdir,rename,open,unlink,rmdir,chmod,chown} from 'node:fs/promises';
import {createHash,verify as verifySignature} from 'node:crypto';
import {productionLaunchSpec} from '../../lib/browser/production-browser.mjs';
const SOURCE=fileURLToPath(new URL('../../',import.meta.url));
const JOURNAL='/var/lib/sjcos-browser-supervisor/install-journal.json';
const STATE='/var/lib/sjcos-browser-supervisor/phase1-install';
const hash=b=>createHash('sha256').update(b).digest('hex');
const error=c=>{throw Error('BROWSER_INSTALL_'+c);};
const credentials=['browser-database','web-rpc','web-response','frame','read-dispatch','request-hmac','manifest-hmac','audit','read-dispatch-public','gate-ca-key','peer-key','checkpoint-key','checkpoint-public','exporter-key','exporter-public','sink-writer','retention-database'];
const requiredBundle=['phase1-bridge.mjs','supervisor-bridge.py','production.json','supervisor.json','namespace.json','phase1-gate.json','root-broker.json','exporter.json','ca-public.pem',...credentials.map(n=>'credentials/'+n)];
const missing=async f=>{try{return await lstat(f);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
function accountCheck(a){
 if(!Number.isSafeInteger(a?.joe)||a.joe<=0||a.browser?.name!=='sjcos-browser'||a.browser.uid!==998)error('ACCOUNT');
 const uids=[a.joe,998];for(const [k,name] of [['controller','sjcos-browser-controller'],['gate','sjcos-browser-gate'],['dns','sjcos-browser-dns'],['runner','sjcos-browser-runner'],['retention','sjcos-browser-retention'],['exporter','sjcos-browser-exporter']]){const x=a[k];if(x?.name!==name||!Number.isSafeInteger(x.uid)||x.uid<=0||uids.includes(x.uid))error('ACCOUNT');uids.push(x.uid);}
}
export async function installationPlan({accounts,evidence}){
 accountCheck(accounts);if(evidence?.phase!==1||evidence.sourceVerified!==true||evidence.acceptanceVerified!==true||evidence.accountingVerified!==true||!Number.isInteger(evidence.databasePort)||evidence.databasePort<1||evidence.databasePort>65535)error('EVIDENCE');
 const unitSources=JSON.parse(await readFile(new URL('./phase1-unit-files.json',import.meta.url),'utf8'));
 unitSources['sjcos-browser-retention.timer']=await readFile(new URL('./sjcos-browser-retention.timer',import.meta.url),'utf8');
 const files=[];for(const [name,content] of Object.entries(unitSources))files.push({path:'/etc/systemd/system/'+name.replaceAll('@JOE_UID@',String(accounts.joe)),content:content.replaceAll('@JOE_UID@',String(accounts.joe)).replaceAll('@BROWSER_DB_PORT@',String(evidence.databasePort)),mode:0o644});
 files.push({path:'/etc/sjcos-browser/unbound.conf',content:await readFile(new URL('./phase1-unbound.conf',import.meta.url),'utf8'),mode:0o644});
 const spec=productionLaunchSpec('/run/sjcos-browser-chromium/p/profile');
 files.push({path:'/etc/sjcos-browser/production-launch.json',content:JSON.stringify({executable:spec.executable,args:spec.args.map(s=>s.replace('/run/sjcos-browser-chromium/p/profile','@PROFILE@'))}),mode:0o644});
 files.push({path:'/etc/apparmor.d/sjcos-browser-chrome',content:'# Isolated pinned browser userns only. Loaded separately by coordinator.\nabi <abi/4.0>,\ninclude <tunables/global>\nprofile sjcos-browser-chrome /opt/sjcos-browser/browsers/chromium-1248/chrome-linux64/chrome flags=(unconfined) { userns, }\nprofile sjcos-browser-chrome-headless-shell /opt/sjcos-browser/browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell flags=(unconfined) { userns, }\n',mode:0o644});
 // User ancestor is a separate prerequisite; never move workloads/restart apps.
 return {v:1,dryRun:true,accounts,requires:['all current workloads below user-'+accounts.joe+'.slice (24G/Swap0/800%)','existing pinned /opt runtime with verified installed-hashes.json','independent signed Phase1 evidence for exact source lock','root-protected bundle with all adapters, configs, CA and credentials','AppArmor userns profile loaded by coordinator','existing approved IPv4 forwarding','reviewed exporter.json endpoint/bucket/region/install_id/controller_uid/controller_gid/pinned_ips/retention_days (731..3650)','dedicated S3 Object Lock COMPLIANCE bucket; writer may GetObject/PutObject/HeadObject with CAS, never DeleteObject or shorten retention','root-broker.json pins website/controller/runner UIDs, runnerGid, exact node/runner/MCP digests, cgroup, credentialFiles','separate owner retention-database and narrow runner credential provisioning'],files,requiredBundle,actions:['freeze and verify sources','journal before each file mutation','copy exact source graph and units','copy verified bundle credentials without logging bytes','verify installed digests'],activation:false};
}
async function resolveSafe(root,logical){
 if(!logical.startsWith('/')||logical.split('/').includes('..'))error('PATH');const dest=path.join(root,logical);
 for(let q=dest;;q=path.dirname(q)){const st=await missing(q);if(st?.isSymbolicLink())error('SYMLINK');if(q===root||q==='/')break;}
 return dest;
}
async function atomic(file,data,mode=0o600){const tmp=file+'.phase1-tmp';const fd=await open(tmp,'wx',mode);try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}await rename(tmp,file);const dir=await open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}
async function verifiedBundle(bundle,root){
 if(!bundle?.directory||!bundle?.reviewKey||!bundle?.evidenceFile)error('BUNDLE');
 for(const file of [bundle.directory,bundle.reviewKey,bundle.evidenceFile]){
  for(let q=file;;q=path.dirname(q)){const s=await lstat(q);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))error('BUNDLE_OWNER');if(q==='/')break;}
 }
 const raw=JSON.parse(await readFile(bundle.evidenceFile,'utf8')),bytes=Buffer.from(JSON.stringify(raw.payload));
 if(!verifySignature(null,bytes,await readFile(bundle.reviewKey),Buffer.from(raw.signature??'','base64')))error('EVIDENCE');
 const p=raw.payload,lock=await readFile(path.join(SOURCE,'deploy/browser/runtime-lock.json'));
 if(p.phase!==1||p.sourceLockSha256!==hash(lock)||p.releaseReady!==true||p.accountingVerified!==true||!Number.isFinite(p.expiresAt)||p.expiresAt<=Date.now()||p.joeUid!==Number(path.basename(p.commonAncestor??'').match(/^user-(\d+)\.slice$/)?.[1]))error('EVIDENCE');
 if(root!=='/'||process.getuid()!==0)error('ROOT');
 for(const file of ['/run/sjcos-browser-runtime/web.sock','/run/netns/sjcos-browser','/run/netns/sjcos-browser-gate'])if(await missing(file))error('ACTIVE');
 const installed=JSON.parse(await readFile('/opt/sjcos-browser/installed-hashes.json','utf8'));
 if(installed.sourceLockSha256!==hash(lock))error('RUNTIME_LOCK');
 for(const name of requiredBundle){const data=await readFile(await resolveSafe(bundle.directory,'/'+name));if(hash(data)!==p.bundleHashes?.[name])error('BUNDLE_HASH');}
 const exporter=JSON.parse(await readFile(path.join(bundle.directory,'exporter.json'),'utf8'));exporter.retention_days??=731;
 if(!Array.isArray(exporter.pinned_ips)||!exporter.pinned_ips.length||exporter.pinned_ips.some(ip=>!isIP(ip)||!classifyAddress(ip).global)||!Number.isInteger(exporter.retention_days)||exporter.retention_days<731||exporter.retention_days>3650)error('EXPORTER');
 for(const key of ['privateCanaryEvidenceSha256','publicReadEvidenceSha256','staffParityEvidenceSha256','transportEvidenceSha256','supervisorEvidenceSha256'])if(!/^[a-f0-9]{64}$/.test(p[key]??''))error('EVIDENCE');
 return p;
}
export async function applyPlan(plan,{root='/',apply=false,fixture=false,bundle}={}){
 if(!apply)return {dryRun:true,paths:plan.files.map(f=>f.path),requires:plan.requires};
 root=path.resolve(root);if(root==='/'||!fixture){const ev=await verifiedBundle(bundle,root);const actual=await localAccounts();if(JSON.stringify(actual)!==JSON.stringify(plan.accounts))error('ACCOUNT');if(ev.joeUid!==plan.accounts.joe)error('ACCOUNT');bundle={...bundle,scriptHashes:ev.scriptHashes};}
 if(fixture&&root==='/')error('ROOT');
 accountCheck(plan.accounts);
 const frozen=plan.files.map(f=>({...f,data:Buffer.from(f.content)}));
 if(!fixture){
  const lockBytes=await readFile(path.join(SOURCE,'deploy/browser/runtime-lock.json')),lock=JSON.parse(lockBytes);
  for(const [name,digest] of Object.entries(lock.files)){const data=await readFile(path.join(SOURCE,name));if(hash(data)!==digest)error('SOURCE_HASH');frozen.push({path:'/opt/sjcos-browser/node/source/'+name,data,mode:name.endsWith('.sh')?0o755:0o644});}
  for(const name of ['scripts/sjcos-browser.mjs','scripts/run-browser-agent.mjs','scripts/browser-retention.mjs']){const data=await readFile(path.join(SOURCE,name));if(hash(data)!==bundle.scriptHashes?.[name])error('SOURCE_HASH');frozen.push({path:'/opt/sjcos-browser/node/source/'+name,data,mode:0o644});}
  const ev=await verifiedBundle(bundle,root);
  const exporter=JSON.parse(await readFile(path.join(bundle.directory,'exporter.json'),'utf8'));
  const broker=JSON.parse(await readFile(path.join(bundle.directory,'root-broker.json'),'utf8'));
  if(exporter.controller_uid!==plan.accounts.controller.uid||broker.controllerUid!==plan.accounts.controller.uid||broker.runnerUid!==plan.accounts.runner.uid||broker.websiteUid!==plan.accounts.joe)error('ACCOUNT');
  frozen.push({path:'/etc/systemd/system/sjcos-browser-checkpoint-exporter.service.d/egress.conf',data:Buffer.from('[Service]\n'+exporter.pinned_ips.map(ip=>'IPAddressAllow='+ip+'/'+(isIP(ip)===4?'32':'128')).join('\n')+'\n'),mode:0o644});
  for(const name of requiredBundle){const data=await readFile(path.join(bundle.directory,name));if(hash(data)!==ev.bundleHashes[name])error('BUNDLE_HASH');frozen.push({path:'/etc/sjcos-browser/'+name,data,mode:name.startsWith('credentials/')||['supervisor.json','root-broker.json','exporter.json','production.json'].includes(name)?0o600:0o644});}
  frozen.push({path:'/etc/sjcos-browser/phase1-accepted',data:Buffer.from(hash(lockBytes)+'\n'),mode:0o644});
 }
 const journalFile=await resolveSafe(root,JOURNAL);if(await missing(journalFile))error('JOURNAL_EXISTS');
 const created=[];
 async function directory(logical){const dest=await resolveSafe(root,logical);if(await missing(dest))return;await directory(path.dirname(logical));created.push(logical);if(journal)await save();await mkdir(dest,{mode:logical.startsWith(STATE)||logical.includes('/credentials')?0o700:0o755});}
 let journal=null;await directory(STATE);await mkdir(path.dirname(journalFile),{recursive:true,mode:0o700});
 journal={v:1,state:'installing',files:[],directories:created,fixture};
 const save=()=>atomic(journalFile,JSON.stringify(journal));await save();
 async function put(logical,data,mode){const dest=await resolveSafe(root,logical);await directory(path.dirname(logical));const old=await missing(dest);if(old&&!old.isFile())error('FILE_TYPE');const before=old?await readFile(dest):null;const entry={path:logical,before:before?hash(before):null,after:hash(data),old:old?{uid:old.uid,gid:old.gid,mode:old.mode&0o777}:null,mode,backup:null};
  if(before!==null){entry.backup=STATE+'/backup-'+journal.files.length;await atomic(await resolveSafe(root,entry.backup),before,0o600);}
  journal.files.push(entry);await save();await atomic(dest,data,mode);await chmod(dest,mode);if(root==='/')await chown(dest,0,0);
 }
 for(const f of frozen)await put(f.path,f.data,f.mode);
 journal.state='installed';await save();return {installed:true,files:journal.files.length};
}
export async function verifyInstallation({root='/'}){const j=JSON.parse(await readFile(await resolveSafe(root,JOURNAL),'utf8'));if(j.v!==1||j.state!=='installed')error('JOURNAL');for(const f of j.files){const file=await resolveSafe(root,f.path),s=await lstat(file);if(!s.isFile()||hash(await readFile(file))!==f.after||(s.mode&0o777)!==f.mode)error('DRIFT');}return true;}
export async function uninstall({root='/',apply=false,fixture=false}={}){
 root=path.resolve(root);const journalFile=await resolveSafe(root,JOURNAL),j=JSON.parse(await readFile(journalFile,'utf8'));if(j.v!==1)error('JOURNAL');if(!apply)return {dryRun:true,restore:j.files.map(f=>f.path).reverse()};if(root==='/'&&(process.getuid()!==0||fixture))error('ROOT');if(root==='/')for(const f of ['/run/sjcos-browser-runtime/web.sock','/run/netns/sjcos-browser'])if(await missing(f))error('ACTIVE');
 // Check ALL files first: never partially roll back administrator edits. Missing
 // or before bytes are allowed during recovery of a journaled interrupted write.
 for(const f of j.files){const dest=await resolveSafe(root,f.path),st=await missing(dest);const current=st?hash(await readFile(dest)):null;if(current!==f.after&&current!==f.before)error('DRIFT');if(f.backup&&hash(await readFile(await resolveSafe(root,f.backup)))!==f.before)error('BACKUP');}
 for(const f of [...j.files].reverse()){const dest=await resolveSafe(root,f.path);if(f.backup){await atomic(dest,await readFile(await resolveSafe(root,f.backup)),f.old.mode);await chmod(dest,f.old.mode);if(root==='/')await chown(dest,f.old.uid,f.old.gid);await unlink(await resolveSafe(root,f.backup));}else await unlink(dest).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 await unlink(journalFile);
 for(const dir of [...j.directories].reverse())await rmdir(await resolveSafe(root,dir)).catch(e=>{if(!['ENOTEMPTY','ENOENT'].includes(e.code))throw e;});return {removed:true};
}
async function localAccounts(){
 const rows=(await readFile('/etc/passwd','utf8')).split('\n').map(s=>s.split(':'));const account=name=>({name,uid:Number(rows.find(x=>x[0]===name)?.[2])});
 return {joe:account('joe').uid,browser:account('sjcos-browser'),controller:account('sjcos-browser-controller'),gate:account('sjcos-browser-gate'),dns:account('sjcos-browser-dns'),runner:account('sjcos-browser-runner'),retention:account('sjcos-browser-retention'),exporter:account('sjcos-browser-exporter')};
}
async function cli(){
 const args=process.argv.slice(2),op=args.shift();if(!['install','uninstall','verify'].includes(op))error('USAGE');
 const flags=new Map();while(args.length){const k=args.shift();if(!['--apply','--bundle','--evidence','--review-key','--database-port'].includes(k)||flags.has(k))error('USAGE');flags.set(k,k==='--apply'?true:args.shift());}
 if(op==='uninstall')return uninstall({apply:flags.has('--apply')});if(op==='verify')return {verified:await verifyInstallation({root:'/'})};
 const accounts=await localAccounts();
 const bundle={directory:flags.get('--bundle'),evidenceFile:flags.get('--evidence'),reviewKey:flags.get('--review-key')};
 const verified=flags.has('--apply')?await verifiedBundle(bundle,'/'):null;
 const plan=await installationPlan({accounts,evidence:{phase:1,sourceVerified:true,acceptanceVerified:true,accountingVerified:true,databasePort:verified?.databasePort??Number(flags.get('--database-port'))}});
 return flags.has('--apply')?applyPlan(plan,{apply:true,bundle}):plan;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n')).catch(()=>{process.stderr.write('BROWSER_INSTALL_REFUSED\n');process.exitCode=1;});
