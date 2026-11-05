import test from 'node:test';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withMigrationSubset,withSessionIdentity,startCluster,dbUrl,assertNotProduction} from './_harness/testdb.mjs';
import {withLedgerLock,readLocal,appendLocal,makeIntent,validateChain,ZERO,synchronizeLedger} from '../lib/canvas-deletion-ledger.mjs';
import {recoverThreads,deleteThread,maintainThreads,acquireLease,checkLease,withAskJournal} from '../lib/ask-thread-journal.mjs';
// Independent durable store fixture: separate directory, live current reads and
// compare-and-swap. Fault injection changes availability/receipts, not ledger rows.
async function fixture(fn){
 const dir=await mkdtemp(path.join(tmpdir(),'sjc-journal-')),remote=await mkdtemp(path.join(tmpdir(),'sjc-authority-'));
 const id=randomUUID();const file=path.join(remote,'current.json');let failed=false,corrupt=false,wrong=false,stale=false,race=false;
 await writeFile(file,JSON.stringify([]),{mode:0o600});
 const authority={id,async read(){if(failed)throw Error('authority unavailable');const all=JSON.parse(await readFile(file,'utf8'));const head=validateChain(all);return {ledger_id:wrong?randomUUID():id,...head,entries:corrupt?[{bad:true}]:stale?all.slice(0,-1):all,...(race?{sequence:head.sequence+1}:{})};},async advance(expected,entries){
  if(failed)throw Error('authority unavailable');const all=JSON.parse(await readFile(file,'utf8'));assert.deepEqual({sequence:expected.sequence,head_hash:expected.head_hash},validateChain(all));
  validateChain(entries);const f=await open(file,'w');try{await f.writeFile(JSON.stringify(entries));await f.sync();}finally{await f.close();}
  return this.read();
 }};
 try{return await fn({dir,authority,fault:(name,value=true)=>{({failed:v=>failed=v,corrupt:v=>corrupt=v,wrong:v=>wrong=v,stale:v=>stale=v,race:v=>race=v})[name](value);}});}finally{await rm(dir,{recursive:true,force:true});await rm(remote,{recursive:true,force:true});}
}
for(const [name,ids] of [['combined',[100,101,102,103,104,105]],['canvas_only',[100,105]]])test(`thread-only recovery ${name}`,async t=>withMigrationSubset(`recovery_${name}`,ids,async({url,db,apply})=>{
 await apply();process.env.SJC_CANVAS_ENABLED='0';process.env.SJC_ASK_THREAD_DELETE_ACCEPTED='1';
 const person=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Journal','owner','x','J') RETURNING id`,[`${randomUUID()}@example.test`])).rows[0].id;
 const thread=async(c)=> (await c.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','private title',$1) RETURNING id`,[person])).rows[0].id;
 await fixture(async options=>{
  await withSessionIdentity(url,'sjcos_test_website',async c=>{
   const pool={query:(...args)=>c.query(...args)};
   const recover=()=>withLedgerLock(options.dir,()=>recoverThreads(pool,options));
   await t.test('startup requires current independent authority even with flags off',async()=>{
    options.fault('failed');await assert.rejects(recover(),/unavailable/);assert.equal((await c.query('SELECT recovery_ready FROM ask_canvas_maintenance')).rows[0].recovery_ready,false);options.fault('failed',false);await recover();
   });
   const id=await thread(c);
   await t.test('raw physical delete of live/retained thread refused',()=>assert.rejects(c.query('DELETE FROM ai_conversations WHERE id=$1',[id]),/retained/));
   await c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','private source')`,[id]);
   const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,conversation_id,principal_user_id,launch_source,profile) VALUES('private',$1,$2,'panel_web','operator') RETURNING id`,[id,person])).rows[0].id;
   const op=randomUUID();
   const backup=execFileSync('/usr/lib/postgresql/16/bin/pg_dump',[url,'--no-owner','--no-privileges'],{maxBuffer:32*1024*1024});
   await t.test('failed replication installs durable fence, refuses acknowledgement and late write',async()=>{
    options.fault('failed');
    // Crash boundary: intent fsynced before independent store responds.
    await withLedgerLock(options.dir,async()=>{await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=false');await appendLocal(options.dir,makeIntent(await readLocal(options.dir),id,op));});
    await assert.rejects(recover(),/unavailable/);
    await assert.rejects(c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'assistant','late')`,[id]),/fence/);
    options.fault('failed',false);
   });
   await t.test('crash replay independently commits intent and cancels in-flight run',async()=>{
    await recover();assert.equal((await c.query('SELECT cancellation_requested FROM dev_agent_runs WHERE id=$1',[run])).rows[0].cancellation_requested,true);
    assert.equal((await c.query('SELECT status FROM dev_agent_runs WHERE id=$1',[run])).rows[0].status,'error');
    assert.ok((await c.query('SELECT deleted_at FROM ai_conversations WHERE id=$1',[id])).rows[0].deleted_at);
    await assert.rejects(c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'assistant','late')`,[id]),/fence/);
   });
   await t.test('operation UUID retry returns same committed sequence',async()=>{
    await deleteThread(pool,id,op,options);assert.equal((await readLocal(options.dir)).length,1);
   });
   await t.test('real pre-delete pg_dump restore replays current independent high-water before access',async()=>{
    const state=startCluster(),nameRestored=`sjcos_restore_${name}`,restored=dbUrl(url,nameRestored);assertNotProduction(restored);
    const admin=new pg.Client({connectionString:state.admin});await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${nameRestored} WITH (FORCE)`);await admin.query(`CREATE DATABASE ${nameRestored}`);await admin.end();
    execFileSync('/usr/lib/postgresql/16/bin/psql',[restored,'-X','-q','-v','ON_ERROR_STOP=1'],{input:backup,stdio:['pipe','ignore','pipe'],maxBuffer:2*1024*1024});
    await withSessionIdentity(restored,'sjcos_test_website',async restoredDb=>{
     const restoredPool={query:(...args)=>restoredDb.query(...args)};
     assert.equal((await restoredDb.query('SELECT deleted_at FROM ai_conversations WHERE id=$1',[id])).rows[0].deleted_at,null);
     await withLedgerLock(options.dir,()=>recoverThreads(restoredPool,options));
     assert.ok((await restoredDb.query('SELECT deleted_at FROM ai_conversations WHERE id=$1',[id])).rows[0].deleted_at);
     assert.equal((await restoredDb.query('SELECT checkpoint_sequence::int AS n FROM ask_canvas_maintenance')).rows[0].n,1);
    });
   });
   await t.test('lost primary operations volume reconstructs independently acknowledged chain',async()=>{
    await rm(options.dir,{recursive:true,force:true});await recover();assert.equal((await readLocal(options.dir)).length,1);
   });
   await t.test('a local journal from a different ledger is refused before authority advancement',async()=>{
    const file=path.join(options.dir,'ledger-id');await writeFile(file,randomUUID()+'\n');
    await assert.rejects(recover(),/IDENTITY/);await writeFile(file,options.authority.id+'\n');await recover();
   });
   await t.test('intact N-1 prefix cannot reopen at live high-water N',async()=>{
    options.fault('stale');await assert.rejects(recover(),/PREFIX|INVALID/);options.fault('stale',false);await recover();
   });
   for(const fault of ['wrong','corrupt','race'])await t.test(`${fault} authority fails closed`,async()=>{options.fault(fault);await assert.rejects(recover());assert.equal((await c.query('SELECT recovery_ready FROM ask_canvas_maintenance')).rows[0].recovery_ready,false);options.fault(fault,false);await recover();});
   await t.test('lease CAS excludes competitors and rejects expired token',async()=>{
    const a=await acquireLease(pool);await assert.rejects(acquireLease(pool),/BUSY/);
    await c.query(`UPDATE ask_canvas_maintenance SET lease_expires_at=now()-interval '1 second'`);const b=await acquireLease(pool);
    await assert.rejects(checkLease(c,a),/STALE/);await checkLease(c,b);await c.query('UPDATE ask_canvas_maintenance SET lease_expires_at=NULL');await recover();
   });
   await t.test('partial local append tail is bounded and recovered; complete corruption refused',async()=>{
    const f=await open(path.join(options.dir,'intents.jsonl'),'a');await f.writeFile('{partial');await f.close();await recover();assert.equal((await readLocal(options.dir)).length,1);
    const original=await readFile(path.join(options.dir,'intents.jsonl'));await writeFile(path.join(options.dir,'intents.jsonl'),'{bad}\n');await assert.rejects(recover());await writeFile(path.join(options.dir,'intents.jsonl'),original);await recover();
   });
   await t.test('grace and hold protect payload, release purges to audit shells',async()=>{
    // A real dated intent, never forged migration rows or grace bypass.
    const old=await thread(c);
    const oldRun=(await c.query(`INSERT INTO dev_agent_runs(prompt,conversation_id,principal_user_id,launch_source,profile) VALUES('retained private prompt',$1,$2,'panel_web','operator') RETURNING id`,[old,person])).rows[0].id;
    await c.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','retained private body')`,[old]);
    await c.query(`INSERT INTO run_steers(run_id,conversation_id,body) VALUES($1,$2,'retained private steer')`,[oldRun,old]);
    const entries=await readLocal(options.dir);const e=makeIntent(entries,old,randomUUID(),new Date(Date.now()-31*86400000));
    await withLedgerLock(options.dir,()=>appendLocal(options.dir,e));await recover();
    await c.query(`SELECT set_config('sjcos.ask_purge','yes',false)`);await c.query('UPDATE ai_conversations SET purge_hold=true WHERE id=$1',[old]);await c.query(`SELECT set_config('sjcos.ask_purge','',false)`);
    assert.equal((await maintainThreads(pool,options)).purged,0);
    await c.query(`SELECT set_config('sjcos.ask_purge','yes',false)`);await c.query('UPDATE ai_conversations SET purge_hold=false WHERE id=$1',[old]);await c.query(`SELECT set_config('sjcos.ask_purge','',false)`);
    assert.equal((await maintainThreads(pool,options)).purged,1);
    const row=(await c.query('SELECT title,purged_at FROM ai_conversations WHERE id=$1',[old])).rows[0];assert.equal(row.title,'[deleted]');assert.ok(row.purged_at);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_messages WHERE conversation_id=$1',[old])).rows[0].n,0);
    assert.equal((await c.query('SELECT prompt FROM dev_agent_runs WHERE id=$1',[oldRun])).rows[0].prompt,'[deleted]');
    await c.query("SELECT set_config('sjcos.ask_purge','yes',false)");
    assert.equal((await c.query('SELECT body FROM run_steers WHERE run_id=$1',[oldRun])).rows[0].body,'[deleted]');
    await c.query("SELECT set_config('sjcos.ask_purge','',false)");
    assert.equal((await maintainThreads(pool,options)).purged,0);
   });
   await t.test('all Ask gate requires authority on every access, no stale receipt cache',async()=>{
    options.fault('failed');await assert.rejects(withAskJournal(pool,()=>assert.fail('private callback ran'),options));options.fault('failed',false);await recover();
   });
   assert.equal((await c.query(`SELECT to_regclass('ask_canvases') AS name`)).rows[0].name,null);
  });
 });
}));
test('thread Delete stays server-disabled until explicit Phase 0 acceptance',async()=>{
 delete process.env.SJC_ASK_THREAD_DELETE_ACCEPTED;
 await assert.rejects(deleteThread({},randomUUID(),randomUUID(),{}),/Chat deletion is not ready yet/);
});

test('pinned HTTPS authority verifies nonce, signature, ledger identity, complete encrypted prefix and CAS',async t=>{
 const {generateKeyPairSync,sign,createCipheriv,randomBytes,createDecipheriv}=await import('node:crypto');
 const {configuredAuthority}=await import('../lib/canvas-deletion-ledger.mjs');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),key=randomBytes(32),id=randomUUID();
 const env={SJC_CANVAS_AUTHORITY_URL:'https://journal.example.test/ledger',SJC_CANVAS_LEDGER_ID:id,SJC_CANVAS_AUTHORITY_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'}),SJC_CANVAS_AUTHORITY_TOKEN:'test-only',SJC_CANVAS_JOURNAL_KEY:key.toString('hex')};
 let current=[],fault='',oldReceipt;const original=globalThis.fetch;
 const seal=entries=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(JSON.stringify(entries)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');};
 globalThis.fetch=async(url,options)=>{
  assert.equal(url.protocol,'https:');assert.equal(options.redirect,'error');
  if(fault==='unavailable')throw Error('unavailable');
  if(fault==='stale-receipt')return Response.json(oldReceipt);
  const request=JSON.parse(options.body);
  if(request.action==='compare_and_swap'){
   assert.deepEqual(request.expected,validateChain(current));
   const b=Buffer.from(request.encrypted_prefix,'base64'),d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));const entries=JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());
   assert.deepEqual(validateChain(entries),{sequence:request.sequence,head_hash:request.head_hash});current=entries;
  }
  const receipt={nonce:fault==='nonce'?'stale':request.nonce,ledger_id:fault==='identity'?randomUUID():id,...validateChain(current),encrypted_prefix:seal(fault==='prefix'?[]:current)};
  const payload=JSON.stringify(receipt);const response={payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
  if(fault==='signature')response.signature=Buffer.alloc(64).toString('base64');oldReceipt=response;return Response.json(response);
 };
 try{
  const authority=configuredAuthority(env);
  let initial=await authority.read();assert.equal(initial.sequence,0);
  const e=makeIntent([],randomUUID());const advanced=await authority.advance(initial,[e]);assert.equal(advanced.sequence,1);
  for(const f of ['nonce','identity','signature','prefix','stale-receipt','unavailable'])await t.test(f,async()=>{fault=f;await assert.rejects(authority.read());fault='';});
  await t.test('no local/unpinned/unencrypted authority fallback',()=>{
   assert.throws(()=>configuredAuthority({...env,SJC_CANVAS_AUTHORITY_URL:'http://localhost/'}));
   assert.throws(()=>configuredAuthority({...env,SJC_CANVAS_JOURNAL_KEY:''}));
  });
 }finally{globalThis.fetch=original;}
});

test('staff question round-trip uses authenticated closed stdio adapter; forged identity and raw SQL denied',async t=>withMigrationSubset('interactions',[100,105],async({url,db,apply})=>{
 await apply();const staff=(await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Staff','staff',ARRAY['ai'],'x','S') RETURNING id`,[`${randomUUID()}@example.test`])).rows[0].id;
 const thread=(await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','private',$1) RETURNING id`,[staff])).rows[0].id;
 await fixture(async options=>withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool={query:(...args)=>c.query(...args)};
  await withLedgerLock(options.dir,()=>recoverThreads(pool,options));
  const run=(await c.query(`INSERT INTO dev_agent_runs(prompt,launch_source,profile,principal_user_id,conversation_id,with_mcp,status) VALUES('question','panel_web','business',$1,$2,false,'running') RETURNING id,extract(epoch FROM created_at)::bigint::text AS started_s`,[staff,thread])).rows[0];
  const env={SJC_RUN_ID:run.id,SJC_CONVERSATION_ID:thread,SJC_PRINCIPAL_USER_ID:staff,SJC_RUN_PROFILE:'business',SJC_RUN_STARTED_S:run.started_s,CRON_SECRET:'fixture-only'};
  const {interactionCommand}=await import('../lib/ask-thread-journal-interactions.mjs');const {createInteractionAdapter}=await import('../lib/ask-thread-journal-transport.mjs');
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,request)=>{calls++;assert.equal(url.pathname,'/api/internal/ask-interactions');assert.equal(request.headers.authorization,'Bearer fixture-only');const {action,input,context}=JSON.parse(request.body);try{return Response.json(await interactionCommand(pool,action,input,context,options));}catch{return Response.json({ok:false},{status:403});}};
  try{
   const adapter=createInteractionAdapter({transportKind:'stdio',env});
   const payload={questions:[{question:'Which finish?',options:[{label:'Oak'},{label:'Paint'}],multiSelect:false,allowOther:true}]};
   let id;
   await t.test('staff (including MCP-off interact) creates a private question',async()=>{id=await adapter.create('question',payload);assert.equal((await adapter.poll(id)).status,'pending');});
   await t.test('same person answers, closed adapter returns free text without raw narrow reads',async()=>{
    await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[staff]);
    await c.query(`UPDATE agent_interactions SET status='answered',response=$2::jsonb WHERE id=$1`,[id,JSON.stringify({kind:'question',answers:[{question:'Which finish?',choices:['Oak'],other:'Keep it natural'}]})]);
    await c.query(`SELECT set_config('sjcos.ask_actor','',false)`);
    await adapter.beforeDeliver(id);assert.equal((await adapter.poll(id)).response.answers[0].other,'Keep it natural');
   });
   for(const [key,value] of [['SJC_RUN_ID',randomUUID()],['SJC_CONVERSATION_ID',randomUUID()],['SJC_PRINCIPAL_USER_ID',randomUUID()],['SJC_RUN_PROFILE','operator'],['SJC_RUN_STARTED_S',String(Number(run.started_s)+1)]])await t.test(`forged ${key} denied`,()=>assert.rejects(createInteractionAdapter({transportKind:'stdio',env:{...env,[key]:value}}).create('question',payload),/RUN_CONTEXT_REQUIRED/));
   for(const input of [{transportKind:'http',env},{transportKind:'stdio',env,httpActive:()=>true},{transportKind:'stdio',env:{}}])await t.test('HTTP/bare/HTTP-ALS cannot forward claimed stdio identity',async()=>{const before=calls;await assert.rejects(createInteractionAdapter(input).create('question',payload),/RUN_CONTEXT_REQUIRED/);assert.equal(calls,before);});
   await t.test('captured identity cannot change after server construction',async()=>{const captured=createInteractionAdapter({transportKind:'stdio',env:{...env}});env.SJC_CONVERSATION_ID=randomUUID();assert.ok(await captured.create('question',payload));env.SJC_CONVERSATION_ID=thread;});
   await t.test('another adapter cannot poll a question ID it did not create',()=>assert.rejects(createInteractionAdapter({transportKind:'stdio',env}).poll(id),/RUN_CONTEXT_REQUIRED/));
   await t.test('registered ask_owner delivers the staff question and typed answer end to end',async()=>{
    const {registerAskOwner}=await import('../mcp/interact-tools.mjs');let ask;
    const baseFetch=globalThis.fetch;
    globalThis.fetch=async(url,request)=>{
     const result=await baseFetch(url,request),data=await result.clone().json();
     if(JSON.parse(request.body).action==='create'&&data.ok)await c.query(`UPDATE agent_interactions SET status='answered',response=$2::jsonb WHERE id=$1`,[data.id,JSON.stringify({answers:[{question:'Which finish?',choices:['Oak'],other:'Keep it natural'}]})]);
     return result;
    };
    try{
     // A new closure captures this test fetch; no production timing overrides.
     registerAskOwner({registerTool(name,_schema,fn){assert.equal(name,'ask_owner');ask=fn;}},{pool:{query(){assert.fail('raw narrow SQL bypass');}},json:data=>({content:[{type:'text',text:JSON.stringify(data)}]}),interactionAdapter:createInteractionAdapter({transportKind:'stdio',env})});
     const result=await ask({questions:[{question:'Which finish?',options:[{label:'Oak'},{label:'Paint'}]}],run_id:randomUUID(),conversation_id:randomUUID(),context:{principal_user_id:randomUUID()}});
     const answer=JSON.parse(result.content[0].text);assert.equal(answer.ok,true);assert.match(answer.answer,/Oak.*Keep it natural/);
    }finally{globalThis.fetch=baseFetch;}
   });
   await t.test('revoked person is denied before answer delivery',async()=>{await c.query(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 second')`,[staff]);await assert.rejects(adapter.beforeDeliver(id),/RUN_CONTEXT_REQUIRED/);});
  }finally{globalThis.fetch=original;}
 }));
 for(const role of ['sjcos_agent','sjcos_worker'])await t.test(`${role} still cannot insert a private interaction directly`,()=>withSessionIdentity(url,role,async c=>{
  await c.query(`SELECT set_config('sjcos.ask_actor',$1,false)`,[staff]);
  await assert.rejects(c.query(`INSERT INTO agent_interactions(conversation_id,kind,payload,agent) VALUES($1,'question','{}','forged')`,[thread]),e=>e.code==='42501');
 }));
}));
