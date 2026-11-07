import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {strictStartup,strictDatabaseUrl,PROCESS_ROLES,protectedFile} from '../lib/browser/startup.mjs';
import {buildBrowserLaunch,spawnBrowserCli,browserPrompt,historyPartition,ALLOWED_TOOLS,requireCliSupport} from '../lib/browser/cli-launch.mjs';
import {LaunchRegistry} from '../lib/browser/rendezvous.mjs';
function completeChild(child,{timeout=5000,paused=false}={}){
 let out='',err='',timer;
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
 if(paused){child.stdout.pause();child.once('exit',()=>setTimeout(()=>child.stdout.resume(),30));}
 return new Promise((resolve,reject)=>{
  timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('child close timeout'));},timeout);
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err});});
 });
}
test('stdout paused until after exit parses complete JSON at close',async()=>{
 const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['-e','process.stdout.write(JSON.stringify({complete:true}))']);
 const result=await completeChild(child,{paused:true});assert.equal(result.code,0);assert.deepEqual(JSON.parse(result.out),{complete:true});
});
for(const [kind,role]of Object.entries(PROCESS_ROLES))test(kind+' strict startup: no owner/env/SET ROLE fallback, positive session',async()=>{
 let called=0;const key=role==='sjcos_agent'?'DATABASE_URL_AGENT':'DATABASE_URL_BROWSER',dsn='postgresql://'+role+':unused@invalid/unused';
 const connect=async()=>{called++;return {query:async()=>({rows:[{session_user:role,current_user:role,rolsuper:false,rolbypassrls:false}]}),end:async()=>{}}}; const opts={connect,env:{[key]:dsn}};
 await strictStartup(kind,opts);assert.equal(called,1);
 for(const env of [{},{DATABASE_URL:'postgresql://owner@invalid/unused'},{[key]:'postgresql://owner@invalid/unused'},{[key]:dsn+'?options=-crole%3Downer'},{[key]:''}]){called=0;await assert.rejects(strictStartup(kind,{...opts,env}),/BROWSER_DB_STARTUP_REFUSED/);assert.equal(called,0);}
 await assert.rejects(strictStartup(kind,{...opts,env:{[key]:'postgresql://owner@invalid/unused'},credentialFile:'/protected',readCredential:async()=>dsn}));
 let ended=0;await assert.rejects(strictStartup(kind,{...opts,connect:async()=>({query:async()=>({rows:[{session_user:role,current_user:'owner',rolsuper:false,rolbypassrls:false}]}),end:async()=>{ended++;}})}));assert.equal(ended,1);
 assert.equal((await strictDatabaseUrl(kind,{credentialFile:'/protected',readCredential:async()=>dsn})).role,role);
});
test('protected credential file rejects group read and never follows symlinks',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'browser-db-'));try{const file=path.join(dir,'cred');await writeFile(file,'postgresql://sjcos_agent@invalid/unused',{mode:0o640});await assert.rejects(protectedFile(file));await chmod(file,0o600);assert.match(await protectedFile(file),/^postgresql:/);const link=path.join(dir,'link');await symlink(file,link);await assert.rejects(protectedFile(link));}finally{await rm(dir,{recursive:true,force:true});}});
test('real argv/env construction through fake CLI: partition, exact tools, no privileged transcript',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'browser-cli-'));
 try {
  const fake=path.join(root,'fake-cli');await writeFile(fake,`#!/usr/bin/node\nprocess.stdin.once('data',data=>{console.log(JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd(),input:data.toString()}));});`,{mode:0o700});
  const ids={root,userId:randomUUID(),taskId:randomUUID(),runId:randomUUID(),conversationId:randomUUID(),sessionId:randomUUID(),model:'sonnet',servers:{browser:'/trusted/browser.mjs',sjcos:'/trusted/sjcos.mjs',interact:'/trusted/interact.mjs'}};
  const launch=await buildBrowserLaunch(ids),child=spawnBrowserCli(fake,launch);let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.stdin.end(browserPrompt({purpose:'Permit',confirmedFacts:['Person confirmed address']}));
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});assert.equal(code,0,stderr);const actual=JSON.parse(stdout);
  assert.deepEqual(actual.args,launch.args);assert.equal(actual.args[actual.args.indexOf('--tools')+1],'');assert.deepEqual(actual.args[actual.args.indexOf('--allowedTools')+1].split(' '),ALLOWED_TOOLS);
  for(const key of ['DATABASE_URL','DATABASE_URL_AGENT','CRON_SECRET','SJCOS_ENV','NODE_OPTIONS','HTTP_PROXY','ANTHROPIC_BASE_URL'])assert.equal(actual.env[key],undefined,key);
  assert.equal(actual.env.SJC_DB_STRICT,'1');assert.equal(actual.env.HOME.startsWith(launch.partition),true);assert.equal(actual.cwd,launch.cwd);assert.equal(actual.input.includes('operator transcript'),false);assert.equal(JSON.parse(actual.input).message.role,'user');
  const config=JSON.parse(await readFile(launch.configFile));assert.deepEqual(Object.keys(config.mcpServers),['browser','sjcos','interact']);assert.equal(JSON.stringify(config).includes('DATABASE_URL'),false);
  assert.notEqual(historyPartition(ids),historyPartition({...ids,userId:randomUUID()}));assert.notEqual(historyPartition(ids),historyPartition({...ids,taskId:randomUUID()}));assert.throws(()=>historyPartition({...ids,profile:'operator'}));
  await assert.rejects(buildBrowserLaunch({...ids,runId:randomUUID(),providerEnv:{DATABASE_URL:'owner'}}));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unsupported real CLI behavior and managed settings refuse startup',()=>{assert.throws(()=>requireCliSupport('--tools'));assert.throws(()=>requireCliSupport('--strict-mcp-config --tools --allowedTools --setting-sources --settings --safe-mode --no-chrome --disable-slash-commands --session-id'));});
test('kernel-proof rendezvous slots are one-shot, descendant/start/cgroup/digest bound',()=>{
 const registry=new LaunchRegistry(),record={runId:'r',pid:123,startTime:'456',uid:42,cgroup:'isolated',taskId:'t',principalId:'p',nodeDigest:'node',executables:{browser:'wrapper',sjcos:'sjcos',interact:'interact'}};
 registry.register(record);const peer={uid:42,pid:124,startTime:'457',cgroup:'isolated',ancestors:[{pid:123,startTime:'456'}],executableDigest:'node',scriptDigest:'wrapper'};
 for(const change of [{uid:43},{cgroup:'host'},{ancestors:[{pid:123,startTime:'old'}]},{scriptDigest:'unknown'},{executableDigest:'other'}])assert.throws(()=>registry.consume({runId:'r',kind:'browser'},{...peer,...change}));
 const cap=registry.consume({runId:'r',kind:'browser'},peer);assert.equal(cap.profile,'browser');assert.equal(cap.capability.length,43);assert.throws(()=>registry.consume({runId:'r',kind:'browser'},peer));registry.revoke('r');assert.throws(()=>registry.consume({runId:'r',kind:'sjcos'},{...peer,scriptDigest:'sjcos'}));
});
import {connectRendezvous} from '../lib/browser/rendezvous-client.mjs';
test('stdio rendezvous refuses HTTP/custom sockets and copied malformed identity before I/O',async()=>{await assert.rejects(connectRendezvous({runId:'copied',kind:'browser'}));await assert.rejects(connectRendezvous({runId:randomUUID(),kind:'browser',socketPath:'/tmp/forged.sock'}));await assert.rejects(connectRendezvous({runId:randomUUID(),kind:'owner'}));});
// Fresh expectations: browser MCP must receive only the browser DSN through
// its authenticated socket; no registry request may smuggle principal/DSN.
import {startupFromRegistration,validateRegistration} from '../lib/browser/rendezvous-client.mjs';
test('browser wrapper selects narrow browser role before any registration',async()=>{
 const ids={runId:randomUUID(),taskId:randomUUID(),principalId:randomUUID(),profile:'browser',capability:'x'.repeat(43),dsn:'postgresql://sjcos_browser@invalid/unused'};let actual;
 const r=await startupFromRegistration({registration:ids,runId:ids.runId,taskId:ids.taskId,kind:'browser',connectDb:async dsn=>{actual=dsn;return {query:async()=>({rows:[{session_user:'sjcos_browser',current_user:'sjcos_browser',rolsuper:false,rolbypassrls:false}]})};}});
 assert.equal(actual,ids.dsn);assert.equal(r.verifiedRun.dsn,undefined);
 for(const change of [{runId:randomUUID()},{taskId:randomUUID()},{capability:'short'},{dsn:'postgresql://owner@invalid/unused'},{extra:'secret'}])await assert.rejects(startupFromRegistration({registration:{...ids,...change},runId:ids.runId,taskId:ids.taskId,kind:'browser',connectDb:async()=>{throw Error('must not connect');}}));
});
for(const changes of [{session_user:'owner'},{current_user:'owner'},{rolsuper:true},{rolbypassrls:true}])test('strict browser DB rejects '+JSON.stringify(changes),async()=>{let ended=false;await assert.rejects(strictStartup('browser',{env:{DATABASE_URL_BROWSER:'postgresql://sjcos_browser@invalid/unused'},connect:async()=>({query:async()=>({rows:[{session_user:'sjcos_browser',current_user:'sjcos_browser',rolsuper:false,rolbypassrls:false,...changes}]}),end:async()=>{ended=true;}})}));assert.equal(ended,true);});

test('real fake CLI → MCP, kernel peer registration, protected delivery, actual narrow DB and replay refusal',async()=>{
 const {withTestDb,stopCluster,assertNotProduction}=await import('./_harness/testdb.mjs');
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const {fileURLToPath}=await import('node:url');const pg=(await import('pg')).default;
 const repo=fileURLToPath(new URL('..',import.meta.url));const root=await mkdtemp(path.join(os.tmpdir(),'browser-two-hop-'));
 let broker,brokerExit,launcherChild;
 try{await withTestDb(async(url,admin)=>{
  assertNotProduction(url);const role=(await admin.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='sjcos_browser'")).rows[0];assert.deepEqual(role,{rolcanlogin:true,rolsuper:false,rolbypassrls:false});
  const dbUrl=new URL(url);dbUrl.username='sjcos_browser';const dsn=dbUrl.href;
  const credential=path.join(root,'credential');await writeFile(credential,dsn,{mode:0o600});
  const socket=path.join(root,'launch.sock'),registry=path.join(root,'registry');await (await import('node:fs/promises')).mkdir(registry,{mode:0o700});
  const launcher=path.join(root,'launcher.mjs'),mcp=path.join(root,'mcp.mjs'),fake=path.join(root,'fake-cli');
  await writeFile(mcp,`import {exchangeRendezvous,validateRegistration,startupFromRegistration} from '${repo}lib/browser/rendezvous-client.mjs';\nimport {parseMcpIdentity} from '${repo}lib/browser/cli-launch.mjs';\nimport pg from '${repo}node_modules/pg/lib/index.js';\nconst {runId,taskId,kind}=parseMcpIdentity(process.argv.slice(2));const options={socketPath:${JSON.stringify(socket)},request:{runId,kind},validate:x=>validateRegistration(x,{runId,taskId})};\nconst registration=await exchangeRendezvous(options);\nconst {client,verifiedRun}=await startupFromRegistration({registration,runId,taskId,kind,connectDb:async dsn=>{const c=new pg.Client({connectionString:dsn});await c.connect();return c;}});await client.end();\nlet replay=false;try{await exchangeRendezvous(options);}catch{replay=true;}\nconsole.log(JSON.stringify({verifiedRun,replay}));`);
  await writeFile(fake,`#!/usr/bin/node\nconst {spawn}=require('node:child_process'),fs=require('node:fs');process.stdin.once('data',()=>{const args=process.argv.slice(2),config=JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config')+1]));const s=config.mcpServers.browser;const c=spawn(s.command,s.args,{stdio:'inherit'});c.on('exit',code=>process.exit(code??1));});`,{mode:0o700});
  const ids={root:path.join(root,'history'),userId:randomUUID(),taskId:randomUUID(),runId:randomUUID(),conversationId:randomUUID(),sessionId:randomUUID(),model:'sonnet',servers:{browser:mcp,sjcos:mcp,interact:mcp}};
  const launch=await buildBrowserLaunch(ids);
  await writeFile(launcher,`import {spawn} from 'node:child_process';import {once} from 'node:events';import {exchangeRendezvous} from '${repo}lib/browser/rendezvous-client.mjs';const launch=${JSON.stringify(launch)};const c=spawn(${JSON.stringify(fake)},launch.args,{cwd:launch.cwd,env:launch.env,stdio:['pipe','inherit','inherit']});await once(c,'spawn');await exchangeRendezvous({socketPath:${JSON.stringify(socket)},request:{op:'register',runId:${JSON.stringify(ids.runId)},taskId:${JSON.stringify(ids.taskId)},principalId:${JSON.stringify(ids.userId)},pid:c.pid},validate:x=>{if(!x.registered)throw Error();}});c.stdin.end('confirmed facts only\\n');const [code]=await once(c,'close');process.exit(code??1);`);
  const python=String.raw`
import sys,os,socket,hashlib,json
sys.path.insert(0,sys.argv[1]+'/deploy/browser')
from launch_broker import exchange
root=sys.argv[2]
h=lambda p:hashlib.sha256(open(p,'rb').read()).hexdigest()
policy={'launcherUid':os.getuid(),'launcherDigests':[h(root+'/launcher.mjs')],'launcherNodeDigest':h(sys.argv[3]),'cliDigest':h(sys.argv[3]),'nodeDigest':h(sys.argv[3]),'executables':{k:h(root+'/mcp.mjs') for k in ('browser','sjcos','interact')},'credentialFiles':{k:root+'/credential' for k in ('browser','sjcos','interact')}}
s=socket.socket(socket.AF_UNIX);s.bind(root+'/launch.sock');s.listen(3);print('READY',flush=True)
try:
 for _ in range(3):
  c,_=s.accept()
  with c:exchange(c,root+'/registry','test-boot',policy,owner_uid=os.getuid())
finally:s.close()
`;
  broker=spawn('python3',['-B','-u','-c',python,repo,root,process.execPath],{stdio:['ignore','pipe','pipe']});brokerExit=once(broker,'close');let errors='';broker.stderr.on('data',x=>errors+=x);
  let readyTimer;try{await Promise.race([once(broker.stdout,'data'),brokerExit.then(()=>{throw Error(errors);}),new Promise((_,reject)=>{readyTimer=setTimeout(()=>reject(Error('broker timeout')),5000);})]);}finally{clearTimeout(readyTimer);}
  const child=launcherChild=spawn(process.execPath,[launcher],{stdio:['ignore','pipe','pipe'],detached:true});const completion=completeChild(child);const {code,out,err}=await completion;assert.equal(code,0,err+errors);
  const result=JSON.parse(out);assert.equal(result.replay,true);assert.equal(result.verifiedRun.taskId,ids.taskId);assert.equal(result.verifiedRun.dsn,undefined);assert.equal(out.includes(dsn),false);
  const [brokerCode]=await brokerExit;assert.equal(brokerCode,0,errors);
 },{fresh:true});}finally{try{if(launcherChild?.pid)process.kill(-launcherChild.pid,'SIGKILL');}catch{}broker?.kill('SIGKILL');stopCluster();await rm(root,{recursive:true,force:true});}
});

import {PROFILE_TOOLS,registerProfileTools} from '../mcp/browser-profile-tools.mjs';
test('filtered SJC and interact registration exposes only frozen names and denial helper',async()=>{
 for(const kind of ['sjcos','interact']){
  const registered=new Map();const server={registerTool:(n,s,fn)=>registered.set(n,{s,fn})};
  registerProfileTools(server,{kind,verifiedRun:{profile:'browser',capability:'x'.repeat(43)},invoke:async()=>({answer:'bounded'})});
  assert.deepEqual([...registered.keys()],kind==='sjcos'?['get_operating_context','get_project','get_lead','get_work_item']:['ask_owner','approve_action']);
  if(kind==='interact'){const denied=await registered.get('approve_action').fn({tool_name:'Read',input:{secret:'NEVER_STORE'}});assert.match(denied.content[0].text,/deny/);assert.doesNotMatch(denied.content[0].text,/NEVER_STORE/);}
 }
 assert.equal(PROFILE_TOOLS.sjcos.get_project.input.safeParse({project_id:randomUUID(),include_notes:true}).success,false);
});
import {validateProductionNamespace} from '../lib/browser/launcher.mjs';
test('production namespace rejects disposable validator and inode substitution',()=>{
 const valid={name:'sjcos-browser',current:'net:[1234]',host:'net:[1]',currentInode:1234,expectedInode:1234};
 assert.equal(validateProductionNamespace(valid),true);
 for(const change of [{name:'b0b-1234abcd-b'},{current:'net:[1]'},{expectedInode:1235},{currentInode:'1234'}])assert.throws(()=>validateProductionNamespace({...valid,...change}));
});
