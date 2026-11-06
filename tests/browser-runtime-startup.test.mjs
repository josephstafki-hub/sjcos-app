import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {strictStartup,strictDatabaseUrl,PROCESS_ROLES,protectedFile} from '../lib/browser/startup.mjs';
import {buildBrowserLaunch,spawnBrowserCli,browserPrompt,historyPartition,ALLOWED_TOOLS,requireCliSupport} from '../lib/browser/cli-launch.mjs';
import {LaunchRegistry} from '../lib/browser/rendezvous.mjs';
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
