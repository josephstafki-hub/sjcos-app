// Expectations first: real historical card rendering/persistence (sent/failed),
// legacy href/delivery links, 0105 and actual deletion/recovery replay remove
// private text. All three real narrow logins remain unable to read it; drain
// must sanitize an already-selected stale snapshot and late writes too.
// Unsafe journal/deployment folders yield owner-only allowlisted diagnosis,
// no callback, and recover after 0700 repair without deleting evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,chmod,rm,mkdir,symlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {withMigrationSubset,withSessionIdentity} from './_harness/testdb.mjs';
import * as journal from '../lib/ask-thread-journal.mjs';
import * as health from '../lib/ask-health.mjs';
import {bootstrapDeployment} from '../lib/ask-deployment-state.mjs';
import {validateChain} from '../lib/canvas-deletion-ledger.mjs';
const require=createRequire(import.meta.url),sentinel='R4_PRIVATE_PUSH_91c2';
function load(file,deps={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,process,Buffer,console,URL,Response,Request,Headers,require:s=>Object.hasOwn(deps,s)?deps[s]:s.startsWith('node:')?require(s):{}});return exports;}
const poolFor=c=>({query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})});
async function environment(fn){
 const root=await mkdtemp(path.join(os.tmpdir(),'p0r4-files-')),dir=path.join(root,'journal'),deploymentDir=path.join(root,'deployment');
 await mkdir(dir,{mode:0o700});await bootstrapDeployment(deploymentDir);
 let entries=[];
 const authority={id:randomUUID(),read:async()=>({ledger_id:authority.id,...validateChain(entries),entries:structuredClone(entries)}),advance:async(_old,next)=>{entries=structuredClone(next);return authority.read();}};
 try{return await fn({root,dir,deploymentDir,authority});}finally{await rm(root,{recursive:true,force:true});}
}
test('historical pushes, real narrow logins, tombstone/replay and stale queued retries',()=>withMigrationSubset('r4_push',[100,105],async({url,db,apply})=>environment(async options=>{
 await apply([100]);
 const person=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Owner','owner','x','O') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
 const thread=(await db.query(`INSERT INTO ai_conversations(agent,title) VALUES('claude','Private') RETURNING id`)).rows[0].id;
 const decision=(await db.query(`INSERT INTO decisions(kind,title,action,status,decision_note) VALUES('grant','Business status','send_email','rejected',$1) RETURNING *`,[sentinel])).rows[0];
 await db.query(`INSERT INTO owner_replies(decision_id,body,route,conversation_id) VALUES($1,$2,'session',$3)`,[decision.id,sentinel,thread]);
 const sent=[];let fail=false,migrated=false,stale=null;
 process.env.TELEGRAM_BOT_TOKEN='fixture';process.env.TELEGRAM_OWNER_CHAT_ID='fixture';
 const now=new Date('2026-11-05T18:00:00Z');
 const summary=load('lib/decisions/summary.ts');
 const cards=load('lib/decisions/cards.ts',{'./summary.ts':summary});
 const query=async(sql,args)=>{
  if(stale&&sql.includes('FROM push_outbox')&&sql.includes('WHERE sent_at IS NULL')){const rows=stale;stale=null;return {rows};}
  return db.query(sql,args);
 };
 const push=load('lib/notify-owner.ts',{
  './db':{query,queryOne:async(sql,args)=>!migrated&&sql.includes('ask_push_is_private')?{private:false}:(await query(sql,args)).rows[0]},
  './commands/decisions':{recordDelivery:async()=>{}},'./commands/db':{runDirect:async(sql,args)=>(await db.query(sql,args)).rows},
  './providers/telegram':{makeTelegramProvider:()=>({send:async input=>{if(fail)throw Error('controlled failure');sent.push(input.text);return {responseClass:'accepted',providerRef:'42'};}})},
 });
 const notify=load('lib/decisions/notify.ts',{'@/lib/commands/db':{runDirect:async()=>[{external_ref:'fixture:42'}]},'./cards':cards,'@/lib/notify-owner':{notifyOwner:input=>push.notifyOwner(input,now)}});
 await notify.refreshTelegramCard(decision);fail=true;await notify.refreshTelegramCard(decision);fail=false;
 assert.equal(sent.length,1);assert.ok(sent[0].includes(sentinel));
 assert.equal((await db.query('SELECT count(*)::int n FROM push_outbox WHERE body LIKE $1',['%'+sentinel+'%'])).rows[0].n,2);
 // Old versions omitted decisionId but retained the href, button or edit id.
 for(const [payload,href] of [[{},`/engine/decisions?d=${decision.id}`],[{buttons:[[{text:'Review',data:'decision:'+decision.id}]]},'/today'],[{editMessageId:'legacy42'},'/today']]){
  await db.query(`INSERT INTO push_outbox(kind,title,body,href,payload,send_after) VALUES('decision','Business',$1,$2,$3,now())`,[sentinel,href,JSON.stringify(payload)]);
 }
 await db.query(`INSERT INTO decision_deliveries(decision_id,channel,external_ref,status) VALUES($1,'telegram','fixture:legacy42','sent')`,[decision.id]);
 await apply();migrated=true;
 const assertClean=async c=>{const rows=(await c.query('SELECT * FROM push_outbox')).rows;assert.ok(!JSON.stringify(rows).includes(sentinel));assert.ok(rows.every(r=>r.ask_reply_erased));};
 await assertClean(db);
 for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async c=>{
  assert.equal((await c.query('SELECT session_user AS u')).rows[0].u,login);await assertClean(c);
  assert.equal((await c.query('SELECT ask_push_is_private($1,$2) AS yes',[JSON.stringify({decisionId:decision.id}),'/today'])).rows[0].yes,true);
  await assert.rejects(c.query('SELECT * FROM private_ask_push_sources'),e=>e.code==='42501');
  if(login!=='sjcos_readonly'){await c.query(`INSERT INTO push_outbox(kind,title,body,payload,send_after) VALUES('decision',$1,$1,$2,now())`,[sentinel,JSON.stringify({decisionId:decision.id})]);await assertClean(c);}
 });
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool=poolFor(c);await journal.withAskJournal(pool,async()=>{},options);
  // Restore a pre-cleanup queued body and retain a stale in-memory drain read.
  await c.query('ALTER TABLE push_outbox DISABLE TRIGGER guard_ask_push_copy');
  await c.query(`UPDATE push_outbox SET body=$1,payload=$2,ask_reply_erased=false,sent_at=NULL,send_after=$3`,[sentinel,JSON.stringify({decisionId:decision.id}),now]);
  await c.query('ALTER TABLE push_outbox ENABLE TRIGGER guard_ask_push_copy');
  stale=(await c.query('SELECT * FROM push_outbox')).rows;
  const saved=process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';
  try{await journal.deleteThread(pool,thread,randomUUID(),options,person);}finally{if(saved===undefined)delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;else process.env.SJC_ASK_THREAD_DELETE_ACCEPTED=saved;}
  assert.ok((await c.query('SELECT deleted_at FROM ai_conversations WHERE id=$1',[thread])).rows[0].deleted_at);
  // A restored pre-cleanup database must replay the durable intent again.
  await c.query('ALTER TABLE push_outbox DISABLE TRIGGER guard_ask_push_copy');
  await c.query(`UPDATE push_outbox SET body=$1,payload=$2,ask_reply_erased=false`,[sentinel,JSON.stringify({decisionId:decision.id})]);
  await c.query('ALTER TABLE push_outbox ENABLE TRIGGER guard_ask_push_copy');
  await c.query('UPDATE ask_canvas_maintenance SET checkpoint_sequence=0,checkpoint_hash=NULL,recovery_ready=false');
  await journal.recoverThreads(pool,options);await assertClean(c);
  await c.query('UPDATE push_outbox SET body=$1,payload=$2',[sentinel,JSON.stringify({decisionId:decision.id})]);await assertClean(c);
  sent.length=0;await push.runPushDrain({now});assert.ok(sent.length>0);assert.ok(sent.every(text=>!text.includes(sentinel)));
  // Website owner guard remains in force after all the recovery calls.
  for(const login of ['sjcos_agent','sjcos_worker','sjcos_readonly'])await withSessionIdentity(url,login,async n=>{
   if(login!=='sjcos_readonly')await n.query(`INSERT INTO push_outbox(kind,title,body,payload,send_after) VALUES('decision',$1,$1,$2,now())`,[sentinel,JSON.stringify({decisionId:decision.id})]);
   if(login==='sjcos_worker')await n.query('UPDATE push_outbox SET ask_reply_erased=false,body=$1',[sentinel]);
   await assertClean(n);
  });
 });
})));

test('unsafe folder diagnosis is owner-only; maintenance shares it; repair preserves evidence',()=>withMigrationSubset('r4_health',[100,105],async({url,apply})=>environment(async options=>{
 await apply();await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool=poolFor(c);let callbacks=0,role='owner';
  const status=load('app/api/ai/status/route.ts',{'@/lib/dal':{getCurrentUser:async()=>role?{role}:null},'@/lib/db':{pool},'@/lib/ask-health.mjs':health,'@/lib/ask-thread-journal.mjs':{...journal,withAskJournal:(p,fn)=>journal.withAskJournal(p,fn,options)}});
  const admission=()=>journal.withAskJournal(pool,async()=>{callbacks++;},options);
  await admission();const identity=await readFile(path.join(options.deploymentDir,'identity.json'),'utf8');
  for(const [dir,code] of [[options.dir,'JOURNAL_PERMISSIONS'],[options.deploymentDir,'JOURNAL_DEPLOYMENT_PERMISSIONS']]){
   await chmod(dir,0o775);await assert.rejects(admission,e=>e.message===journal.PAUSED);assert.equal(callbacks,1);
   let res=await status.GET();assert.equal(res.status,503);let json=await res.json();assert.equal(json.code,'ASK_PAUSED');assert.equal(json.diagnosis.code,code);assert.ok(!JSON.stringify(json).includes(options.root));
   for(const [who,http] of [[null,401],['staff',403]]){role=who;res=await status.GET();assert.equal(res.status,http);assert.equal((await res.json()).diagnosis,undefined);}role='owner';
   await assert.rejects(journal.maintainThreads(pool,options));assert.equal((await c.query('SELECT health_code FROM ask_canvas_maintenance')).rows[0].health_code,code);
   await chmod(dir,0o700);assert.equal((await status.GET()).status,200);
  }
  assert.equal(await readFile(path.join(options.deploymentDir,'identity.json'),'utf8'),identity);
  // Symlink and ownership checks are exercised without touching host ownership.
  for(const [dir,code] of [[options.dir,'JOURNAL_PERMISSIONS'],[options.deploymentDir,'JOURNAL_DEPLOYMENT_PERMISSIONS']]){
   const link=dir+'-link';await symlink(dir,link);const altered={...options,[dir===options.dir?'dir':'deploymentDir']:link};
   await assert.rejects(journal.withAskJournal(pool,()=>assert.fail('unsafe callback'),altered));
   assert.equal((await c.query('SELECT health_code FROM ask_canvas_maintenance')).rows[0].health_code,code);
  }
  const realUid=process.getuid;process.getuid=()=>realUid()+1;
  try{await assert.rejects(admission);assert.equal((await c.query('SELECT health_code FROM ask_canvas_maintenance')).rows[0].health_code,'JOURNAL_PERMISSIONS');}finally{process.getuid=realUid;}
  const maintenance=load('app/api/internal/canvas-maintenance/route.ts',{'@/lib/db':{pool},'@/lib/ask-health.mjs':health,'@/lib/ask-thread-journal.mjs':{maintainThreads:()=>journal.maintainThreads(pool,{...options,dir:options.dir+'-link'})},'@/lib/obligations/work-items':{refreshSourcedWorkItem:async(_run,input)=>{assert.match(input.body,/JOURNAL_PERMISSIONS/);assert.match(input.body,/chmod 700/);assert.ok(!input.body.includes(options.root));callbacks++;}}});
  process.env.CRON_SECRET='fixture';assert.equal((await maintenance.POST(new Request('http://local',{method:'POST',headers:{authorization:'Bearer fixture'}}))).status,503);assert.equal(callbacks,2);
  for(const code of ['JOURNAL_AUTHORITY_IDENTITY','JOURNAL_BINDING','JOURNAL_INVALID'])assert.equal(health.askHealthCause(Error(code)),code);
 });
})));
