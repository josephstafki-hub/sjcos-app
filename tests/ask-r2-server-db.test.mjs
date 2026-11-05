// Expectations written before implementation:
// - Real website owner/staff identities: only the captured live runner can
//   list/check its person's private grants (including expired), never foreign
//   or tombstoned ones. Missing and foreign responses are identical.
// - All three narrow SQL logins cannot SELECT private grants/reply copies;
//   shared business rows remain usable. Historical prompt reasons are redacted.
// - reply/grant/decision lookup denies foreign/deleted private replies before
//   mutation or Telegram; authorized own reply and business replies still work.
// - Filing bridge denies unbound/HTTP/forged/foreign/deleted Ask paths before
//   read/store, even under a configured ancestor root; own handoff works and
//   recovery closure denies it before bytes or storage.
// - Actual pre-delete pg_dump restore with local-volume loss cannot call back
//   when authority is absent/partial/wrong/unreachable or flag off. A preserved
//   deployment identity survives DB latch removal; missing identity fails closed.
//   Explicit new-install bootstrap with no authority is the positive control.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import ts from 'typescript';
import {withMigrationSubset,withSessionIdentity,startCluster,dbUrl} from './_harness/testdb.mjs';
import {bootstrapDeployment} from '../lib/ask-deployment-state.mjs';
import * as bridge from '../lib/ask-private-bridge.mjs';
import {createPrivateBridgeContext} from '../lib/ask-private-transport.mjs';
import * as journal from '../lib/ask-thread-journal.mjs';
import {validateChain} from '../lib/canvas-deletion-ledger.mjs';
const require=createRequire(import.meta.url),plain=x=>JSON.parse(JSON.stringify(x));
function load(file,deps={}){
 const exports={};const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 runInNewContext(source,{exports,process,Buffer,console,URL,Request,Response,setTimeout,clearTimeout,require:s=>Object.hasOwn(deps,s)?deps[s]:s.startsWith('node:')||s==='zod'?require(s):{}});return exports;
}
test('R2 actual bridges and real login privacy',async t=>withMigrationSubset('r2_server',[100,105],async({url,db,apply})=>{
 // Historical automatic reason must be removed by the real migration.
 await apply([100]);
 const old=(await db.query(`INSERT INTO owner_grants(actions,reason,expires_at) VALUES(ARRAY['*'],'Express permission given in the Ask window for: "HISTORICAL PRIVATE CANARY"',now()+interval '1 hour') RETURNING id`)).rows[0].id;
 await apply();assert.equal((await db.query('SELECT reason FROM owner_grants WHERE id=$1',[old])).rows[0].reason,'Express permission given in the Ask window.');
 const root=await mkdtemp(path.join(tmpdir(),'p0r2-bridge-')),saved={...process.env};
 const cwd=process.cwd();
 // Only fake cwd in the loaded byte-reader; never chdir the shared process.
 const fakeProcess={env:process.env,cwd:()=>root};
 const deploymentDir=path.join(root,'protected'),dir=path.join(root,'journal');await bootstrapDeployment(deploymentDir);
 let entries=[],unreachable=false;
 const authority={id:randomUUID(),read:async()=>{if(unreachable)throw Error('UNREACHABLE');return {ledger_id:authority.id,...validateChain(entries),entries:structuredClone(entries)};},advance:async(_expected,value)=>{entries=structuredClone(value);return authority.read();}};
 const options={dir,deploymentDir,authority};
 delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;
 try{
 const people=[],threads=[],contexts=[];
 for(const role of ['owner','staff','staff']){
  const person=(await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Person',$2,ARRAY['ai'],'x','P') RETURNING id`,[randomUUID()+'@example.test',role])).rows[0].id;people.push(person);
  const id=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','PRIVATE TITLE',$1) RETURNING id`,[person])).rows[0].id;threads.push(id);
 }
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool={query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})};
  await journal.withAskJournal(pool,async()=>{},options);
  const query=(...a)=>c.query(...a),queryOne=async(...a)=>(await query(...a)).rows[0]??null;
  for(let i=0;i<3;i++){
   const r=await queryOne(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source) VALUES('PRIVATE PROMPT',$1,$2,$3,'panel_web') RETURNING id,extract(epoch FROM created_at)::bigint::text AS started`,[i?'business':'operator',people[i],threads[i]]);
   contexts.push({transport:'runner_stdio',run_id:r.id,conversation_id:threads[i],principal_user_id:people[i],run_profile:i?'business':'operator',run_started_s:Number(r.started)});
  }
  const deps={'@/lib/db':{pool,query,queryOne},'@/lib/ask-private-bridge.mjs':{...bridge,withPrivateRunner:(p,ctx,fn)=>bridge.withPrivateRunner(p,ctx,fn,options)},'@/lib/ask-thread-journal.mjs':{withAskJournal:(p,fn)=>journal.withAskJournal(p,fn,options)}};
  const access=load('lib/thread-access.ts',{'@/lib/db':{pool},'@/lib/session':{readSession:async()=>({userId:people[0],authAt:Math.floor(Date.now()/1000)})},...deps});deps['@/lib/thread-access']=access;
  const grants=load('lib/owner-grants.ts',{...deps,'@/lib/owner-grant-types':{isGatedAction:()=>true}});
  const grantIds=[];for(let i=0;i<3;i++)grantIds.push((await grants.mintRunGrant(contexts[i].run_id,threads[i],'PRIVATE PROMPT CANARY')).id);
  const replies=load('lib/owner-reply-delivery.ts',{...deps,'@/lib/providers/types':{outboundDisabled:()=>false},'@/lib/providers/telegram':{defaultTransport:{configured:()=>true,call:async()=>{sent++;return {ok:true,result:{message_id:99}};}}},'@/lib/decisions/owner-replies':{rememberReplyTarget:async()=>{}}});
  const grantRoute=load('app/api/internal/owner-grants/route.ts',{...deps,'next/server':{NextResponse:Response},'@/lib/owner-grants':{...grants,grantLive:g=>g.status==='approved'&&new Date(g.expires_at)>new Date(),grantWaiting:()=>false,stagedSendOf:()=>null,stagedResultOf:()=>null},'@/lib/owner-reply-delivery':replies});
  process.env.CRON_SECRET='fixture-only';process.env.TELEGRAM_OWNER_CHAT_ID='fixture-chat';let sent=0;
  const post=async(action,payload={},context=null)=>plain(await (await grantRoute.POST(new Request('http://local',{method:'POST',headers:{authorization:'Bearer fixture-only'},body:JSON.stringify({action,...payload,context})}))).json());
  const replyIds=[],decisionIds=[];
  for(let i=0;i<3;i++){
   const d=await queryOne(`INSERT INTO decisions(kind,title,action,status) VALUES('grant','Business request','send_email','pending') RETURNING id`);decisionIds.push(d.id);
   await query('UPDATE owner_grants SET decision_id=$2 WHERE id=$1',[grantIds[i],d.id]);
   replyIds.push((await queryOne(`INSERT INTO owner_replies(grant_id,decision_id,conversation_id,route,body,answer) VALUES($1,$2,$3,'session','PRIVATE BODY CANARY','PRIVATE ANSWER CANARY') RETURNING id`,[grantIds[i],d.id,threads[i]])).id);
  }
  await t.test('explicit never-enabled bootstrap admits no-authority Ask; partial configuration cannot',async()=>{
   const before={...process.env};
   process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=deploymentDir;process.env.SJC_CANVAS_DELETION_LEDGER_DIR=path.join(root,'virgin-journal');
   for(const key of Object.keys(process.env))if(/^SJC_CANVAS_(AUTHORITY_|LEDGER_ID|JOURNAL_KEY)/.test(key))delete process.env[key];
   let called=0;await journal.withAskJournal(pool,async()=>{called++;});assert.equal(called,1);
   process.env.SJC_CANVAS_AUTHORITY_URL='https://journal.example.test';
   await assert.rejects(journal.withAskJournal(pool,async()=>{called++;}));assert.equal(called,1);
   for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);
   await journal.withAskJournal(pool,async()=>{},options);
  });
  await t.test('real staff and owner MCP list/check self-only, including expired checks',async()=>{
   for(let i=0;i<3;i++){
    const list=await post('list',{},contexts[i]);assert.ok(list.ok);assert.deepEqual(list.grants.filter(g=>grantIds.includes(g.id)).map(g=>g.id),[grantIds[i]]);
    assert.equal((await post('check',{grant_id:grantIds[i]},contexts[i])).ok,true);
    for(let j=0;j<3;j++)if(j!==i)assert.deepEqual(await post('check',{grant_id:grantIds[j]},contexts[i]),{ok:false,code:'THREAD_UNAVAILABLE'});
   }
   await query(`UPDATE owner_grants SET expires_at=now()-interval '1 hour' WHERE id=$1`,[grantIds[0]]);
   assert.equal((await post('check',{grant_id:grantIds[0]},contexts[0])).ok,true);
   assert.deepEqual(await post('check',{grant_id:grantIds[0]},contexts[1]),await post('check',{grant_id:randomUUID()},contexts[1]));
   assert.ok(!JSON.stringify(await post('list',{},contexts[0])).includes('PRIVATE PROMPT'));
   assert.deepEqual(await post('check',{grant_id:grantIds[0],principal_user_id:people[0]}),{ok:false,code:'THREAD_UNAVAILABLE'});
  });
  await t.test('three narrow session_user identities deny private copies but retain business SELECT',async()=>{
   const shared=(await queryOne(`INSERT INTO owner_replies(body,route) VALUES('Business reply','agent') RETURNING id`)).id;
   for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async n=>{
    assert.equal((await n.query('SELECT current_user::text,session_user::text')).rows[0].session_user,login);
    await n.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[0]]);
    assert.equal((await n.query('SELECT reason,scope,audit FROM owner_grants WHERE id=ANY($1::uuid[])',[grantIds])).rows.length,0);
    assert.equal((await n.query('SELECT body,answer FROM owner_replies WHERE id=ANY($1::uuid[])',[replyIds])).rows.length,0);
    assert.equal((await n.query('SELECT body FROM owner_replies WHERE id=$1',[shared])).rows[0].body,'Business reply');
    if(login==='sjcos_worker'){
     assert.equal((await n.query("UPDATE owner_replies SET answer='attack' WHERE id=$1 RETURNING id",[replyIds[0]])).rows.length,0);
     await assert.rejects(n.query("INSERT INTO owner_replies(conversation_id,body,route) VALUES($1,'attack','session')",[threads[0]]));
    }
   });
  });
  await t.test('reply/grant/decision foreign mutation denied before Telegram; own explicit answer works',async()=>{
   for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(i!==j)for(const selector of [{owner_reply_id:replyIds[j]},{grant_id:grantIds[j]},{decision_id:decisionIds[j]}]){
    assert.deepEqual(await post('reply',{...selector,outcome:'done',message:'attack'},contexts[i]),{ok:false,code:'THREAD_UNAVAILABLE'});
   }
   assert.equal(sent,0);assert.equal((await queryOne('SELECT answer FROM owner_replies WHERE id=$1',[replyIds[0]])).answer,'PRIVATE ANSWER CANARY');
   const own=await post('reply',{owner_reply_id:replyIds[0],outcome:'done',message:'explicit own answer'},contexts[0]);assert.equal(own.ok,true);assert.equal(sent,1);
  });
  await t.test('ordinary shared business reply and business card without reply still deliver',async()=>{
   const g=(await queryOne(`INSERT INTO owner_grants(actions,reason,expires_at) VALUES(ARRAY['send_email'],'Business permission',now()+interval '1 hour') RETURNING id`)).id;
   assert.equal((await post('reply',{grant_id:g,outcome:'done',message:'business answer'})).ok,true);
   const r=(await queryOne(`INSERT INTO owner_replies(grant_id,route,body) VALUES($1,'agent','Business reply') RETURNING id`,[g])).id;
   assert.equal((await post('reply',{owner_reply_id:r,outcome:'done',message:'business answer'})).ok,true);
   sent=0;
  });
  let stores=0,reads=0;
  const core=load('lib/unsorted-docs-core.ts');
  const store=async bytes=>{stores++;assert.equal(bytes.toString(),'PRIVATE FILE CANARY');const id='r2-file-'+randomUUID();await query(`INSERT INTO files(id,name,project_key) VALUES($1,'private.txt','')`,[id]);return {ok:true,id};};
  const readerDeps={...deps,'@/lib/commands/db':{runDirect:async(...a)=>(await query(...a)).rows,servicePrincipal:()=>({kind:'service'}),withTransaction:async fn=>{await query('BEGIN');try{const r=await fn(async(...a)=>(await query(...a)).rows);await query('COMMIT');return r;}catch(e){await query('ROLLBACK');throw e;}}},'@/lib/unsorted-docs-core':core,'@/lib/upload-store':{storeBuffer:store},'@/lib/uploads':{UPLOAD_DIR:root},'node:fs/promises':{...require('node:fs/promises'),readFile:async(...a)=>{reads++;return readFile(...a);}}};
  // Same actual module, isolated cwd; service/session/provider seams only.
  const file='lib/unsorted-docs.ts',ex={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports:ex,process:fakeProcess,Buffer,console,require:s=>readerDeps[s]??(s.startsWith('node:')?require(s):{})});
  const filing=load('app/api/internal/filing/route.ts',{...readerDeps,'@/lib/unsorted-docs':ex,'next/server':{NextResponse:Response}});
  const paths=[];for(let i=0;i<3;i++){const p=path.join(root,'uploads','ai-chat',people[i],Date.now()+'-private.txt');await mkdir(path.dirname(p),{recursive:true});await writeFile(p,'PRIVATE FILE CANARY');paths.push(p);await query(`INSERT INTO ai_messages(conversation_id,role,body,attachments) VALUES($1,'user','private', $2::jsonb)`,[threads[i],JSON.stringify([{path:p}])]);}
  process.env.SJCOS_FILING_PATH_ROOTS=root; // Ancestor must never override Ask.
  const filePost=async(p,context=null,extra={})=>plain(await (await filing.POST(new Request('http://local',{method:'POST',body:JSON.stringify({action:'stage',kind:'other',file_paths:[p],source_ref:randomUUID(),...extra,context})}))).json());
  await t.test('filing denies missing/forged/HTTP and owner/staff/two-staff foreign sources before read/store',async()=>{
   assert.equal((await filePost(paths[0])).code,'THREAD_UNAVAILABLE');
   assert.equal((await filePost(paths[0],{...contexts[1],principal_user_id:people[0]})).code,'THREAD_UNAVAILABLE');
   assert.equal((await filePost(paths[0],{...contexts[0],transport:'http'})).code,'THREAD_UNAVAILABLE');
   for(let i=0;i<3;i++)for(let j=0;j<3;j++)if(i!==j)assert.equal((await filePost(paths[j],contexts[i])).code,'THREAD_UNAVAILABLE');
   const alias=path.join(root,'shared-alias.txt');await symlink(paths[0],alias);assert.equal((await filePost(alias,contexts[1])).code,'THREAD_UNAVAILABLE');
   for(const context of [{...contexts[1],run_profile:'operator'},{...contexts[1],run_started_s:contexts[1].run_started_s+1},{...contexts[1],conversation_id:threads[0]}])assert.equal((await filePost(paths[1],context)).code,'THREAD_UNAVAILABLE');
   await query('UPDATE users SET active=false WHERE id=$1',[people[1]]);assert.equal((await filePost(paths[1],contexts[1])).code,'THREAD_UNAVAILABLE');await query('UPDATE users SET active=true WHERE id=$1',[people[1]]);
   assert.equal(stores,0);assert.equal(reads,0);
  });
  await t.test('filing authorized same-person explicit handoff reads/stages real SQL',async()=>{
   for(let i=0;i<3;i++){const result=await filePost(paths[i],contexts[i]);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.files,1);}
   assert.equal(stores,3);assert.equal(reads,3);
   assert.ok(!(await grants.listGrants(40)).some(g=>g.id===grantIds[1]||g.id===grantIds[2]));
  });
  await t.test('captured adapter strips claimed identity and never admits HTTP',()=>{
   const env={SJC_RUN_ID:contexts[0].run_id,SJC_CONVERSATION_ID:threads[0],SJC_PRINCIPAL_USER_ID:people[0],SJC_RUN_PROFILE:'operator',SJC_RUN_STARTED_S:String(contexts[0].run_started_s)};
   const get=createPrivateBridgeContext({transportKind:'stdio',env});env.SJC_PRINCIPAL_USER_ID=people[1];assert.equal(get().principal_user_id,people[0]);assert.equal(createPrivateBridgeContext({transportKind:'http',env})(),null);
  });
  // Dump BEFORE the deployment latch/first deletion, retain protected state.
  const backup=execFileSync('/usr/lib/postgresql/16/bin/pg_dump',['--no-owner','--no-privileges',url],{maxBuffer:20*1024*1024});
  process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';
  await journal.deleteThread(pool,threads[2],randomUUID(),options,people[2]);
  delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;
  await t.test('deleted source grants/replies inert, copies erased; recovery closed prevents byte/storage callbacks',async()=>{
   assert.deepEqual(await post('check',{grant_id:grantIds[2]},contexts[0]),{ok:false,code:'THREAD_UNAVAILABLE'});
   const count=sent;
   assert.equal((await post('reply',{owner_reply_id:replyIds[2],outcome:'done',message:'own tombstone'},contexts[2])).code,'THREAD_UNAVAILABLE');
   assert.equal((await filePost(paths[2],contexts[2])).code,'THREAD_UNAVAILABLE');
   for(const route of ['session','agent'])assert.equal((await replies.deliverOwnerReply({id:replyIds[2],route,conversationId:threads[2],chatId:'fixture-chat',messageId:1},'attack')).code,'THREAD_UNAVAILABLE');
   for(const selector of [{owner_reply_id:replyIds[2]},{grant_id:grantIds[2]},{decision_id:decisionIds[2]}])assert.equal((await post('reply',{...selector,outcome:'done',message:'attack'},contexts[0])).ok,false);
   assert.equal((await filePost(paths[2],contexts[0])).code,'THREAD_UNAVAILABLE');
   assert.equal((await queryOne('SELECT body FROM owner_replies WHERE id=$1',[replyIds[2]])).body,'[deleted]');
   const before=[reads,stores];unreachable=true;assert.equal((await filePost(paths[0],contexts[0])).code,'ASK_PAUSED');unreachable=false;assert.deepEqual([reads,stores],before);assert.equal(sent,count);
  });
  await t.test('real pre-latch dump restore + lost journal retains protected identity across missing/partial/wrong/unreachable authorities',async()=>{
   const state=startCluster(),restoreUrl=dbUrl(url,'sjcos_r2_restored');const admin=new pg.Client({connectionString:state.admin});await admin.connect();await admin.query('DROP DATABASE IF EXISTS sjcos_r2_restored WITH (FORCE)');await admin.query('CREATE DATABASE sjcos_r2_restored');await admin.end();
   execFileSync('/usr/lib/postgresql/16/bin/psql',[restoreUrl,'-X','-q','-v','ON_ERROR_STOP=1'],{input:backup,stdio:['pipe','ignore','pipe'],maxBuffer:2*1024*1024});
   await rm(dir,{recursive:true,force:true});
   await withSessionIdentity(restoreUrl,'sjcos_test_website',async r=>{
    const p={query:(...a)=>r.query(...a)};let callbacks=0;
    assert.equal((await r.query('SELECT deletion_enabled FROM ask_canvas_maintenance')).rows[0].deletion_enabled,false);
    process.env.SJC_ASK_DEPLOYMENT_STATE_DIR=deploymentDir;process.env.SJC_CANVAS_DELETION_LEDGER_DIR=dir;
    for(const key of Object.keys(process.env))if(/^SJC_CANVAS_(AUTHORITY_|LEDGER_ID|JOURNAL_KEY)/.test(key))delete process.env[key];
    await assert.rejects(journal.withAskJournal(p,async()=>{callbacks++;}));
    process.env.SJC_CANVAS_AUTHORITY_URL='https://journal.example.test';process.env.SJC_CANVAS_LEDGER_ID=authority.id;
    await assert.rejects(journal.withAskJournal(p,async()=>{callbacks++;}));
    await assert.rejects(journal.withAskJournal(p,async()=>{callbacks++;},{...options,authority:{...authority,id:randomUUID()}}));
    unreachable=true;await assert.rejects(journal.withAskJournal(p,async()=>{callbacks++;},options));unreachable=false;
    assert.equal(callbacks,0);
    await journal.withAskJournal(p,async()=>{callbacks++;assert.ok((await r.query('SELECT deleted_at FROM ai_conversations WHERE id=$1',[threads[2]])).rows[0].deleted_at);},options);
    assert.equal(callbacks,1);
    // Deleting DB latch refused. Lost deployment volume cannot mint virgin.
    await assert.rejects(r.query('DELETE FROM ask_canvas_maintenance'),/permanent/);
    await rm(path.join(deploymentDir,'identity.json'));await assert.rejects(journal.withAskJournal(p,async()=>assert.fail('missing identity callback'),options));
   });
  });
 });
 }finally{process.env=saved;assert.equal(process.cwd(),cwd);await rm(root,{recursive:true,force:true});}
}));
