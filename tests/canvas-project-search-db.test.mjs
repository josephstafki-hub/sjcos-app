import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
import {mounted,elements,text,find,settle} from './fixtures/canvas-mount.mjs';
appHooks();
const root=new URL('../',import.meta.url);
registerHooks({resolve(s,c,next){
 if(s==='@/lib/db')return {url:'phase0a:db',shortCircuit:true};
 if(s==='react'&&c.parentURL?.includes('/components/panel/'))return {url:'search-react:hooks',shortCircuit:true};
 if(c.parentURL==='search-react:hooks')return next(s,{...c,parentURL:import.meta.url});
 if(s==='@/lib/actions/ai-chat')return {url:'search-rail:denied',shortCircuit:true};
 if(s==='./uploads'&&c.parentURL?.endsWith('/lib/canvas-exports.ts'))return {url:'search:uploads',shortCircuit:true};
 if((s==='./db'||s==='./db.ts')&&c.parentURL?.includes('/lib/'))return {url:'phase0a:db',shortCircuit:true};
 if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}
 return next(s,c);
},load(u,c,next){
 if(u==='search-react:hooks')return {format:'module',shortCircuit:true,source:`import * as R from 'react';export * from 'react';${['useState','useEffect','useRef','useLayoutEffect','useCallback'].map(k=>`export const ${k}=(...a)=>(globalThis.__saveHooks?.${k}??R.${k})(...a);`).join('')}`};
 if(u==='search-rail:denied')return {format:'module',shortCircuit:true,source:`export async function searchJobsAction(){throw Error('rail search must not be used by Canvas Save');}`};
 if(u==='search:uploads')return {format:'module',shortCircuit:true,source:'export const UPLOAD_DIR=globalThis.__canvasSearchUploads;'};
 if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
 return next(u,c);
}});
const uploadDir=await mkdtemp(path.join(tmpdir(),'c1r2-search-'));globalThis.__canvasSearchUploads=uploadDir;
const {searchCanvasProjectsAction:search}=await import('../lib/actions/canvas-projects.ts');
const core=await import('../lib/ask-canvases.ts'),out=await import('../lib/canvas-exports.ts');
const {CanvasSaveDialog,CanvasAudienceChips}=await import('../components/panel/CanvasSaveDialog.tsx');
const {JobPicker}=await import('../components/panel/JobPicker.tsx');
const {encrypt}=await import('../lib/session.ts');
const {admitEpoch,hashBytes}=await import('../lib/ask-context-inputs.mjs');
const uuid=()=>crypto.randomUUID();
// Real website login + signed sessions, actual action, authorization and SQL.
// No mocked principal/search; only Next/React and in-process HTTP/FS adapters.
test('real Save search: owner and Projects staff pick → policy → audience → Save; other staff and scopes fail closed',()=>withTestDb(async(url,admin)=>{
 const people=await seedPeople(admin),dir=uploadDir;
 const oldFetch=globalThis.fetch,before={...process.env};
 try{await withSessionIdentity(url,'sjcos_test_website',async db=>{
  assert.equal((await db.query('SELECT session_user')).rows[0].session_user,'sjcos_test_website');
  globalThis.__phase0aDb=db;process.env.SJC_CANVAS_ENABLED='1';process.env.SESSION_SECRET='canvas-search-real-session-32-characters';
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.staff_enabled','true'),('canvas.exports_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  await db.query("UPDATE users SET permissions=ARRAY['ai','projects'] WHERE id=$1",[people.staff.id]);
  await db.query("UPDATE users SET permissions=ARRAY['ai'] WHERE id=$1",[people.noAi.id]);
  for(let i=0;i<25;i++)await db.query('INSERT INTO projects(slug,name,client_email) VALUES($1,$2,$3)',[`zz-r2-search-${i}`,`R2 search ${String(i).padStart(2,'0')}`,'private@example.test']);
  const slug='zz-r2-search-0';
  const signIn=async person=>{const token=await encrypt({userId:person.id,role:person.role,authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};};
  const create=async (person,project_slug)=>{
   const thread=(await db.query("INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id",[person.id])).rows[0].id;
   const profile=person.role==='owner'?'operator':'business';
   const run=(await db.query("INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.',$1,$2,$3,'panel_web',true) RETURNING id,extract(epoch FROM created_at)::bigint started",[profile,person.id,thread])).rows[0];
   if(profile==='business')await admitEpoch({client:db,threadId:thread,runId:run.id,policyHash:hashBytes('policy'),valid:true,resumed:false});
   const made=await core.canvasInternal('show',{request_id:uuid(),title:'Permit',summary:'Steps',...(project_slug?{project_slug}:{}),required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}},{run_id:run.id,principal_user_id:person.id,run_profile:profile,run_started_s:Number(run.started),transport:'runner_stdio'});
   return {id:made.canvas.id,thread};
  };
  let staffCanvas;
  for(const person of [people.owner,people.staff]){
   const c=await create(person);if(person===people.staff)staffCanvas=c;
   await signIn(person);
   const result=await search(c.id,1,'R2 search');assert.equal(result.ok,true);assert.equal(result.jobs.length,20);
   for(const row of result.jobs)assert.deepEqual(Object.keys(row).sort(),['kind','name','slug']);
   assert.equal((await search(c.id,1,'%')).jobs.length,0,'wildcards are literal');
   assert.equal((await search(c.id,1,'_')).jobs.length,0);
   assert.deepEqual(await search(c.id,1,'x'.repeat(121)),{ok:false,code:'ASK_PAUSED'});
   assert.equal((await search(c.id,999,'')).ok,false);
   await out.canvasRender(c.id,1,{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><text x="10" y="20">Permit</text></svg>'});
   const requests=[];let saved,closed=false,policyRequest,saveRequest;
   globalThis.fetch=async(url,init={})=>{
    requests.push(url);
    if(url.includes('/save-policy?'))return policyRequest=(async()=>Response.json(await out.canvasSavePolicy(c.id,1,new URL(url,'http://test').searchParams.get('project'))))();
    if(url.endsWith('/save'))return saveRequest=(async()=>{saved=await out.canvasSave(c.id,1,JSON.parse(init.body));return Response.json(saved);})();
    throw Error('unexpected request');
   };
   const dialog=mounted(CanvasSaveDialog,{data:await core.canvasGet(c.id),onClose(){closed=true;}});let picker;
   try{
    let tree=dialog.render();dialog.effects();assert.ok(find(tree,'Pick a project ▴'));
    const pick=elements(tree,e=>e.type===JobPicker)[0];picker=mounted(JobPicker,pick.props);picker.render();picker.effects();await new Promise(r=>setTimeout(r,40));const rows=picker.render();
    assert.doesNotMatch(text(rows),/filed|private@example/);await find(rows,'R2 search 00').props.onClick();
    dialog.render();dialog.effects();await policyRequest;await settle();tree=dialog.render();
    assert.ok(requests.some(u=>u.endsWith('?project='+slug)));assert.ok(find(tree,'R2 search 00 ▾'));
    if(person.role==='staff'){
     assert.equal(elements(tree,e=>e.type==='input'&&['radio','checkbox'].includes(e.props.type)).length,0);
     assert.equal(text(mounted(CanvasAudienceChips,elements(tree,e=>e.type===CanvasAudienceChips)[0].props).render()),'🔒 Staff');
    }else{
     assert.equal(elements(tree,e=>e.type==='input'&&e.props.type==='checkbox'&&e.props.checked).length,21);
     const onlyJoe=elements(tree,e=>e.type==='input'&&e.props.type==='radio')[1];onlyJoe.props.onChange();tree=dialog.render();
    }
    assert.equal(find(tree,'Save').props.disabled,false);find(tree,'Save').props.onClick();await saveRequest;await settle();assert.equal(closed,true);assert.equal(saved.ok,true);assert.equal(saved.file.project_slug,slug);
   }finally{dialog.close();picker?.close();}
  }
  // Staff without Projects cannot discover ANY names, even with ai and a canvas.
  const denied=await create(people.noAi);await signIn(people.noAi);assert.deepEqual(await search(denied.id,1,''),{ok:false,code:'ASK_PAUSED'});
  assert.equal((await search(staffCanvas.id,1,'')).ok,false,'foreign source unavailable');
  await signIn(people.staff);
  const folder=(await db.query("INSERT INTO ai_folders(name,owner_user_id,entity_kind,entity_id) VALUES('Private folder',$1,'project',$2) RETURNING id",[people.staff.id,slug])).rows[0];
  await db.query('UPDATE ai_conversations SET folder_id=$2 WHERE id=$1',[staffCanvas.thread,folder.id]);
  assert.deepEqual((await search(staffCanvas.id,1,'')).jobs,[{kind:'project',slug,name:'R2 search 00'}]);
  await assert.rejects(out.canvasSavePolicy(staffCanvas.id,1,'zz-r2-search-1'),/CANVAS_UNAVAILABLE/);
  await db.query('UPDATE ai_conversations SET folder_id=NULL WHERE id=$1',[staffCanvas.thread]);
  const bound=await create(people.staff,slug);
  assert.deepEqual((await search(bound.id,1,'')).jobs,[{kind:'project',slug,name:'R2 search 00'}]);
  // Current DB permissions, not the signed role or an earlier search, authorize.
  await db.query("UPDATE users SET permissions=ARRAY['ai'] WHERE id=$1",[people.staff.id]);
  assert.equal((await search(staffCanvas.id,1,'')).ok,false);
  await db.query("UPDATE users SET permissions=ARRAY['projects'] WHERE id=$1",[people.staff.id]);
  assert.equal((await search(staffCanvas.id,1,'')).ok,false);
  await db.query("UPDATE users SET permissions=ARRAY['ai','projects'] WHERE id=$1",[people.staff.id]);
  await db.query("INSERT INTO session_revocations(user_id,revoked_before) VALUES($1,now()+interval '1 minute')",[people.staff.id]);
  assert.deepEqual(await search(staffCanvas.id,1,''),{ok:false,code:'SIGN_IN_AGAIN'});
 });}finally{globalThis.fetch=oldFetch;delete globalThis.__canvasSearchUploads;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await rm(dir,{recursive:true,force:true});}
}));
