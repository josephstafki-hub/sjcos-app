// Expectations first: actual signed cookies pass Proxy's action transport but
// never authenticate an action after expiry/revocation. Pages still redirect.
// Status is 401/no-store; mobile failures preserve 401/403/503/409, and paused
// voice GET is 200/unavailable while POST is 503, with zero providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as jose from 'jose';
import {NextRequest,NextResponse} from 'next/server.js';
import {getRedirectError} from 'next/dist/client/components/redirect.js';
import {withMigrationSubset,withSessionIdentity} from './_harness/testdb.mjs';
const require=createRequire(import.meta.url),plain=x=>JSON.parse(JSON.stringify(x));
function load(file,deps={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,process,Buffer,console,TextEncoder,Headers,URL,Request,Response,FormData,setTimeout,clearTimeout,require:s=>Object.hasOwn(deps,s)?deps[s]:s==='server-only'?{}:s.startsWith('@/components/')?load(s.slice(2)+'.ts'):s.startsWith('@/')?{}:s.startsWith('.')?load(new URL(s+'.ts',new URL('../'+file,import.meta.url)).pathname.slice(new URL('../',import.meta.url).pathname.length)):require(s)});return exports;}
const contract=load('lib/ask-result-codes.ts');
const contractDeps={'@/lib/ask-result-codes':contract,'./ask-result-codes':contract,'../ask-result-codes.ts':contract};

test('real expired/revoked/legacy cookies: Proxy to exported Ask actions and status',()=>withMigrationSubset('r3_auth',[100,105],async({url,db,apply})=>{
 await apply();process.env.SESSION_SECRET='r3-auth-only-secret-that-is-long-enough-for-tests';
 const user=(await db.query(`INSERT INTO users(email,name,role,password_hash,initials) VALUES($1,'Owner','owner','x','O') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
 await withSessionIdentity(url,'sjcos_test_website',async c=>{
  const pool={query:(...a)=>c.query(...a),connect:async()=>({query:(...a)=>c.query(...a),release(){}})};
  let token,mutations=0;
  const window=load('lib/session-window.ts');
  const headers={'next/headers':{cookies:async()=>({get:()=>token?{value:token}:undefined}),headers:async()=>new Headers()}};
  const web=load('lib/web-sessions.ts',{'jose':jose,...headers,'@/lib/db':{pool},'@/lib/session-window':window});
  const session=load('lib/session.ts',{'jose':jose,...headers,'./web-sessions':web,'./session-window':window});
  const proxy=load('proxy.ts',{'jose':jose,'next/server':{NextRequest,NextResponse},'@/lib/session-window':window,'@/lib/web-sessions':web,'@/lib/permissions':load('lib/permissions.ts')}).default;
  const access=load('lib/thread-access.ts',{...contractDeps,'server-only':{},'@/lib/db':{pool},'@/lib/session':session,'@/lib/ask-thread-journal.mjs':{withAskJournal:async(_p,fn)=>fn()}});
  await c.query('UPDATE ask_canvas_maintenance SET recovery_ready=true');
  const thread=(await c.query(`INSERT INTO ai_conversations(agent,title,owner_user_id) VALUES('claude','Own chat',$1) RETURNING id`,[user])).rows[0].id;
  const actions=load('lib/actions/ai-chat.ts',{
   '@/lib/thread-access':access,
   '@/lib/orchestrator/proposals':{setEscalateHook(){}},
   '@/lib/ai-chat':load('lib/ai-chat.ts',{'@/lib/thread-access':access}),
   '@/lib/thread-folders':load('lib/thread-folders.ts',{'@/lib/thread-access':access}),
   '@/lib/panel-context':{loadPanelContext:async()=>''},
   '@/lib/attachments':{sanitizeAttachments:()=>[]},
   '@/lib/ask-run-admission':{currentAskLaunchSource:async()=>'panel_web'},
   '@/lib/dev-agents':{startClaudeRun:async()=>{mutations++;return randomUUID();}},
  });
  const runs=load('lib/actions/dev-agents.ts',{'@/lib/thread-access':access});
  const dal=load('lib/dal.ts',{'server-only':{},react:{cache:fn=>fn},'next/navigation':{redirect:path=>{throw getRedirectError(path,'push');}},'@/lib/db':{queryOne:async(...a)=>(await c.query(...a)).rows[0]},'@/lib/session':session,'@/lib/permissions':load('lib/permissions.ts'),'@/lib/api-auth':load('lib/api-auth.ts',{'server-only':{},'jose':jose,...headers,'@/lib/db':{queryOne:async(...a)=>(await c.query(...a)).rows[0]},'@/lib/session':session,'@/lib/permissions':load('lib/permissions.ts')})});
  let backgroundReads=0;
  const live=load('lib/actions/live.ts',{'@/lib/dal':dal,'@/lib/live':{getLiveChanges:async()=>{backgroundReads++;return {cursor:2,scopes:['work_items'],agentScopes:[]};}}});
  const queue=load('lib/actions/today.ts',{'@/lib/dal':dal,'@/lib/today':{getQueueSnapshot:async()=>{backgroundReads++;return {priorities:[],waiting:{items:[],total:0}};}}});
  const inbox=load('lib/actions/inbox-drafts.ts',{'@/lib/dal':dal,'@/lib/mailbox':{withMailboxFor:()=>assert.fail('denied mailbox callback')},'@/lib/db':{query:()=>assert.fail('denied draft SQL')}});
  const draft={threadKey:'thread',channel:'sms',baseVersion:0,body:'local draft',toEmail:'',subject:'',cc:[]};
  const foreground=[()=>inbox.discardDraft(draft),()=>inbox.markDraftSent(draft),()=>inbox.dismissSuggestion(randomUUID()),()=>calls.loadSelectedCall(randomUUID())];
  const workbench=load('lib/actions/workbench.ts',{'@/lib/dal':dal});
  const calls=load('lib/actions/calls.ts',{'@/lib/dal':dal,'../comms/connection-copy':{}});
  const status=load('app/api/ai/status/route.ts',{'@/lib/dal':dal,'@/lib/db':{pool},'@/lib/ask-thread-journal.mjs':{withAskJournal:async(_p,fn)=>fn(),deletionCapabilities:async()=>({deleteAvailable:false})},'@/lib/thread-access':access,...contractDeps});
  const now=Math.floor(Date.now()/1000),key=new TextEncoder().encode(process.env.SESSION_SECRET);
  const sign=claims=>new jose.SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuedAt(now-20).sign(key);
  const sid=await web.createWebSession(user,now-20,3600);
  const active=await sign({...sid,role:'owner',iss:web.WEB_SESSION_ISSUER,aud:web.WEB_SESSION_AUDIENCE});
  const expiredSid=await sign({...sid,role:'owner',exp:now-1,iss:web.WEB_SESSION_ISSUER,aud:web.WEB_SESSION_AUDIENCE});
  const legacy=await sign({userId:user,role:'owner',authAt:now-20,exp:now+3600});
  const expiredLegacy=await sign({userId:user,role:'owner',authAt:now-20,exp:now-1});
  const check=async(value,valid)=>{
   token=value;
   const req=(method,action)=>new NextRequest('http://local/today',{method,headers:{...(token?{cookie:`sjcos_session=${token}`} :{}),...(action?{'Next-Action':'fixture'}:{})}});
   const transport=await proxy(req('POST',true));assert.equal(transport.headers.get('location'),null);assert.equal(transport.headers.get('x-middleware-request-x-sjcos-path'),'/today');
   if(!valid){
    const page=await proxy(req('GET',false));
    if(page.status===200)await assert.rejects(dal.requireUser(),e=>contract.normalizeAskFailure(e).code==='SIGN_IN_AGAIN');
    else assert.equal(page.status,307);
    for(const result of [await runs.pollAgentRun(randomUUID()),await actions.listThreadRailAction(),await actions.sendMessageAction(randomUUID(),'secret draft'),await actions.uploadChatFilesAction(new FormData()),await actions.loadConversationAction(randomUUID())])assert.deepEqual(plain(result),{ok:false,code:'SIGN_IN_AGAIN'});
    const before=backgroundReads;
    for(const result of [await live.pollLiveChanges(1),await queue.refreshTodayQueue(),await inbox.loadDrafts(['thread']),await inbox.saveDraft(draft),await workbench.getWorkbenchAction(randomUUID()),await calls.loadCall(randomUUID())])assert.deepEqual(plain(result),{ok:false,code:'SIGN_IN_AGAIN'});
    assert.equal(backgroundReads,before);
    for(const action of foreground)await assert.rejects(action,e=>/^NEXT_REDIRECT;push;\/(login|logout);307;$/.test(e.digest));
    const res=await status.GET();assert.equal(res.status,401);assert.equal(res.headers.get('cache-control'),'no-store');assert.deepEqual(await res.json(),{ok:false,code:'SIGN_IN_AGAIN'});
   }else{assert.equal((await live.pollLiveChanges(1)).cursor,2);assert.equal((await queue.refreshTodayQueue()).waiting.total,0);assert.equal((await proxy(req('GET',false))).status,200);assert.equal((await actions.sendMessageAction(thread,'authenticated private message')).kind,'pending');assert.equal((await status.GET()).status,200);}
  };
  for(const value of [undefined,expiredLegacy,expiredSid])await check(value,false);
  assert.equal(mutations,0);await check(active,true);await check(legacy,true);assert.equal(mutations,2);
  const deniedDal={...dal,getCurrentUser:async()=>({role:'staff',permissions:['ai']})};
  const deniedQueue=load('lib/actions/today.ts',{'@/lib/dal':deniedDal,'@/lib/today':{getQueueSnapshot:async()=>assert.fail('denied queue read')}});
  assert.deepEqual(plain(await deniedQueue.refreshTodayQueue()),{ok:false,code:'ACCESS_DENIED'});
  // No-ai staff retains foreground call access, then loses comms/inbox mid-session.
  const staff=(await c.query(`INSERT INTO users(email,name,role,permissions,password_hash,initials) VALUES($1,'Staff','staff',ARRAY['comms','inbox'],'x','S') RETURNING id`,[randomUUID()+'@example.test'])).rows[0].id;
  token=await sign({userId:staff,role:'staff',authAt:now-20,exp:now+3600});
  const selected=load('lib/actions/calls.ts',{'@/lib/dal':dal,'../comms/connection-copy':{},'@/lib/voice':{getCall:async id=>{backgroundReads++;return {id};},getCallEvents:async()=>{backgroundReads++;return [];}}});
  const selectedId=randomUUID();assert.equal((await selected.loadSelectedCall(selectedId)).call.id,selectedId);
  assert.equal((await selected.loadCall(selectedId)).call.id,selectedId);
  const readsBeforeDenial=backgroundReads;
  await c.query("UPDATE users SET permissions=ARRAY['today']::text[] WHERE id=$1",[staff]);
  for(const action of [...foreground,()=>selected.loadSelectedCall(selectedId)])await assert.rejects(action,e=>e.digest==='NEXT_REDIRECT;push;/today;307;');
  for(const result of [await inbox.loadDrafts(['thread']),await inbox.saveDraft(draft),await selected.loadCall(selectedId)])assert.deepEqual(plain(result),{ok:false,code:'ACCESS_DENIED'});
  assert.equal(backgroundReads,readsBeforeDenial);
  const registryExpired=await web.createWebSession(user,now-20,3600);
  const registryExpiredToken=await sign({...registryExpired,role:'owner',iss:web.WEB_SESSION_ISSUER,aud:web.WEB_SESSION_AUDIENCE});
  await c.query("UPDATE web_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[registryExpired.sid]);
  mutations=0;await check(registryExpiredToken,false);
  await web.revokeWebSession(sid.sid);await check(active,false);
  await c.query(`INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now())`,[user]);await check(legacy,false);assert.equal(mutations,0);assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_messages')).rows[0].n,2);
 });
}));

test('structured auth redirects and legacy codes normalize without matching arbitrary login text',()=>{
 const access=load('lib/thread-access.ts',{'server-only':{},'@/lib/db':{},'@/lib/session':{},'@/lib/ask-thread-journal.mjs':{},...contractDeps});
 assert.deepEqual(plain(access.askFailure({ok:false,code:'SIGN_IN_AGAIN',secret:'must not serialize'})),{ok:false,code:'SIGN_IN_AGAIN'});
 for(const path of ['/login','/logout','/login?returnTo=%2Ftoday'])assert.deepEqual(plain(access.askFailure(getRedirectError(path,'push'))),{ok:false,code:'SIGN_IN_AGAIN'});
 for(const code of ['ASK_COOKIE_REQUIRED','ASK_SESSION_REVOKED'])assert.deepEqual(plain(access.askFailure(Error(code))),{ok:false,code:'SIGN_IN_AGAIN'});
 for(const err of [Error('provider login failed'),{message:'NEXT_REDIRECT',digest:'NEXT_REDIRECT;push;/login;bogus;'},getRedirectError('/today','push'),getRedirectError('https://evil.test/login','push')])assert.deepEqual(plain(access.askFailure(err)),{ok:false,code:'ASK_PAUSED'});
});

test('mobile read/RPC returned and thrown failures retain exact typed status',async()=>{
 const access=load('lib/thread-access.ts',{'server-only':{},'@/lib/db':{},'@/lib/session':{},'@/lib/ask-thread-journal.mjs':{},...contractDeps});
 const dispatch=load('lib/mobile-rpc/dispatch.ts',{'../ask-result-codes.ts':contract});
 const user={id:'owner',role:'owner',permissions:[]};
 const read=load('lib/mobile-rpc/operator-reads.ts',{'server-only':{},...contractDeps,'@/lib/thread-access':{...access,askBoundary:async fn=>fn()},'@/lib/api-auth':{getUserFromRequest:async()=>user,hasAccess:()=>true},'@/lib/dal':{getCurrentUser:async()=>user},'./dispatch':dispatch,...Object.fromEntries(['@/lib/actions/ai-chat','@/lib/actions/dev-agents','@/lib/actions/panel-review','@/lib/projects','@/lib/leads','@/lib/page-context','@/lib/dev-agents-meta','@/lib/thread-rail','@/components/panel/panelStarters'].map(s=>[s,{}]))});
 for(const [code,status] of [['SIGN_IN_AGAIN',401],['CHAT_OFF',403],['ASK_PAUSED',503],['THREAD_UNAVAILABLE',409],['DELETE_NOT_READY',409]]){
  const fn=async()=>({ok:false,code});
  for(const res of [await read.mobileOperatorRead(new Request('http://local'),false,fn),await dispatch.dispatchMobileAction(new Request('http://local',{method:'POST',body:'{}'}),'ask',{ask:{area:'ai',invoke:fn}},async()=>user,()=>['/today'])]){assert.equal(res.status,status);assert.deepEqual(await res.json(),{ok:false,code});}
 }
 for(const [path,code,status] of [['/login','SIGN_IN_AGAIN',401],['/logout','SIGN_IN_AGAIN',401],['/today','CHAT_OFF',403]]){
  const fn=async()=>{throw getRedirectError(path,'replace');};
  for(const res of [await read.mobileOperatorRead(new Request('http://local'),false,fn),await dispatch.dispatchMobileAction(new Request('http://local',{method:'POST',body:'{}'}),'ask',{ask:{area:'ai',invoke:fn}},async()=>user,()=>['/today'])]){assert.equal(res.status,status);assert.deepEqual(await res.json(),{ok:false,code});}
 }
});

test('voice GET recovers capability without provider calls while POST stays closed; sub path stays independent',async()=>{
 for(const name of ['transcribe','tts']){
  let role='owner',code='ASK_PAUSED',providers=0;
  const access=load('lib/thread-access.ts',{'server-only':{},'@/lib/db':{},'@/lib/session':{},'@/lib/ask-thread-journal.mjs':{},...contractDeps});
  const routes=load(`app/api/${name}/route.ts`,{...contractDeps,'next/server':{NextResponse},'@/lib/dal':{getCurrentUser:async()=>role?{role}:null},'@/lib/thread-access':{...access,askBoundary:async fn=>code?{ok:false,code}:fn()},'@/lib/api-auth':{hasAccess:()=>true},'@/lib/orchestrator/voice':{},'@/lib/transcribe':{whisperAvailable:()=>{providers++;return true;},transcribeAudio:async()=>{providers++;return {ok:true,text:'speech'};}},'@/lib/tts':{piperAvailable:()=>{providers++;return true;},synthesizeSpeech:async()=>{providers++;return {ok:true,wav:Buffer.alloc(0)};}}});
  let res=await routes.GET();assert.equal(res.status,200);assert.deepEqual(await res.json(),{available:false,code:'ASK_PAUSED'});assert.equal(res.headers.get('cache-control'),'no-store');
  res=await routes.POST(new Request('http://local',{method:'POST',body:'{"text":"speech"}'}));assert.equal(res.status,503);assert.equal(providers,0);
  for(const [failure,status] of [['SIGN_IN_AGAIN',401],['CHAT_OFF',403]]){code=failure;res=await routes.GET();assert.equal(res.status,status);assert.deepEqual(await res.json(),{ok:false,code:failure});}
  code=null;res=await routes.GET();assert.equal(res.status,200);assert.deepEqual(await res.json(),{available:true});assert.equal(res.headers.get('cache-control'),'no-store');
  code='ASK_PAUSED';role='sub';res=await routes.POST(new Request('http://local',{method:'POST',body:'{"text":"daily log"}'}));assert.equal(res.status,200);
 }
});
