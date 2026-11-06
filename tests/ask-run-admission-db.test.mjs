import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withSessionIdentity,withMigrationSubset} from './_harness/testdb.mjs';
import {seedPeople} from './phase0a-fixtures.mjs';
test('0100 actual login guards preserve background retry and reject forged panel identity (20 attacks)',async()=>withMigrationSubset('admission_0100',[100],async({url,db:c,apply})=>{
 await apply();
 const {owner,staff,thread}=await seedPeople(c);
 const panel=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source) VALUES('panel','operator',$1,$2,'panel_web') RETURNING id`,[owner.id,thread])).rows[0].id;
 for(const role of ['sjcos_agent','sjcos_worker'])await withSessionIdentity(url,role,async(db)=>{
  const identity=(await db.query('SELECT session_user,current_user')).rows[0]; assert.deepEqual(identity,{session_user:role,current_user:role});
  let bg;
  if(role==='sjcos_worker'){ bg=(await db.query(`INSERT INTO dev_agent_runs(prompt,launch_source) VALUES('background','background') RETURNING id`)).rows[0].id; await db.query(`UPDATE dev_agent_runs SET status='running',activity='retry' WHERE id=$1`,[bg]); } else { bg=panel; await assert.rejects(db.query(`INSERT INTO dev_agent_runs(prompt,launch_source) VALUES('background','background')`),e=>e.code==='42501'); }
  const attacks=[
   [`INSERT INTO dev_agent_runs(prompt,launch_source) VALUES('forged','panel_web')`,[]],
   [`INSERT INTO dev_agent_runs(prompt,launch_source) VALUES('legacy forged','legacy')`,[]],
   [`INSERT INTO dev_agent_runs(prompt,launch_source,principal_user_id) VALUES('forged','background',$1)`,[staff.id]],
   [`INSERT INTO dev_agent_runs(prompt,launch_source,conversation_id) VALUES('forged','background',$1)`,[thread]],
   [`INSERT INTO dev_agent_runs(prompt,launch_source,profile) VALUES('forged','background','operator')`,[]],
   [`UPDATE dev_agent_runs SET launch_source='panel_web' WHERE id=$1`,[bg]],
   [`UPDATE dev_agent_runs SET principal_user_id=$2 WHERE id=$1`,[bg,owner.id]],
   [`UPDATE dev_agent_runs SET created_at=now()+interval '1 day' WHERE id=$1`,[bg]],
   [`UPDATE dev_agent_runs SET session_id='hijack' WHERE id=$1`,[panel]],
   [`DELETE FROM dev_agent_runs WHERE id=$1`,[panel]],
  ];
  for(const [sql,args] of attacks){ await db.query(`SELECT set_config('sjcos.website_login','${role}',false)`); await assert.rejects(db.query(sql,args),e=>e.code==='42501'); }
 });
 await withSessionIdentity(url,'sjcos_test_website',async(db)=>{
  assert.deepEqual((await db.query('SELECT session_user,current_user')).rows[0],{session_user:'sjcos_test_website',current_user:'sjcos_test_website'});
  await db.query(`INSERT INTO dev_agent_runs(prompt,launch_source,profile,principal_user_id,conversation_id) VALUES('trusted','panel_mobile','business',$1,$2)`,[staff.id,thread]);
  await assert.rejects(db.query(`UPDATE dev_agent_runs SET launch_source='background' WHERE id=$1`,[panel]),e=>e.code==='42501');
  await assert.rejects(db.query(`INSERT INTO dev_agent_runs(prompt,launch_source,profile,principal_user_id,conversation_id) VALUES('staff escalation','panel_web','operator',$1,$2)`,[staff.id,thread]));
 });
}));

test('admitAskRun checks authentication, source, 0105 seam, profile, resume and continuation before insertion',async()=>withMigrationSubset('admission_seam',[100,105],async({url,db:c,apply})=>{
 await apply([100]);
 const {appHooks}=await import('./phase0a-fixtures.mjs');appHooks();
 const {registerHooks}=await import('node:module');
 registerHooks({resolve(s,c,n){if(s==='@/lib/ask-thread-journal.mjs')return {url:'fixture:admission-journal',shortCircuit:true};return n(s,c);},load(u,c,n){if(u==='fixture:admission-journal')return {format:'module',source:`export const deletionCapabilities=async()=>({deleteAvailable:false}); export const deleteThread=()=>{throw Error('unused deletion fixture')}; export async function withAskJournal(pool,fn){const r=await pool.query("SELECT to_regclass('ask_canvas_maintenance') AS name");if(!r.rows[0].name)throw Error('ASK_THREAD_PRIVACY_REQUIRED');return fn();}`,shortCircuit:true};return n(u,c);}});
 process.env.SESSION_SECRET='phase0a-test-secret-for-admission-32-or-more';
 const {admitAskRun}=await import('../lib/ask-run-admission.ts');
 const {encrypt}=await import('../lib/session.ts');
 const {owner,staff,noAi,thread}=await seedPeople(c);
 let token;globalThis.__phase0aCookies={get:()=>token?{value:token}:undefined};
 await withSessionIdentity(url,'sjcos_test_website',async(db)=>{
  globalThis.__phase0aDb=db;
  const input={conversationId:thread,prompt:'admission fixture',withMcp:false};
  await assert.rejects(admitAskRun(input,'background'),/ASK_INVALID_SOURCE/);
  await assert.rejects(admitAskRun(input,'panel_web'),/ASK_SIGN_IN_REQUIRED/);
  token=await encrypt({userId:owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});
  await assert.rejects(admitAskRun(input,'panel_web'),/ASK_THREAD_PRIVACY_REQUIRED/);
  // Real 0105 via isolated checksummed ledger; recovery is a test-only ready
  // fixture here. Full independent recovery is tested separately.
  await c.query('SET SESSION AUTHORIZATION sjcos_test_website');
  try { await apply([105]); } finally { await c.query('RESET SESSION AUTHORIZATION'); }
  await withSessionIdentity(url,'sjcos_test_website',async()=>{});
  await db.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
  for(const source of ['panel_web','panel_mobile','panel_voice']){
   const run=await admitAskRun(input,source);assert.equal(run.profile,'operator');
   const row=(await db.query('SELECT launch_source,with_mcp FROM dev_agent_runs WHERE id=$1',[run.id])).rows[0];assert.equal(row.launch_source,source);assert.equal(row.with_mcp,false);
  }
  await assert.rejects(admitAskRun({...input,resumeSessionId:'someone-elses-session'},'panel_web'),/ASK_RESUME_MISMATCH/);
  await assert.rejects(admitAskRun({...input,requestedProfile:'browser'},'panel_web'),/BROWSER_DISABLED/);
  const parent=await admitAskRun(input,'panel_web');
  const child=await admitAskRun({...input,continuationOfRunId:parent.id},'panel_web');assert.ok(child.id);
  await assert.rejects(db.query('UPDATE dev_agent_runs SET principal_user_id=$2 WHERE id=$1',[parent.id,staff.id]),e=>e.code==='42501');
  const background=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,launch_source) VALUES('background parent','business','background') RETURNING id`)).rows[0].id;
  await assert.rejects(admitAskRun({...input,continuationOfRunId:background},'panel_web'),/invalid human turn continuation/);
  await assert.rejects(admitAskRun({...input,continuationOfRunId:parent.id},'panel_mobile'),/invalid human turn continuation/);
  await db.query(`UPDATE dev_agent_runs SET status='done' WHERE id=$1`,[parent.id]);
  await assert.rejects(admitAskRun({...input,continuationOfRunId:parent.id},'panel_web'),/invalid human turn continuation/);
  token=await encrypt({userId:staff.id,role:'staff',authAt:Math.floor(Date.now()/1000)});
  await assert.rejects(admitAskRun(input,'panel_web'),/ASK_THREAD_UNAVAILABLE/);
  input.conversationId=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','Staff admission fixture',$1) RETURNING id`,[staff.id])).rows[0].id;
  assert.equal((await admitAskRun({...input,requestedProfile:'operator'},'panel_web')).profile,'business');
  await db.query("SELECT set_config('sjcos.ask_purge','yes',false)");
  await db.query("UPDATE ai_conversations SET deleted_at=now(),purge_after=now()+interval '720 hours',deletion_sequence=1 WHERE id=$1",[input.conversationId]);
  await db.query("SELECT set_config('sjcos.ask_purge','',false)");await assert.rejects(admitAskRun(input,'panel_web'),/ASK_THREAD_UNAVAILABLE/);
  token=await encrypt({userId:noAi.id,role:'staff',authAt:Math.floor(Date.now()/1000)});await assert.rejects(admitAskRun(input,'panel_web'),/ASK_ACCESS_DENIED/);
  token=await encrypt({userId:owner.id,role:'owner',authAt:Math.floor(Date.now()/1000)});
  await db.query(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`,[owner.id]);await assert.rejects(admitAskRun(input,'panel_web'),/ASK_ACCESS_DENIED/);
 });
}));

test('real startClaudeRun under worker login drops inherited person/thread and keeps MCP-off without spawning a process',async()=>withTestDb(async(url,c)=>{
 const {readFileSync}=await import('node:fs'); const {createRequire}=await import('node:module');const {runInNewContext}=await import('node:vm');const ts=(await import('typescript')).default;
 const require=createRequire(import.meta.url);const profiles=await import('../lib/authority/run-profile.mjs');
 const {owner,thread}=await seedPeople(c);
 const item=(await c.query(`INSERT INTO work_items(title) VALUES('ZZ background admission') RETURNING id`)).rows[0].id;
 await withSessionIdentity(url,'sjcos_worker',async(db)=>{
  const spawned=[];const exports={};
  const stubs={
   'server-only':{},'node:child_process':{execFile(){},spawn(...args){spawned.push(args);return {unref(){}};}},
   '@/lib/db':{query:(...args)=>db.query(...args),queryOne:async(...args)=>(await db.query(...args)).rows[0]??null},
   '@/lib/dev-agents-meta':{CLAUDE_DEFAULTS:{model:'opus',context:'default',mode:'plan',effort:'default',withMcp:true},claudeModelArg:()=> 'opus'},
   '@/lib/authority/run-profile.mjs':profiles,
   '@/lib/authority/usage':{admitRun:async(_run,profile)=>{assert.equal(profile,'business');return {ok:true,warning:null};}},
   '@/lib/dal':{getCurrentUser(){throw new Error('background must not inspect request identity');}},
  };
  const code=ts.transpileModule(readFileSync(new URL('../lib/dev-agents.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  runInNewContext(code,{exports,process,console,require:s=>Object.hasOwn(stubs,s)?stubs[s]:s.startsWith('node:')?require(s):{}});
  const id=await exports.startClaudeRun('Background fixture',undefined,thread,{withMcp:false},item,{verifiedOwner:{...owner,role:'owner'},profile:'operator'});
  const row=(await db.query('SELECT conversation_id,principal_user_id,profile,launch_source,with_mcp,subject_work_item_id FROM dev_agent_runs WHERE id=$1',[id])).rows[0];
  assert.deepEqual(row,{conversation_id:null,principal_user_id:null,profile:'business',launch_source:'background',with_mcp:false,subject_work_item_id:item});assert.equal(spawned.length,1);
 });
},{fresh:true}));

test('0100 standalone upgrade backfills existing rows to legacy and defaults new rows to background',async()=>withMigrationSubset('standalone_upgrade',[100],async({db:c,apply})=>{
 await apply();
 const {readFileSync}=await import('node:fs');
 // Reconstruct the pre-0100 surface in this isolated database only; never
 // edit/skip a migration ledger entry or depend on 0105 ownership columns.
 const tables=['browser_commands','browser_web_commands','browser_owner_views','browser_read_uses','browser_read_manifests','browser_viewers','browser_task_runs','browser_audit','browser_audit_heads','browser_audit_checkpoints','browser_maintenance_jobs','browser_tasks','web_sessions'];
 await c.query('DROP TRIGGER guard_ask_run_identity ON dev_agent_runs; DROP TRIGGER revoke_user_web_sessions ON session_revocations');
 for(const table of tables)await c.query(`DROP TABLE ${table} CASCADE`);
 await c.query('ALTER TABLE dev_agent_runs DROP COLUMN browser_task_id CASCADE; ALTER TABLE dev_agent_runs DROP COLUMN continuation_of_run_id CASCADE; ALTER TABLE dev_agent_runs DROP COLUMN launch_source CASCADE');
 const old=(await c.query(`INSERT INTO dev_agent_runs(prompt) VALUES('ZZ before migration') RETURNING id`)).rows[0].id;
 const sql=readFileSync(new URL('../db/migrations/0100_ask_launch_sessions_browser_core.sql',import.meta.url),'utf8');
 await c.query('BEGIN');try{await c.query(sql);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}
 assert.equal((await c.query('SELECT launch_source FROM dev_agent_runs WHERE id=$1',[old])).rows[0].launch_source,'legacy');
 assert.equal((await c.query(`INSERT INTO dev_agent_runs(prompt) VALUES('ZZ after migration') RETURNING launch_source`)).rows[0].launch_source,'background');
 for(const table of tables)assert.equal((await c.query('SELECT to_regclass($1) AS table',[table])).rows[0].table,table);
 assert.equal((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='ai_conversations' AND column_name IN ('owner_user_id','deleted_at')`)).rows[0].n,0);
}));
