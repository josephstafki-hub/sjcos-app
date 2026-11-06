import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestDb, withSessionIdentity } from './_harness/testdb.mjs';
// Expectations: private ownership applies equally to Joe and staff; actual
// login identity, never caller GUCs, separates the website and narrow roles.
test('0105 ownership, retained identity and narrow-role adversarial matrix', async t => {
 await withTestDb(async (url, db) => {
  const people=[];
  for(const role of ['owner','staff','staff','client','sub']) people.push((await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Private test',$2,ARRAY['ai'],'x','PT') RETURNING id`,[`${crypto.randomUUID()}@example.test`,role])).rows[0].id);
  const thread=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','secret',$1) RETURNING id`,[people[1]])).rows[0].id;
  await db.query(`UPDATE ask_canvas_maintenance SET recovery_ready=true WHERE singleton`);
  for(const identity of ['sjcos_agent','sjcos_worker']) {
   for(const [label,sql,args] of [
    ['forge thread',`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1)`,[people[0]]],
    ['reassign owner',`UPDATE ai_conversations SET owner_user_id=$1 WHERE id=$2`,[people[0],thread]],
    ['change session',`UPDATE ai_conversations SET claude_session_id='stolen' WHERE id=$1`,[thread]],
    ['delete retained',`DELETE FROM ai_conversations WHERE id=$1`,[thread]],
    ['forge panel',`INSERT INTO dev_agent_runs(agent,prompt,launch_source,profile,principal_user_id,conversation_id) VALUES('claude','attack','panel_web','business',$1,$2)`,[people[1],thread]],
    ['append private',`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','attack')`,[thread]],
   ]) await t.test(`${identity}: ${label}`,()=>withSessionIdentity(url,identity,async(c,proof)=>{
    assert.deepEqual(proof,{session_user:identity,current_user:identity});
    await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[1]]);
    // RLS may silently hide rows on UPDATE/DELETE; either denial is acceptable.
    try { const r=await c.query(sql,args); assert.equal(r.rowCount,0); } catch(e){assert.match(e.code??'',/42501|P0001/);}
   }));
  }
  for(const who of [0,1,2,3,4]) await t.test(`website actor ${who} sees only self`,()=>withSessionIdentity(url,'sjcos_test_website',async c=>{
   await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[people[who]]);
   const rows=(await c.query(`SELECT id FROM ai_conversations WHERE id=$1`,[thread])).rows;
   assert.equal(rows.length,who===1?1:0);
  }));
  await t.test('owner immutable even to website',()=>withSessionIdentity(url,'sjcos_test_website',async c=>{
   await assert.rejects(c.query(`UPDATE ai_conversations SET owner_user_id=$1 WHERE id=$2`,[people[0],thread]),/immutable/);
  }));
  for(const identity of ['sjcos_agent','sjcos_worker']) await t.test(`${identity}: background runtime still works`,()=>withSessionIdentity(url,identity,async c=>{
   // Agent's existing manifest intentionally has no run INSERT grant.
   if(identity==='sjcos_agent'){await assert.rejects(c.query(`INSERT INTO dev_agent_runs(agent,prompt,profile,launch_source) VALUES('claude','background','business','background')`),/permission denied/);return;}
   const id=(await c.query(`INSERT INTO dev_agent_runs(agent,prompt,profile,launch_source) VALUES('claude','background','business','background') RETURNING id`)).rows[0].id;
   await c.query(`UPDATE dev_agent_runs SET status='running',activity='retry' WHERE id=$1`,[id]);
   await assert.rejects(c.query(`UPDATE dev_agent_runs SET conversation_id=$1 WHERE id=$2`,[thread,id]),/immutable|denied/);
  }));
 },{fresh:true});
});

test('shared helper: current verified identity, quarantine, revocation, folders, context and journal gate',async t=>{
 const {readFileSync}=await import('node:fs');const {createRequire}=await import('node:module');const {runInNewContext}=await import('node:vm');const ts=await import('typescript');const require=createRequire(import.meta.url);
 await withTestDb(async(url,db)=>{
  const people=[];for(const role of ['owner','staff','staff','client','sub'])people.push((await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Shared access',$2,ARRAY['ai'],'x','SA') RETURNING id`,[`${crypto.randomUUID()}@example.test`,role])).rows[0].id);
  const ids=[];for(const id of [...people,null])ids.push((await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','private',$1) RETURNING id`,[id])).rows[0].id);
  await withSessionIdentity(url,'sjcos_test_website',async c=>{
   await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
   let session={userId:people[1],authAt:Math.floor(Date.now()/1000)},blocked=false;
   const exports={},pool={query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})};
   const code=ts.default.transpileModule(readFileSync(new URL('../lib/thread-access.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.default.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
   const pure={};runInNewContext(ts.default.transpileModule(readFileSync(new URL('../lib/ask-result-codes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.default.ModuleKind.CommonJS}}).outputText,{exports:pure,URL});
   const stubs={'@/lib/ask-result-codes':pure,'server-only':{},'@/lib/db':{pool},'@/lib/session':{readSession:async()=>session},'@/lib/ask-thread-journal.mjs':{withAskJournal:async(_pool,fn)=>{if(blocked)throw Error('RECOVERY_REQUIRED');return fn();}}};
   runInNewContext(code,{exports,Buffer,process,require:s=>s in stubs?stubs[s]:require(s)});
   for(const [who,label] of [[0,'Joe'],[1,'staff A'],[2,'staff B']])await t.test(`${label}: self only for load/context and forged principal`,async()=>{
    session={...session,userId:people[who]};
    for(let i=0;i<ids.length;i++){
     if(i===who)assert.equal((await exports.requireThreadAccess(ids[i])).id,ids[i]);
     else await assert.rejects(exports.requireThreadAccess(ids[i]),/UNAVAILABLE/);
    }
    await assert.rejects(exports.requireThreadAccess(ids[who],{id:people[(who+1)%3]}),/ACCESS_DENIED/);
   });
   for(const who of [3,4])await t.test(`portal ${who} cannot use thread helper`,async()=>{session={...session,userId:people[who]};await assert.rejects(exports.requireThreadAccess(ids[who]),/ACCESS_DENIED/);});
   session={...session,userId:people[1]};
   await t.test('inactive and revoked authenticated person refused',async()=>{
    await c.query('UPDATE users SET active=false WHERE id=$1',[people[1]]);await assert.rejects(exports.requireThreadAccess(ids[1]),/SESSION_REVOKED/);await c.query('UPDATE users SET active=true WHERE id=$1',[people[1]]);
    await c.query(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`,[people[1]]);await assert.rejects(exports.requireThreadAccess(ids[1]),/SESSION_REVOKED/);session.authAt+=10;
   });
   await t.test('all private reads/writes stop before query when journal gate closes',async()=>{blocked=true;await assert.rejects(exports.threadQuery('SELECT * FROM ai_messages'),/RECOVERY_REQUIRED/);await assert.rejects(exports.threadQuery(`UPDATE ai_conversations SET title='overwrite'`),/RECOVERY_REQUIRED/);blocked=false;});
   await t.test('same entity folder names/counts do not share threads between people',async()=>{
    const a=(await c.query(`INSERT INTO ai_folders(name,entity_kind,entity_id,owner_user_id) VALUES('private A','project','same-job',$1) RETURNING id`,[people[1]])).rows[0].id;
    const b=(await c.query(`INSERT INTO ai_folders(name,entity_kind,entity_id,owner_user_id) VALUES('private B','project','same-job',$1) RETURNING id`,[people[2]])).rows[0].id;
    await assert.rejects(c.query('UPDATE ai_conversations SET folder_id=$1 WHERE id=$2',[b,ids[1]]),/mismatch/);
    await c.query('UPDATE ai_conversations SET folder_id=$1 WHERE id=$2',[a,ids[1]]);
    const folders=(await exports.threadQuery('SELECT name FROM ai_folders WHERE entity_id=$1',['same-job'])).rows;assert.deepEqual(folders.map(r=>r.name),['private A']);
    assert.equal((await exports.threadQuery('SELECT count(*)::int AS n FROM ai_conversations WHERE folder_id=$1',[b])).rows[0].n,0);
   });
   await t.test('attachment bytes are fenced for live ownership, foreign paths and deleted references',async()=>{
    const path=await import('node:path');const root=path.join(process.cwd(),'uploads','ai-chat');
    const file=path.join(root,people[1],`${Date.now()}-upload.txt`);
    assert.equal(await exports.withThreadAttachmentAccess(file,async()=>'fresh bytes'),'fresh bytes');
    await assert.rejects(exports.withThreadAttachmentAccess(path.join(root,people[2],`${Date.now()}-foreign.txt`),async()=>assert.fail('foreign byte read')),/UNAVAILABLE/);
    await c.query(`INSERT INTO ai_messages(conversation_id,role,body,attachments) VALUES($1,'user','file',$2::jsonb)`,[ids[1],JSON.stringify([{path:file}])]);
    assert.equal(await exports.withThreadAttachmentAccess(file,async()=>'owned bytes'),'owned bytes');
    await c.query("SELECT set_config('sjcos.ask_purge','yes',false)");
    await c.query("UPDATE ai_conversations SET deleted_at=now(),purge_after=now()+interval '720 hours',deletion_sequence=1 WHERE id=$1",[ids[1]]);
    await c.query("SELECT set_config('sjcos.ask_purge','',false)");
    await assert.rejects(exports.withThreadAttachmentAccess(file,async()=>assert.fail('deleted byte read')),/UNAVAILABLE/);
    // This fixture's later run checks use another owned live thread.
    ids[1]=(await c.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','continued fixture',$1) RETURNING id`,[people[1]])).rows[0].id;
   });
   await t.test('DB admits only same-person panel thread; resume identity cannot be reassigned',async()=>{
    await assert.rejects(c.query(`INSERT INTO dev_agent_runs(prompt,profile,launch_source,principal_user_id,conversation_id) VALUES('attack','business','panel_mobile',$1,$2)`,[people[1],ids[2]]),/mismatch/);
    const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,profile,launch_source,principal_user_id,conversation_id) VALUES('ok','business','panel_voice',$1,$2) RETURNING id`,[people[1],ids[1]])).rows[0].id;
    assert.equal((await exports.requireRunThreadAccess(run)).id,people[1]);
    session.userId=people[0];await assert.rejects(exports.requireRunThreadAccess(run),/UNAVAILABLE/);
   });
  });
 },{fresh:true});
});

test('owner reply delivery fences the title before routing or relaying another person’s thread (§8.1)',async()=>{
 const {readFileSync}=await import('node:fs');const {runInNewContext}=await import('node:vm');const {createRequire}=await import('node:module');const ts=(await import('typescript')).default;const require=createRequire(import.meta.url);
 let denied=0,routed=0,privateReads=0;
 const query=async(sql)=>{if(/ai_conversations|dev_agent_runs/.test(sql))privateReads++;return {rows:[]};};
 const run=async()=>[];
 const stubs={
  'server-only':{},'@/lib/db':{query,queryOne:async(sql)=>{await query(sql);return null;}},
  '@/lib/ask-thread-journal.mjs':{withAskJournal:async(_pool,fn)=>fn()},
  '@/lib/ask-private-bridge.mjs':{privatePerson:()=>null},
  '@/lib/thread-access':{askFailure:()=>({ok:false,code:'THREAD_UNAVAILABLE'}),threadPrincipal:async()=>({id:'joe',role:'owner'}),requireThreadAccess:async()=>{denied++;throw Error('ASK_THREAD_UNAVAILABLE');},threadQueryOne:async()=>{privateReads++;throw Error('must not reach private read');}},
  '@/lib/commands/db':{runDirect:run,withTransaction:async fn=>fn(run)},
  '@/lib/providers/telegram':{defaultTransport:{}},'@/lib/providers/types':{outboundDisabled:()=>true},
  '@/lib/run-steers':{enqueueSteer:async()=>{routed++;}},'@/lib/dev-agents':{pingConversation:async()=>{routed++;}},
  '@/lib/agent-runtime/triggers':{enqueueAgentTrigger:async()=>({trigger:{id:'background'}})},
  '@/lib/decisions/owner-replies':{draftReplyHow:()=>'',rememberReplyTarget:async()=>{}},'@/lib/grant-detail':{},
 };
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/owner-reply-delivery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process,console:{error(){}},require:s=>s in stubs?stubs[s]:require(s)});
 await exports.deliverOwnerReply({id:'reply',route:'session',conversationId:'staff-private',title:'Shared decision',chatId:'owner',messageId:1},'Please revise');
 assert.equal(denied,1);assert.equal(privateReads,0);assert.equal(routed,0);
});
