import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
const require=createRequire(import.meta.url);
function load(file,deps){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,process,console,URL,Request,Response,Buffer,require:s=>s==='@/lib/ask-result-codes'?load('lib/ask-result-codes.ts',{}):s in deps?deps[s]:s.startsWith('node:')?require(s):{}});return exports;}
// Expectations FIRST: run the real caller SQL as BOTH the non-superuser website
// identity and the RLS-bypassing harness login. Joe and Abigail each see only
// their own active/archived titles, messages, folders, suggestions and busy
// state. Every foreign-thread lifecycle operation maps to THREAD_UNAVAILABLE,
// leaves all rows unchanged and cannot create a folder. Foreign folder IDs
// cannot be inspected or used to move an owned thread. Poll sweep settles only
// self; a separate trusted journal/cron adapter settles all quiet live threads.
// A forged search principal must not override the current session actor.
test('rail, folders and lifecycle privacy independent of RLS',async t=>withTestDb(async(url,db)=>{
 const people=[];for(const role of ['owner','staff'])people.push((await db.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Private',$2,ARRAY['ai'],'x','P') RETURNING id`,[crypto.randomUUID()+'@example.test',role])).rows[0].id);
 const folders=[],ids=[],archived=[];
 for(let i=0;i<2;i++){
  folders.push((await db.query(`INSERT INTO ai_folders(name,owner_user_id) VALUES($1,$2) RETURNING id`,['QA folder '+i,people[i]])).rows[0].id);
  ids.push((await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id,folder_id,last_activity_at) VALUES('claude',$1,$2,$3,now()-interval '10 days') RETURNING id`,['QA secret '+i,people[i],folders[i]])).rows[0].id);
  archived.push((await db.query(`INSERT INTO ai_conversations(agent,title,owner_user_id,archived_at) VALUES('claude',$1,$2,now()) RETURNING id`,['QA archive '+i,people[i]])).rows[0].id);
 }
 await db.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
 const runs=[];
 for(let i=0;i<2;i++)runs.push((await db.query(`INSERT INTO dev_agent_runs(agent,prompt,status,profile,principal_user_id,conversation_id,launch_source) VALUES('claude','QA private prompt','running','business',$1,$2,'panel_web') RETURNING id`,[people[i],ids[i]])).rows[0].id);
 const project=(await db.query(`INSERT INTO projects(slug,name,client_name) VALUES($1,'QA job','QA client') RETURNING slug`,['zz-'+crypto.randomUUID()])).rows[0].slug;
 for(const [identity,connect] of [['superuser',fn=>fn(db)],['website',fn=>withSessionIdentity(url,'sjcos_test_website',fn)]])await connect(async c=>{
  let session={userId:people[0],authAt:Math.floor(Date.now()/1000)};
  const pool={query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})};
  const journal={withAskJournal:async(_p,fn)=>fn(),deletionCapabilities:async()=>({deleteAvailable:false})}; // gate seam only; SQL/session identities real
  const access=load('lib/thread-access.ts',{'@/lib/db':{pool},'@/lib/session':{readSession:async()=>session},'@/lib/ask-thread-journal.mjs':journal});
  const api=load('lib/thread-folders.ts',{'@/lib/thread-access':access,'@/lib/thread-rail':{sortKeysFor:ids=>ids.map((id,i)=>({id,sortKey:String(i)}))}});
  const chat=load('lib/ai-chat.ts',{'@/lib/thread-access':access});
  const actions=load('lib/actions/ai-chat.ts',{'@/lib/thread-access':access,'@/lib/ai-chat':chat,'@/lib/thread-folders':api,'@/lib/orchestrator/proposals':{setEscalateHook(){}}});
  const railLogic=load('lib/thread-rail.ts',{});
  const mobile=load('lib/mobile-rpc/operator-reads.ts',{'@/lib/actions/ai-chat':actions,'@/lib/thread-access':access,'@/lib/ask-result-codes':load('lib/ask-result-codes.ts',{}),'@/lib/thread-rail':railLogic});
  const search=load('lib/panel-search.ts',{'@/lib/thread-access':access,'@/lib/db':{query:(...a)=>c.query(...a)},'@/lib/permissions':{staffMayOpen:(_p,path)=>path==='/panel'}});
  for(let i=0;i<2;i++){
   session.userId=people[i];const other=1-i;
   await t.test(`${identity}: ${i?'Abigail':'Joe'} rail/archive/search/folders self only`,async()=>{
    const rail=await api.listThreadRail();assert.deepEqual(Array.from(rail.threads,r=>r.id),[ids[i]]);assert.deepEqual(Array.from(rail.folders,r=>r.id),[folders[i]]);
    assert.equal(rail.threads[0].working,identity==='superuser');assert.equal(rail.threads[0].lastRunId,runs[i]);
    assert.deepEqual(Array.from(await api.listArchivedThreads(),r=>r.id),[archived[i]]);
    assert.deepEqual(Array.from(await chat.listAllConversations(),r=>r.id),[ids[i]]);
    assert.deepEqual(Array.from(await chat.listConversations('claude'),r=>r.id),[ids[i]]);
    const hits=await search.searchPanelForUser({id:people[i],role:i?'staff':'owner',permissions:['ai']},'QA');assert.deepEqual(Array.from(hits.filter(r=>r.kind==='thread'),r=>r.recordId).sort(),[ids[i],archived[i]].sort());
    const forged=await search.searchPanelForUser({id:people[other],role:'owner',permissions:[]},'QA');assert.equal(forged.filter(r=>r.kind==='thread').length,0);
    assert.equal(await api.getFolder(folders[other]),null);
    const user={id:people[i],role:i?'staff':'owner',permissions:['ai']};
    const response=await mobile.operatorRail(new Request('http://test/operator/rail'),user);
    assert.deepEqual(Array.from(response.threads,r=>r.id),[ids[i]]);
    const mobileArchive=await mobile.operatorArchived(new Request('http://test/operator/archived'),user);
    assert.deepEqual(Array.from(mobileArchive.threads,r=>r.id),[archived[i]]);
    const groups=railLogic.groupThreads(rail.folders,rail.threads);
    assert.equal(groups.length,1);assert.equal(groups[0].key,folders[i]);
    assert.equal(groups[0].count,rail.threads[0].settledOverride==='settled'?0:1);
    assert.equal(groups[0].activityMs,railLogic.ms(rail.threads[0].lastActivityAt));
    assert.ok(!JSON.stringify(response).includes('QA secret '+other));
    assert.equal((await api.bindFolder(folders[i],{kind:'project',id:project})).ok,true);
    assert.equal(await api.ensureFolderForEntity({kind:'project',id:project}),folders[i]);
    const jobs=await api.searchFolderEntities('QA');assert.ok(jobs.every(r=>r.folderId!==folders[other]));
   });
   await t.test(`${identity}: foreign lifecycle operations deny and change nothing`,async()=>{
    const snapshot=JSON.stringify((await c.query('SELECT * FROM ai_conversations ORDER BY id')).rows);
    const count=(await c.query('SELECT count(*) FROM ai_folders')).rows[0].count;
    for(const call of [()=>actions.settleConversationAction(ids[other]),()=>actions.unsettleConversationAction(ids[other]),()=>actions.pinConversationAction(ids[other],true),()=>actions.archiveConversationAction(ids[other],true),()=>actions.moveConversationAction(ids[other],null),()=>actions.fileConversationUnderAction(ids[other],{kind:'project',id:project}),()=>api.settleThread(ids[other]),()=>api.unsettleThread(ids[other]),()=>api.touchThreadActivity(ids[other]),()=>api.setThreadPinned(ids[other],true),()=>api.setThreadPinned(ids[other],false),()=>api.setThreadArchived(ids[other],true),()=>api.setThreadArchived(ids[other],false),()=>api.moveThread(ids[other],null),()=>api.fileThreadUnderEntity(ids[other],{kind:'project',id:project}),()=>api.folderContextLine(ids[other]),()=>api.moveThread(ids[i],folders[other])]){
     const result=await access.askBoundary(call);assert.equal(result.code,'THREAD_UNAVAILABLE');
    }
    assert.equal(JSON.stringify((await c.query('SELECT * FROM ai_conversations ORDER BY id')).rows),snapshot);assert.equal((await c.query('SELECT count(*) FROM ai_folders')).rows[0].count,count);
    for(const call of [()=>api.renameFolder(folders[other],'stolen'),()=>api.setFolderArchived(folders[other],true),()=>api.deleteFolder(folders[other]),()=>api.bindFolder(folders[other],null),()=>api.setFolderCollapsed(folders[other],true),()=>api.reorderFolders([folders[other]])])assert.equal((await access.askBoundary(call)).code,'THREAD_UNAVAILABLE');
   });
  }
  await t.test(`${identity}: poll settles self only; trusted background settles other`,async()=>{
   await c.query(`UPDATE dev_agent_runs SET status='done' WHERE id=ANY($1::uuid[])`,[runs]);
   await c.query(`UPDATE ai_conversations SET settled_override=NULL,settled_at=NULL WHERE id=ANY($1::uuid[])`,[ids]);session.userId=people[0];
   assert.equal((await api.autoSettleQuietThreads({force:true})).settled,1);
   assert.equal((await c.query('SELECT settled_override FROM ai_conversations WHERE id=$1',[ids[1]])).rows[0].settled_override,null);
   const maintenance=load('lib/thread-folder-maintenance.ts',{'@/lib/db':{pool},'@/lib/ask-thread-journal.mjs':journal});assert.equal((await maintenance.autoSettleQuietThreadsInBackground()).settled,1);
  });
 });
},{fresh:true}));
