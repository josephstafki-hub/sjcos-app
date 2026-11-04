import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { getRedirectError } from 'next/dist/client/components/redirect.js';
import { defineAction, dispatchMobileAction } from '../lib/mobile-rpc/dispatch.ts';

// Exercise the actual dispatcher without Next's request storage or a DB.
const owner = { id: 'owner', role: 'owner', permissions: [] };
const staff = { id: 'staff', role: 'staff', permissions: [] };
const registry = { done: defineAction({ input: z.object({ id: z.uuid() }).strict(), run: async ({ id }) => ({ id }) }) };
const request = body => new Request('http://localhost/api/mobile/rpc/done', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = (name, body, user = owner, actions = registry) => dispatchMobileAction(request(body), name, actions, async () => user, () => ['/today']);
test('unknown action returns 404 including inherited object properties', async () => {
  for (const name of ['missing', 'toString', '__proto__']) assert.equal((await call(name, {})).status, 404);
});
test('bad schema and malformed JSON return 400', async () => {
  assert.equal((await call('done', {})).status, 400);
  assert.equal((await call('done', '{')).status, 400);
});
test('no authenticated token returns 401', async () => assert.equal((await call('done', {}, null)).status, 401));
test('staff without area returns 403', async () => assert.equal((await call('done', {}, staff)).status, 403));
test('happy path returns the action result', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const response = await call('done', { id });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result: { id } });
});
test('owner-only gate rejects staff who have Today', async () => {
  const actions = { done: defineAction({ input: z.object({}), ownerOnly: true, run: async () => null }) };
  assert.equal((await call('done', {}, { ...staff, permissions: ['today'] }, actions)).status, 403);
});
test('Next auth redirects become 403; success redirects become JSON', async () => {
  for (const path of ['/login', '/logout', '/today', '/projects/example']) {
    const actions = { done: defineAction({ input: z.object({}), run: async () => { throw getRedirectError(path, 'replace'); } }) };
    const response = await call('done', {}, owner, actions);
    assert.equal(response.status, path === '/projects/example' ? 200 : 403);
    if (response.status === 200) assert.deepEqual(await response.json(), { ok: true, redirect: path });
  }
});
test('returned action refusal becomes 400', async () => {
  const actions = { done: defineAction({ input: z.object({}), run: async () => ({ ok: false, error: 'Changed since preview.' }) }) };
  const response = await call('done', {}, owner, actions);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Changed since preview.' });
});

test('staff-crafted lead portal send is denied before its action runs', async () => {
  let invoked=false;
  const actions={post:defineAction({area:'leads',ownerOnly:true,input:z.object({body:z.string()}),run:async()=>{invoked=true;}})};
  const response=await call('post',{body:'Hello'},{...staff,permissions:['leads','projects']},actions);
  assert.equal(response.status,403);assert.equal(invoked,false);
});
test('lead create navigation result survives the dispatcher',async()=>{
 const actions={create:defineAction({area:'leads',input:z.object({name:z.string(),phone:z.string().optional(),email:z.string().optional(),address:z.string().optional()}).strict(),run:async()=>({slug:'new-lead',redirect:'/leads/new-lead'})})};
 const response=await call('create',{name:'Client',phone:'555',email:'client@example.com',address:'Main St'},owner,actions);
 assert.deepEqual(await response.json(),{ok:true,result:{slug:'new-lead',redirect:'/leads/new-lead'}});
});

test('durable safety request retries run once, report pending and replay completion',async()=>{
 const {safetyOperation}=await import('../lib/mobile-rpc/safety-operation.ts');
 const {randomUUID,createHash}=await import('node:crypto');
 const {rm}=await import('node:fs/promises');
 const id=randomUUID(),user='mobile-test';let calls=0,finish;
 const barrier=new Promise(resolve=>{finish=resolve;});
 const run=async()=>{calls++;await barrier;return {ok:true};};
 const file=`drafts/mobile-safety-operations/${createHash('sha256').update(`${user}:${id}`).digest('hex')}.json`;
 try {
  // Wait until the first operation has entered its callback, after journaling.
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  const first=safetyOperation(user,id,{slug:'test'},async()=>{entered();return run();});
  await ready;
  assert.equal((await safetyOperation(user,id,{slug:'test'},run)).status,'pending');
  finish();const result=await first;
  assert.equal(result.status,'completed');
  assert.deepEqual(await safetyOperation(user,id,{slug:'test'},run),result);
  await assert.rejects(safetyOperation(user,id,{slug:'different'},run),/different report details/);
  assert.equal(calls,1);
 } finally {finish();await rm(file,{force:true});}
});

// Load route/action bodies with controlled dependencies; exercise production branches.
async function isolatedModule(file,names,deps) {
 const {readFile}=await import('node:fs/promises');
 const {stripTypeScriptTypes}=await import('node:module');
 const source=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/^import .*?;\n/gm,'').replace(/^export /gm,'');
 return Function(...Object.keys(deps),stripTypeScriptTypes(source)+`;return {${names.join(',')}};`)(...Object.values(deps));
}
test('mobile file route: inherited job, lead-only, unrelated, restricted and anonymous',async()=>{
 const check=async(user,file,inherited=false,restricted=false)=>{
  const {GET}=await isolatedModule('../app/api/mobile/files/[id]/route.ts',['GET'],{
   getUserFromRequest:async()=>user,hasAccess:(u,area)=>u.permissions.includes(area),
   queryOne:async sql=>sql.includes('sub_documents')?(restricted?{}:null):sql.includes('JOIN leads')?(inherited?{}:null):file,
   serveFile:async()=>new Response('file')});
  return (await GET(new Request('http://local/file'),{params:Promise.resolve({id:'photo'})})).status;
 };
 const file={storage_path:'test',lead_slug:'origin',project_key:null};
 assert.equal(await check({permissions:['leads']},file),200);
 assert.equal(await check({permissions:['projects']},file,true),200);
 assert.equal(await check({permissions:['projects']},file),403);
 assert.equal(await check({permissions:['projects']},file,true,true),403);
 assert.equal(await check(null,file),401);
});
test('failed PDF storage rejects mobile report before incident INSERT; web behavior preserved',async()=>{
 let inserts=0;
 const actions=await isolatedModule('../lib/actions/safety.ts',['createMobileIncidentReport','createIncidentReport'],{
  requireAccess:async()=>({name:'Joe'}),queryOne:async()=>({id:'job',name:'Job'}),
  query:async()=>{inserts++;},ai:{ask:async()=>({answer:'Narrative'})},
  getCompanyDocInfo:async()=>({company:{}}),renderIncidentReportPdf:async()=>Buffer.from('PDF'),
  storeBuffer:async()=>({ok:false,error:'storage failure'}),emit:async()=>{},revalidatePath:()=>{},
  SEVERITY_LABEL:{minor:'Minor'}});
 const form=new FormData();form.set('notes','Test');
 assert.equal((await actions.createMobileIncidentReport('job',form,'123')).ok,false);
 assert.equal(inserts,0);
 assert.equal((await actions.createIncidentReport('job',form)).ok,true);
 assert.equal(inserts,1);
});
test('stranded safety journal reconciles reserved identity, scope and pre-dispatch crash',async()=>{
 const {safetyOperationStatus}=await import('../lib/mobile-rpc/safety-operation.ts');
 const {randomUUID,createHash}=await import('node:crypto');
 const {writeFile,rm,mkdir}=await import('node:fs/promises');
 const id=randomUUID(),user='mobile-test';
 const file=`drafts/mobile-safety-operations/${createHash('sha256').update(`${user}:${id}`).digest('hex')}.json`;
 const journal={fingerprint:'test',slug:'job',pid:2147483647,operation:{requestId:id,status:'pending',result:null,message:'Preparing'}};
 try {
  await mkdir('drafts/mobile-safety-operations',{recursive:true});
  await writeFile(file,JSON.stringify(journal));
  const lookup=async()=>({incidentId:'123',fileId:'pdf'});
  assert.equal((await safetyOperationStatus(user,id,'job',lookup)).reconciliation,'not_started');
  assert.equal(await safetyOperationStatus(user,id,'other',lookup),null);
  assert.equal(await safetyOperationStatus('someone-else',id,'job',lookup),null);
  await writeFile(file,JSON.stringify({...journal,incidentId:'123'}));
  const result=await safetyOperationStatus(user,id,'job',lookup);
  assert.equal(result.status,'completed');assert.equal(result.result.pdfSaved,true);
  assert.equal((await safetyOperationStatus(user,id,'job',async()=>({incidentId:'123',fileId:null}))).result.pdfSaved,false);
  assert.equal((await safetyOperationStatus(user,id,'job',async()=>null)).reconciliation,'needs_review');
  await writeFile(file,'broken');
  assert.equal((await safetyOperationStatus(user,id,'job',lookup)).reconciliation,'needs_review');
 } finally {await rm(file,{force:true});}
});
test('destinations retain query thread, section, focus, view and original fallback',async()=>{
 const {destination,plainNotice,mobileTranscript}=await import('../lib/mobile-rpc/destinations.ts');
 const href='/inbox?thread=abc&view=sent&focus=message';
 assert.deepEqual({...destination(href)}, {type:'thread',id:'abc',slug:null,section:null,focus:'message',view:'sent',key:null,href});
 const job=destination('/projects/job?section=money&focus=invoice:42');
 assert.equal(job.section,'money');assert.equal(job.focus,'invoice:42');
 assert.equal(destination('/leads/a?section=portal').section,'portal');
 assert.equal(destination('/inbox?tab=calls&id=call').type,'call');
 assert.equal(destination('/projects/a?section=unsupported').href,'/projects/a?section=unsupported');
 assert.equal(plainNotice('Missing TELNYX_API_KEY'), 'Texting needs attention. Ask the owner to check the phone service settings.');
 assert.equal(plainNotice('5-day ack by 2026-11-06'),'Acknowledge by Nov 6');
 assert.equal(mobileTranscript('Channel 0: Hi\nChannel 1: Hello','Sam',true),'Sam: Hi\nYou: Hello');
});
test('post-INSERT failure: same-ID retries never insert again; status finds receipt',async()=>{
 const {safetyOperation,safetyOperationStatus}=await import('../lib/mobile-rpc/safety-operation.ts');
 const {randomUUID,createHash}=await import('node:crypto');
 const {rm}=await import('node:fs/promises');
 const user='mobile-test',id=randomUUID(),payload={slug:'job'};
 const file=`drafts/mobile-safety-operations/${createHash('sha256').update(`${user}:${id}`).digest('hex')}.json`;
 let inserts=0;
 const run=async reserve=>{await reserve('456');inserts++;throw new Error('Simulated notification failure after INSERT');};
 try {
  const first=await safetyOperation(user,id,payload,run);
  assert.equal(first.result,null);
  await safetyOperation(user,id,payload,run);await safetyOperation(user,id,payload,run);
  assert.equal(inserts,1);
  const status=await safetyOperationStatus(user,id,'job',async incidentId=>({incidentId,fileId:'pdf'}));
  assert.equal(status.result.incidentId,'456');assert.equal(status.result.pdfSaved,true);
 } finally {await rm(file,{force:true});}
});
