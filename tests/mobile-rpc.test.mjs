import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { isAskFailure } from '../lib/ask-result-codes.ts';
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
 const check=async(user,file,inherited=false,restricted=false,canvasAccess={ordinary:true})=>{
  const {GET}=await isolatedModule('../app/api/mobile/files/[id]/route.ts',['GET'],{
   getUserFromRequest:async()=>user,hasAccess:(u,area)=>u.permissions.includes(area),
   queryOne:async sql=>sql.includes('sub_documents')?(restricted?{}:null):sql.includes('JOIN leads')?(inherited?{}:null):file,
   resolveCanvasFilePolicy:async()=>canvasAccess,canvasSnapshotResponse:async()=>new Response('snapshot'),
   serveFile:async()=>new Response('file')});
  return (await GET(new Request('http://local/file'),{params:Promise.resolve({id:'photo'})})).status;
 };
 const file={storage_path:'test',lead_slug:'origin',project_key:null};
 assert.equal(await check({permissions:['leads']},file),200);
 assert.equal(await check({permissions:['projects']},file,true),200);
 assert.equal(await check({permissions:['projects']},file),403);
 assert.equal(await check({permissions:['projects']},file,true,true),403);
 assert.equal(await check(null,file),401);
 assert.equal(await check({permissions:['projects']},file,false,false,{ordinary:false}),200);
 assert.equal(await check({permissions:['projects']},file,false,false,null),404);
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
 for (const [url,type,id] of [
  ['/inbox/calls/c-1','call','c-1'], ['/inbox/texts/42','sms','42'], ['/inbox/sms/42','sms','42'],
  ['/inbox/chat/r-1','chat','r-1'], ['/inbox?tab=calls&id=c-1','call','c-1'],
  ['/inbox?tab=texts&id=42','sms','42'], ['/inbox?tab=chat&id=r-1','chat','r-1'],
  ['/calls/c-1','call','c-1'], ['/messages/42','sms','42'], ['/chat/r-1','chat','r-1'],
  ['/inbox?tab=chat&room=r-1','chat','r-1'], ['/inbox?tab=chat&roomId=r-1','chat','r-1'],
  ['/inbox?tab=chat&channel=r-1','chat','r-1'], ['/inbox?tab=chat&channelId=r-1','chat','r-1'],
  ['/inbox?tab=calls&callId=c-1','call','c-1'], ['/inbox?tab=texts&smsId=42','sms','42'],
 ]) { const d=destination(url); assert.equal(d.type,type,url); assert.equal(d.id,id,url); }
 assert.equal(plainNotice('Uploaded RECEIPT_SCAN_0042.JPG'),'Uploaded RECEIPT_SCAN_0042.JPG');
 assert.equal(plainNotice('Review KITCHEN_PROFILE.pdf'),'Review KITCHEN_PROFILE.pdf');
 assert.equal(plainNotice('Confirm PURCHASE_ORDER_ID with the vendor'),'Confirm PURCHASE_ORDER_ID with the vendor');
 assert.equal(plainNotice('Missing SMS_API_KEY'),'Texting needs attention. Ask the owner to check the phone service settings.');

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

test('notification title and subline are sanitized together', async () => {
  const { plainNoticePair } = await import('../lib/mobile-rpc/destinations.ts');
  assert.deepEqual(plainNoticePair('Comms configuration failed', 'SMS: missing SMS_API_KEY, SMS_FROM_NUMBER'), { title: 'Texting needs attention', subline: 'Ask the owner to check the phone service settings.' });
  assert.deepEqual(plainNoticePair('Contract signed: Spaeth', 'Chuck Spaeth signed electronically'), { title: 'Contract signed: Spaeth', subline: 'Chuck Spaeth signed electronically' });
});

test('real SMS/call registrations dispatch for Comms staff, refuse other staff before sending', async () => {
 let sends = 0;
 const { commsActions } = await isolatedModule('../lib/mobile-rpc/comms.ts', ['commsActions'], {
  z, defineAction, sendSmsReply: async () => { sends++; return {ok:true}; },
  placeCallAction: async () => { sends++; return {ok:true,callId:'test'}; },
 });
 for (const [name,body] of [['sms.send',{threadId:1,body:'Hello'}],['calls.place',{phone:'6125551234'}]]) {
  assert.equal((await call(name,body,{...staff,permissions:['comms']},commsActions)).status,200);
  assert.equal((await call(name,body,staff,commsActions)).status,403);
 }
 assert.equal(sends,2);
});

test('lead portal registration requires Leads and Projects but permits staff', async () => {
 let sends=0;
 const { MobileInputError } = await import('../lib/mobile-rpc/dispatch.ts');
 const { leadsActions } = await isolatedModule('../lib/mobile-rpc/leads.ts',['leadsActions'],{
  z,defineAction,MobileInputError,hasAccess:(u,area)=>u.role==='owner'||u.permissions.includes(area),
  sendLeadPortalMessage:async()=>{sends++;},
 });
 assert.equal((await call('leads.portalMessage',{slug:'lead',body:'Hello'},{...staff,permissions:['leads','projects']},leadsActions)).status,200);
 assert.equal((await call('leads.portalMessage',{slug:'lead',body:'Hello'},{...staff,permissions:['leads']},leadsActions)).status,400);
 assert.equal((await call('leads.portalMessage',{slug:'lead',body:'Hello'},{...staff,permissions:['projects']},leadsActions)).status,403);
 assert.equal(sends,1);
});

test('me.callPhone normalizes, clears, rejects invalid/unknown fields and scopes writes to caller', async () => {
 const {normalizeE164}=await import('../lib/comms/phone.ts');
 const {callPhoneInput}=await isolatedModule('../lib/mobile-rpc/me.ts',['callPhoneInput'],{z,normalizeE164});
 const writes=[];
 const {POST}=await isolatedModule('../app/api/mobile/rpc/me.callPhone/route.ts',['POST'],{
  getUserFromRequest:async()=>staff,getCurrentUser:async()=>staff,callPhoneInput,
  query:async(...args)=>{writes.push(args);},
 });
 for(const [phone,expected] of [['(612) 555-1234','+16125551234'],[null,null]]) {
  const response=await POST(request({phone}));assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,result:{phone:expected}});
  assert.deepEqual(writes.at(-1)[1],[expected,staff.id]);
 }
 for(const body of [{phone:''},{phone:'123'},{phone:'+441234567890'},{phone:42},{},{phone:null,userId:'owner'}]) assert.equal((await POST(request(body))).status,400);
 assert.equal(writes.length,2);
 const other=await isolatedModule('../app/api/mobile/rpc/me.callPhone/route.ts',['POST'],{
  getUserFromRequest:async()=>staff,getCurrentUser:async()=>owner,callPhoneInput,query:async()=>assert.fail('identity conflict wrote'),
 });
 assert.equal((await other.POST(request({phone:null}))).status,401);
});

test('multipart email passes uploads and reply mode to the same web actions', async () => {
 const sent=[];
 class CommsReadError extends Error {}
 const {POST}=await isolatedModule('../app/api/mobile/inbox/send/route.ts',['POST'],{
  z,CommsReadError,getCurrentUser:async()=>staff,
  commsRead:async(req,area,run)=>{assert.equal(area,'inbox');return Response.json(await run(staff));},
  sendNewEmailAction:async input=>{sent.push(input);return {ok:true};},
  sendReplyAction:async input=>{sent.push(input);return {ok:true};},
 });
 for(const mode of ['new','reply','replyAll']) {
  const data=new FormData();
  for(const [key,value] of Object.entries({mode,threadId:'thread',view:'sent',to:'client@example.com',cc:'other@example.com',subject:'Hello',body:'Attached'})) data.set(key,value);
  data.append('files',new Blob(['PDF'],{type:'application/pdf'}),'note.pdf');
  const response=await POST(new Request('http://local/api/mobile/inbox/send',{method:'POST',body:data}));
  assert.deepEqual(await response.json(),{ok:true});
  const input=sent.at(-1);assert.equal(input.files.get('files').name,'note.pdf');assert.equal(input.cc,'other@example.com');
  if(mode!=='new'){assert.equal(input.threadId,'thread');assert.equal(input.replyAll,mode==='replyAll');}
 }
});

test('call bridge selects caller cell, preserves owner fallback and refuses missing staff cell/own-cell calls', async () => {
 const {readFile}=await import('node:fs/promises');
 const {stripTypeScriptTypes}=await import('node:module');
 const {normalizeE164}=await import('../lib/comms/phone.ts');
 const source=(await readFile(new URL('../lib/voice.ts',import.meta.url),'utf8')).split('export async function placeCall(')[1];
 const body=stripTypeScriptTypes('async function placeCall('+source);
 for(const [role,phone,to,expected] of [
  ['owner',null,'6125559999','+16125550000'],
  ['owner','+16125551111','6125559999','+16125551111'],
  ['staff','+16125552222','6125559999','+16125552222'],
  ['staff',null,'6125559999',null],
  ['staff','+16125552222','6125552222',null],
 ]) {
  let payload,insert,grantChecks=0;
  const deps={outboundNumberFor:async()=>'+16125553333',voiceConfig:()=>({forwardTo:'+16125550000',fromNumber:'+16125553333'}),normalizeE164,
   queryOne:async()=>({phone,role}),checkGrantCovers:async()=>{grantChecks++;return {ok:true};},
   matchPhoneToRecord:async()=>null,randomUUID:()=> 'call',query:async(sql,values)=>{insert=values;},
   withTransaction:async run=>run(()=>{}),enqueueIntent:async(run,input)=>{payload=input;return {intent:{id:'intent'}};},
   flowConfig:()=>({ringSeconds:25}),dispatchIntentsNow:async()=>[{responseClass:'accepted'}],
  };
  const placeCall=Function(...Object.keys(deps),body+';return placeCall;')(...Object.values(deps));
  const result=await placeCall({to,grantId:'grant',actor:role,caller:{id:role,role}});
  assert.equal(result.ok,expected!==null);
  if(expected){assert.equal(payload.payload.to,expected);assert.equal(insert[3],expected);assert.equal(payload.grantId,'grant');assert.equal(grantChecks,1);}
  else {assert.equal(grantChecks,0);assert.equal(payload,undefined);if(!phone)assert.equal(result.error,'Add your cell number in Settings to call from the business line.');}
 }
});

async function operatorRegistry(overrides = {}) {
  const { createOperatorActions } = await isolatedModule('../lib/mobile-rpc/operator.ts', ['createOperatorActions'], {
    z, isAskFailure, askBoundary:async fn=>fn(), defineAction, MobileInputError: (await import('../lib/mobile-rpc/dispatch.ts')).MobileInputError,
    withAskLaunchSource: (source, callback) => { assert.equal(source, "panel_mobile"); overrides.sources?.push(source); return callback(); },
    chat: {}, runs: {}, grants: {}, operatorPageContext: async () => undefined,
    CLAUDE_MODEL_VALUES: ['sonnet', 'opus'], CLAUDE_CONTEXT_VALUES: ['default', '1m'],
    CLAUDE_MODE_VALUES: ['acceptEdits', 'plan'], CLAUDE_EFFORT_OPTIONS: [{value:'default'}, {value:'high'}],
  });
  return createOperatorActions(overrides.chat ?? {}, overrides.runs ?? {}, overrides.grants ?? {}, overrides.context ?? (async () => undefined));
}
const operatorId = '11111111-1111-4111-8111-111111111111';
test('operator dispatcher enforces AI area, owner grants, and staff agent restrictions', async () => {
  let called = 0;
  const actions = await operatorRegistry({chat:{newConversationAction:async()=>{called++;return {ok:true,id:operatorId};}}});
  const aiStaff = {...staff, permissions:['ai']};
  assert.equal((await call('operator.new',{agent:'claude'},staff,actions)).status,403);
  for (const agent of ['qwen','hermes']) assert.equal((await call('operator.new',{agent},aiStaff,actions)).status,400);
  assert.equal((await call('operator.approveGrant',{id:operatorId},aiStaff,actions)).status,403);
  assert.equal((await call('operator.send',{id:operatorId,prompt:'Send',allowSends:true},aiStaff,actions)).status,400);
  assert.equal(called,0);
  const response = await call('operator.new',{agent:'claude'},aiStaff,actions);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,result:{conversationId:operatorId,context:null,options:null}});
});
test('operator poll preserves terminal errors and replacement runs through the dispatcher',async()=>{
  const poll={ok:false,error:'Stopped',nextRunId:operatorId,steers:[]};
  const actions=await operatorRegistry({runs:{pollAgentRun:async id=>{assert.equal(id,operatorId);return poll;}}});
  const response=await call('operator.poll',{runId:operatorId},owner,actions);
  assert.deepEqual(await response.json(),{ok:true,result:{poll}});
});
test('operator send forwards context, options, attachments and express permission to the web action',async()=>{
  let received;
  const context={type:'project',slug:'kitchen'};
  const options={model:'opus',mode:'plan'};
  const attachments=[{name:'plan.pdf',path:'/uploads/plan.pdf'}];
  const sources=[];
  const actions=await operatorRegistry({sources,chat:{sendMessageAction:async(...args)=>{received=args;return {ok:true,kind:'pending',runId:operatorId,userMessageId:operatorId};}},context:async(c,u)=>{assert.deepEqual(c,context);assert.equal(u,owner);return 'Web page context';}});
  const response=await call('operator.send',{id:operatorId,prompt:'Review',context,options,attachments,allowSends:true},owner,actions);
  assert.equal(response.status,200);
  assert.deepEqual(received,[operatorId,'Review','Web page context',options,attachments,undefined,true]);
  assert.deepEqual(sources,['panel_mobile']);
});
test('operator conversation read returns a typed unavailable result for an unknown thread',async()=>{
  const {operatorConversation}=await isolatedModule('../lib/mobile-rpc/operator-reads.ts',['operatorConversation'],{z,isAskFailure,chat:{loadConversationAction:async()=>({ok:false,code:'THREAD_UNAVAILABLE'})}});
  assert.deepEqual(await operatorConversation(operatorId),{ok:false,code:'THREAD_UNAVAILABLE'});
});
test('operator read authentication rejects conflicting cookie identity and non-AI viewers',async()=>{
  const {MobileInputError}=await import('../lib/mobile-rpc/dispatch.ts');
  const check=async(bearer,cookie)=>{
    let loaded=false;
    const {mobileOperatorRead}=await isolatedModule('../lib/mobile-rpc/operator-reads.ts',['mobileOperatorRead'],{z,isAskFailure,askBoundary:async fn=>fn(),MobileInputError,getUserFromRequest:async()=>bearer,getCurrentUser:async()=>cookie,hasAccess:u=>u.role==='owner'||u.permissions.includes('ai')});
    const response=await mobileOperatorRead(new Request('http://local'),false,async()=>{loaded=true;return {value:'read'};});
    return {status:response.status,loaded};
  };
  assert.deepEqual(await check(owner,{...owner,id:'different'}),{status:401,loaded:false});
  assert.deepEqual(await check(null,null),{status:401,loaded:false});
  assert.deepEqual(await check(staff,staff),{status:403,loaded:false});
  const aiStaff={...staff,permissions:['ai']};
  assert.deepEqual(await check(aiStaff,aiStaff),{status:200,loaded:true});
});

test('operator delete requires and forwards a stable client operation UUID',async()=>{
 const received=[];const operationId='22222222-2222-4222-8222-222222222222';
 const actions=await operatorRegistry({chat:{deleteConversationAction:async(...args)=>{received.push(args);return {ok:true,state:'pending'};}}});
 assert.equal((await call('operator.delete',{id:operatorId},owner,actions)).status,400);
 for(let i=0;i<2;i++)assert.equal((await call('operator.delete',{id:operatorId,operationId},owner,actions)).status,200);
 assert.deepEqual(received,[[operatorId,operationId],[operatorId,operationId]]);
});
test('operator typed failures stay fixed top-level JSON, never generic 500 or nested success',async()=>{
 for(const code of ['ASK_PAUSED','THREAD_UNAVAILABLE','SIGN_IN_AGAIN','CHAT_OFF','DELETE_NOT_READY']){
  const actions=await operatorRegistry({runs:{pollAgentRun:async()=>({ok:false,code})}});
  const response=await call('operator.poll',{runId:operatorId},owner,actions);assert.equal(response.status,code==='ASK_PAUSED'?503:code==='SIGN_IN_AGAIN'?401:code==='CHAT_OFF'?403:409);assert.deepEqual(await response.json(),{ok:false,code});
 }
});
