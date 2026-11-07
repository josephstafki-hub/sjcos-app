// R3 expectations first: same device survives duplicate mounts/lost replies;
// two real devices fill two slots, another person cannot retire either device.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {appHooks} from './phase0a-fixtures.mjs';
import {withTestDb,withLogin,stopCluster} from './_harness/testdb.mjs';
import {phase1Fixture} from './browser-schema-fixtures.mjs';
import {createBrowserWebHandler,createCsrf,RequestSchemas} from '../lib/browser/web-transport.mjs';
appHooks();
registerHooks({load(u,c,next){if(u.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(u,c);}});
const {createWebsiteAdapter}=await import('../lib/browser/web.ts');
const {searchBrowserProjectsAction}=await import('../lib/actions/browser-projects.ts');
const {encrypt}=await import('../lib/session.ts');
const origin='https://browser.test',key=Buffer.alloc(32,8),secret='r3-session-secret-of-at-least-32-characters';
test.after(()=>stopCluster());
const check=(name,fn)=>test(name,()=>withTestDb((url,db)=>phase1Fixture(url,db,x=>{globalThis.__phase0aDb=x.c;return fn({...x,url});}),{fresh:true}));
async function identity(c,sid){const s=(await c.query('SELECT *,extract(epoch FROM auth_at)::float auth_s,extract(epoch FROM expires_at)::float exp_s FROM web_sessions WHERE id=$1',[sid])).rows[0];return {sid,userId:s.user_id,authAt:s.auth_s,generation:Number(s.generation),exp:s.exp_s};}
function adapter(db){return createWebsiteAdapter({db:{query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})},key,controller:{call:async()=>({ok:true})}});}
async function route(url,session,path,body,headers={}){return withLogin(url,'sjcos_test_website',async db=>{const a=adapter(db),h=createBrowserWebHandler({origin,csrfKey:secret,...a,session:async()=>session,flags:async()=>({can_start:true})}),csrf=createCsrf(session,secret);return h(new Request(origin+'/api/agent-browser'+path,{method:body?'POST':'GET',headers:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-sjc-csrf':csrf.token,cookie:`sjc_browser_csrf=${csrf.token}`,...headers},...(body?{body:JSON.stringify(body)}:{})}));});}
check('R3 real LOGIN routes: double mount, lost response, concurrent retry with occupied second device, third refused, no cross-person retirement',async({c,url,task,viewer,staffSid,ownerSid})=>{
 await c.query('UPDATE browser_viewers SET left_at=now() WHERE id=$1',[viewer.id]);
 const session=await identity(c,staffSid),first=randomUUID(),second=randomUUID();
 const join=(device_id,s=session)=>route(url,s,`/tasks/${task.id}/join`,{mode:'initiator',device_id,idempotency_key:randomUUID()});
 const a=await join(first);assert.equal(a.status,200);const av=await a.json();
 const b=await join(first);assert.equal(b.status,200);const bv=await b.json();assert.equal(av.viewer_id,bv.viewer_id);assert.equal(av.device_secret,bv.device_secret);
 // Simulate a committed response lost by the network: retry with fresh request key.
 await join(first);const retry=await (await join(first)).json();assert.equal(retry.viewer_id,av.viewer_id);assert.equal(retry.device_secret,av.device_secret);
 const other=await join(second);assert.equal(other.status,200);const ov=await other.json();assert.notEqual(ov.viewer_id,av.viewer_id);
 const concurrent=await Promise.all([join(first),join(first)]);for(const r of concurrent){assert.equal(r.status,200);assert.equal((await r.json()).viewer_id,av.viewer_id);}
 assert.equal((await join(randomUUID())).status,429);
 const before=(await c.query('SELECT id,device_hash,stream_id,left_at FROM browser_viewers WHERE task_id=$1 ORDER BY id',[task.id])).rows;
 assert.equal((await join(first,await identity(c,ownerSid))).status,404);
 assert.deepEqual((await c.query('SELECT id,device_hash,stream_id,left_at FROM browser_viewers WHERE task_id=$1 ORDER BY id',[task.id])).rows,before);
 assert.equal(before.filter(v=>!v.left_at).length,2);
});
test('R3 join requires explicit stable device UUID and refuses injected fields',()=>{const base={mode:'initiator',idempotency_key:randomUUID()};assert.equal(RequestSchemas.join.safeParse(base).success,false);assert.equal(RequestSchemas.join.safeParse({...base,device_id:randomUUID()}).success,true);assert.equal(RequestSchemas.join.safeParse({...base,device_id:'not-a-device'}).success,false);assert.equal(RequestSchemas.join.safeParse({...base,device_id:randomUUID(),user_id:randomUUID()}).success,false);});
check('R3 In use label ends at a whole word with ellipsis within 60 characters',async({c,people})=>{
 const purpose='Check public permit requirements for a residential alteration.';
 await c.query('UPDATE browser_tasks SET purpose=$1',[purpose]);const a=adapter(c),s={userId:people.owner.id};
 const list=await a.execute({operation:'in_use',request:new Request(origin),session:s,context:{user:people.owner},flags:{}});
 assert.equal(list.items[0].task_label,'Check public permit requirements for a residential…');assert.ok(list.items[0].task_label.length<=60);
 for(const value of ['Short task', 'x'.repeat(90)]){await c.query('UPDATE browser_tasks SET purpose=$1',[value]);const r=await a.execute({operation:'in_use',request:new Request(origin),session:s,context:{user:people.owner},flags:{}});assert.ok(r.items[0].task_label.length<=60);assert.equal(r.items[0].task_label,value.length<=60?value:'Browser task…');}
});
check('R3 projects-only action: owner and Projects staff; revoked/missing access refuses, no contact or money fields',async({c,people})=>{
 process.env.SESSION_SECRET=secret;
 await c.query("UPDATE users SET permissions=ARRAY['ai','projects'] WHERE id=$1",[people.staff.id]);
 for(let i=0;i<23;i++)await c.query('INSERT INTO projects(slug,name,client_email) VALUES($1,$2,$3)',[`r3-project-${i}`,`R3 Project ${String(i).padStart(2,'0')}`,'PRIVATE-CANARY@example.test']);
 const sign=async p=>{globalThis.__phase0aCookies={get:()=>({value:null})};const token=await encrypt({userId:p.id,role:p.role,authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};};
 for(const p of [people.owner,people.staff]){await sign(p);const r=await searchBrowserProjectsAction('R3 Project');assert.equal(r.ok,true);assert.equal(r.jobs.length,20);for(const j of r.jobs){assert.deepEqual(Object.keys(j).sort(),['kind','name','slug']);assert.equal(j.kind,'project');}assert.deepEqual((await searchBrowserProjectsAction('%')).jobs,[]);assert.deepEqual((await searchBrowserProjectsAction('_')).jobs,[]);assert.equal((await searchBrowserProjectsAction('x'.repeat(121))).ok,false);}
 await c.query("UPDATE users SET permissions=ARRAY['ai'] WHERE id=$1",[people.staff.id]);assert.equal((await searchBrowserProjectsAction('')).ok,false);
 await c.query("UPDATE users SET permissions=ARRAY['ai','projects'] WHERE id=$1",[people.staff.id]);assert.equal((await searchBrowserProjectsAction('')).ok,true);
 await c.query("INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 minute')",[people.staff.id]);assert.equal((await searchBrowserProjectsAction('')).ok,false);
 await sign(people.client);assert.equal((await searchBrowserProjectsAction('')).ok,false);
});
