import test from 'node:test';
import assert from 'node:assert/strict';
import {readOperatingDoc,operatingManifest,createContextAdapter,validateQuestionResponse} from '../lib/ask-context-inputs.mjs';
import {CLASSIFICATION_REGISTRY,assertEveryToolClassified,classifyToolAreas} from '../lib/canvas-classification.mjs';
// Fresh counterexamples: canonical identities only, no filesystem aliases,
// failed transport/persistence never releases data, answers use stored labels.
for(const id of ['../AGENTS.md','/etc/passwd','%2e%2e/README.md','README.md/..','./README.md','README.md%00','README.md\\x','status/../README.md','credentials-inventory.md','constructor'])test(`canonical reader refuses ${id}`,async()=>{await assert.rejects(readOperatingDoc(id));});
test('manifest exact bytes and bounded source',async()=>{const id=Object.keys(operatingManifest)[0];const r=await readOperatingDoc(id);assert.equal(r.source_hash,operatingManifest[id].sha256);assert.ok(Buffer.byteLength(r.text)<=262144);});
for(const kind of ['http','bare','misconstructed','failed-begin','failed-complete'])test(`closed context ${kind}`,async()=>{
 let calls=0;const env={SJC_RUN_ID:crypto.randomUUID(),SJC_CONVERSATION_ID:crypto.randomUUID(),SJC_PRINCIPAL_USER_ID:crypto.randomUUID(),SJC_RUN_PROFILE:'business',SJC_RUN_STARTED_S:'1'};
 const a=createContextAdapter({transportKind:kind==='http'?'http':'stdio',env:kind==='bare'?{}:env,httpActive:()=>kind==='misconstructed',internalCall:async()=>{calls++;if(kind==='failed-complete'&&calls===1)return {ok:true,id:crypto.randomUUID()};throw Error('storage unavailable');}});
 if(kind==='failed-complete'){const id=await a.begin('tool','read_operating_doc');await assert.rejects(a.complete(id,{private:'withheld'}));}else await assert.rejects(a.begin('tool','read_operating_doc'));if(['http','bare','misconstructed'].includes(kind))assert.equal(calls,0);
});
const payload={questions:[{question:'Which?',options:[{label:'One'},{label:'Two'}],multiSelect:false,allowOther:true}]};
for(const response of [{kind:'question',answers:[{question:'forged',choices:['EVIL']}]},{kind:'question',answers:[{question:'forged',choices:['One','Two']}]},{kind:'permission',decision:'allow'},{kind:'question',answers:[],extra:'secret'},{kind:'question',answers:[{choices:['One'],extra:'secret'}]}])test(`question rejects forged response ${JSON.stringify(response)}`,()=>assert.throws(()=>validateQuestionResponse(payload,response)));
test('question reconstructs text, free text is unknown, options are control',()=>{const r=validateQuestionResponse(payload,{kind:'question',answers:[{question:'forged',choices:['One']}]});assert.equal(r.response.answers[0].question,'Which?');assert.equal(r.complete,true);assert.equal(validateQuestionResponse(payload,{kind:'question',answers:[{choices:[],other:'business facts'}]}).complete,false);});
test('unknown tool and variants are incomplete/full catalog',()=>{assert.equal(classifyToolAreas('not_registered',CLASSIFICATION_REGISTRY).complete,false);assert.equal(classifyToolAreas('get_project',CLASSIFICATION_REGISTRY,'unknown').complete,false);assert.throws(()=>assertEveryToolClassified(['new_tool'],CLASSIFICATION_REGISTRY));});

import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
import {appHooks,seedPeople} from './phase0a-fixtures.mjs';
appHooks();
test('real website adapter and actual sjcos wrappers: staff positive, pending fence, exact question reply, sticky free text',()=>withTestDb(async(url,admin)=>{
 const p=await seedPeople(admin);
 const {admitEpoch,hashBytes}=await import('../lib/ask-context-inputs.mjs');
 const {conversationProvenance}=await import('../lib/ask-context-provenance.mjs');
 await withSessionIdentity(url,'sjcos_test_website',async db=>{
  globalThis.__phase0aDb=db;
  await db.query(`UPDATE users SET permissions=ARRAY['ai','projects'] WHERE id=$1`,[p.staff.id]);
  const thread=(await db.query(`INSERT INTO ai_conversations(agent,owner_user_id) VALUES('claude',$1) RETURNING id`,[p.staff.id])).rows[0].id;
  await db.query(`INSERT INTO ai_messages(conversation_id,role,body) VALUES($1,'user','Show permit steps.')`,[thread]);
  const run=(await db.query(`INSERT INTO dev_agent_runs(prompt,profile,principal_user_id,conversation_id,launch_source,with_mcp) VALUES('Show permit steps.','business',$1,$2,'panel_web',true) RETURNING *,extract(epoch FROM created_at)::bigint AS started`,[p.staff.id,thread])).rows[0];
  await db.query('BEGIN');await admitEpoch({client:db,threadId:thread,runId:run.id,policyHash:hashBytes('tested-policy'),valid:true,resumed:false});await db.query('COMMIT');
  Object.assign(process.env,{SJC_CANVAS_ENABLED:'1',CRON_SECRET:'c1prov-only-secret',DATABASE_URL_AGENT:url,SJC_DB_LOGIN:'agent',SJC_RUN_ID:run.id,SJC_CONVERSATION_ID:thread,SJC_PRINCIPAL_USER_ID:p.staff.id,SJC_RUN_PROFILE:'business',SJC_RUN_STARTED_S:String(run.started)});
  await db.query(`INSERT INTO app_settings(key,value) VALUES('canvas.diagrams_enabled','true'),('canvas.staff_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'`);
  const route=await import('../app/api/internal/ask-context-provenance/route.ts');
  const canvas=await import('../app/api/internal/canvas/route.ts');
  const {interactionCommand}=await import('../lib/ask-thread-journal-interactions.mjs');
  const {pool}=await import('@/lib/db');
  const realFetch=globalThis.fetch;
  let onQuestionCreated=async()=>{};
  globalThis.fetch=async(url,opts)=>{
   const req=new Request(url,opts),pathname=new URL(url).pathname;
   if(pathname==='/api/internal/ask-context-provenance')return route.POST(req);
   if(pathname==='/api/internal/canvas')return canvas.POST(req);
   if(pathname==='/api/internal/ask-interactions'){const b=JSON.parse(opts.body);const r=await interactionCommand(pool,b.action,b.input,b.context);if(b.action==='create'&&b.input.kind==='question')await onQuestionCreated(r.id);return Response.json(r);}
   throw Error('Unexpected outbound request');
  };
  let server;
  try{
   const {buildServer}=await import('../mcp/sjcos-mcp.mjs');server=buildServer({transportKind:'stdio'});
   const call=async(name,args)=>server._registeredTools[name].handler(args,{});
   const doc=await call('read_operating_doc',{id:'README.md'});assert.ok(!doc.isError);
   assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
   const show=()=>({request_id:crypto.randomUUID(),title:'Permit',summary:'Steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}});
   const made=await call('show_canvas',show());assert.ok(!made.isError,JSON.stringify(made));
   const stored=(await db.query('SELECT * FROM ask_canvas_versions WHERE conversation_id=$1',[thread])).rows[0];assert.equal(stored.provenance_complete,true);assert.deepEqual(stored.baseline_areas,[]);
   const adapter=createContextAdapter({transportKind:'stdio',internalCall:async(path,b)=>{const res=await route.POST(new Request('http://internal'+path,{method:'POST',headers:{authorization:'Bearer c1prov-only-secret','content-type':'application/json'},body:JSON.stringify(b)}));return res.json();}});
   const pending=await adapter.begin('tool','ask_owner');
   assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,false);
   const blocked=await call('show_canvas',show());assert.equal(blocked.isError,true);assert.equal(JSON.parse(blocked.content[0].text).code,'CONTEXT_PROVENANCE_INCOMPLETE');
   await adapter.complete(pending,{ok:true,answer:'fixed control'});
   const ctx={transport:'runner_stdio',run_id:run.id,conversation_id:thread,principal_user_id:p.staff.id,run_profile:'business',run_started_s:Number(run.started)};
   const interaction=crypto.randomUUID();await interactionCommand(pool,'create',{id:interaction,kind:'question',payload},ctx);
   const {answerInteraction}=await import('../lib/agent-interactions.ts');const {encrypt}=await import('../lib/session.ts');const token=await encrypt({userId:p.staff.id,role:'staff',authAt:Math.floor(Date.now()/1000)});globalThis.__phase0aCookies={get:()=>({value:token})};
   await answerInteraction(interaction,{kind:'question',answers:[{question:'forged echo',choices:['One']}]});
   const fixed=await adapter.question(interaction);assert.equal(fixed.answer,"Which?\nJoe's answer: One");assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
   for(const status of ['answered','dismissed','expired']){
    onQuestionCreated=async id=>{if(status==='answered')await answerInteraction(id,{kind:'question',answers:[{question:'forged echo',choices:['Two']}]});else await db.query('UPDATE agent_interactions SET status=$2 WHERE id=$1',[id,status]);};
    const actual=await call('ask_owner',{questions:[{question:'Which?',options:[{label:'One'},{label:'Two'}]}],timeout_seconds:30});
    assert.ok(!actual.isError);const delivered=JSON.parse(actual.content[0].text);
    if(status==='answered')assert.equal(delivered.answer,"Which?\nJoe's answer: Two");else assert.equal(delivered.ok,false);
    assert.equal((await conversationProvenance({client:db,threadId:thread})).complete,true);
   }
   onQuestionCreated=async()=>{};
   const other=crypto.randomUUID();await interactionCommand(pool,'create',{id:other,kind:'question',payload},ctx);
   await answerInteraction(other,{kind:'question',answers:[{question:'ignored',choices:[],other:'unclassified financial facts'}]});
   // Unknown already durable at answer storage, before the asking process polls.
   assert.equal((await conversationProvenance({client:db,threadId:thread})).areas,null);
   assert.match((await adapter.question(other)).answer,/unclassified financial facts/);
   const refused=await call('show_canvas',show());assert.equal(refused.isError,true);
   await db.query(`UPDATE users SET active=false WHERE id=$1`,[p.staff.id]);
   await assert.rejects(adapter.begin('tool','get_project'));
  }finally{globalThis.fetch=realFetch;await server?.close();}
 });
}));

test('actual MCP stdio background admission permits only canonical docs and refuses private readers/canvas',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const transport=new StdioClientTransport({command:process.execPath,args:['mcp/sjcos-mcp.mjs'],env:{PATH:process.env.PATH,HOME:process.env.HOME,MCP_HTTP_PORT:'0',DATABASE_URL_AGENT:'postgresql://invalid/unused',SJC_DB_LOGIN:'agent',SJC_RUN_PROFILE:'business',SJC_LAUNCH_SOURCE:'background',SJC_PRINCIPAL_USER_ID:'',SJC_CONVERSATION_ID:'',SJC_RUN_ID:'',CRON_SECRET:'test-only',APP_INTERNAL_URL:'http://127.0.0.1:1'},stderr:'pipe'});
 const client=new Client({name:'c1prov-test',version:'1'});
 try{
  await client.connect(transport);
  const list=await client.listTools();assertEveryToolClassified(list.tools.map(t=>t.name),CLASSIFICATION_REGISTRY);assert.equal(list.tools.length,285);
  const docs=await client.callTool({name:'read_operating_doc',arguments:{id:'README.md'}});assert.ok(!docs.isError);assert.equal(JSON.parse(docs.content[0].text).source_hash,operatingManifest['README.md'].sha256);
  for(const [name,args] of [['read_chat_attachment',{id:crypto.randomUUID()}],['get_canvas',{canvas_id:crypto.randomUUID()}]])assert.equal((await client.callTool({name,arguments:args})).isError,true);
 }finally{await client.close();await transport.close();}
});
