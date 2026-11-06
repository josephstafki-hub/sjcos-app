import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPrivateBridgeContext} from './ask-private-transport.mjs';
import {withPrivateRunner} from './ask-private-bridge.mjs';
import {CONTENT_AREAS,CLASSIFICATION_REGISTRY,classifyToolAreas} from './canvas-classification.mjs';
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const MAX_READER_BYTES=262144;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs/automation-reliability');
// Approved immutable deployment snapshots. Updating a document requires an explicit
// manifest review/version change; filename, actor and model labels prove nothing.
export const operatingManifest=Object.freeze({
  "DESIGN.md": {
    "version": 1,
    "sha256": "dc9c84c25b0fc9e7b5fc77ed67b37f3522c8071bc5c2179b91b895ff2986001c"
  },
  "BUILD.md": {
    "version": 1,
    "sha256": "c7c14e32ade1d62cea69278342f14fc3fe3b1f353b2968ba2319dba7e1ae2791"
  },
  "STATUS.md": {
    "version": 1,
    "sha256": "e0db7f654805d7e465d8fe924c2f471b28fdf4ef87bb0fcc2f75da5e85d09e3d"
  },
  "README.md": {
    "version": 1,
    "sha256": "e82807497583a592d273860667d7cb6da2842c2213fc3fbd52592f671bf0b158"
  },
  "WORKFLOW.md": {
    "version": 1,
    "sha256": "bac58aa6712ce1bed88a7aa20870843c47ea3c8f447a348172b1a090532984a9"
  },
  "AGENT_HANDOFF.md": {
    "version": 1,
    "sha256": "1286a6e5956a3e3f756ae67f1bd3ce1e3caf1ac96ce5751ae2fd3cbde033dac3"
  },
  "agents-md-migration.md": {
    "version": 1,
    "sha256": "4b1eb7de9aec7fa876e1b07611312ffcbd17943eb65d2e88dbd378811d2d9690"
  },
  "monitoring.md": {
    "version": 1,
    "sha256": "0ca08f53d062cc9372697729c9bf4bbb6e5c5b650e48d0d1c81488a7d68b8041"
  },
  "OPERATING_AGENTS.md": {
    "version": 1,
    "sha256": "5c732c31a7291dcd168d919689417f7c8fa20e8f5f638baad0502545ac68da31"
  },
  "DECISIONS.md": {
    "version": 1,
    "sha256": "ef9eb43458ba9f0dd7e389b3ba072dcfaedd44163254919be011f88f3fc5c696"
  },
  "VALIDATION.md": {
    "version": 1,
    "sha256": "e49128db9e386ba337f55f2b7a60b60c87cd5f0c4a0321d59601bee1b923395c"
  },
  "INTEGRATIONS.md": {
    "version": 1,
    "sha256": "6608f905103618a460e5921b0a57288428cd322c8037da7c52184382587795e9"
  },
  "OWNER_TIME_TRACKING.md": {
    "version": 1,
    "sha256": "f521364806fc4855b3c91c1357e553047a82e68664f672f729c31d5798041be7"
  },
  "TASKS.md": {
    "version": 1,
    "sha256": "91cf3ff96166991dfa864f36f59b320a52f1b1c97f07dfde2ea4e0e7f84d961b"
  }
});
// Fixed allocation: a concurrent grow cannot turn readFile into an unbounded read.
async function readBounded(file,size){
 const buffer=Buffer.alloc(size+1);let offset=0;
 while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
 if(offset!==size)throw Error('INPUT_UNAVAILABLE');return buffer.subarray(0,offset);
}
async function lock(client,threadId){
 const r=await client.query('SELECT id FROM ai_conversations WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[threadId]);
 if(!r.rows.length)throw Error('RUN_CONTEXT_REQUIRED');
}
export async function beginInput({client,threadId,runId=null,kind,ref,id=randomUUID()}){
 await lock(client,threadId);
 await client.query(`INSERT INTO ask_context_inputs(id,conversation_id,run_id,kind,ref) VALUES($1,$2,$3,$4,$5)`,[id,threadId,runId,kind,ref]);
 await client.query('UPDATE ask_context_provenance SET revision=revision+1,updated_at=now() WHERE conversation_id=$1',[threadId]);
 return id;
}
export async function completeInput({client,threadId,runId=null,id,bytes,areas,complete,sourceHash=null,facts={}}){
 await lock(client,threadId);
 const row=(await client.query('SELECT * FROM ask_context_inputs WHERE id=$1 AND conversation_id=$2 AND run_id IS NOT DISTINCT FROM $3 FOR UPDATE',[id,threadId,runId])).rows[0];
 if(!row)throw Error('RUN_CONTEXT_REQUIRED');
 const outputHash=hashBytes(bytes),safe=complete===true&&Array.isArray(areas)&&areas.every(a=>CONTENT_AREAS.includes(a));
 const finalAreas=safe?[...new Set(areas)].sort():[...CONTENT_AREAS].sort();
 if(row.state==='resolved'){
  if(row.output_hash!==outputHash||row.complete!==safe||JSON.stringify([...row.areas].sort())!==JSON.stringify(finalAreas)||row.source_hash!==sourceHash||JSON.stringify(row.facts)!==JSON.stringify(facts))throw Error('INPUT_CONFLICT');
  return;
 }
 await client.query(`UPDATE ask_context_inputs SET state='resolved',complete=$2,areas=$3,source_hash=$4,output_hash=$5,facts=$6::jsonb WHERE id=$1`,[id,safe,finalAreas,sourceHash,outputHash,JSON.stringify(facts)]);
 await client.query('UPDATE ask_context_provenance SET revision=revision+1,unknown=unknown OR $2,updated_at=now() WHERE conversation_id=$1',[threadId,!safe]);
}
export async function admitEpoch({client,threadId,runId,policyHash,valid,resumed}){
 await lock(client,threadId);
 // Every previous business epoch must have a committed policy record. A fresh
 // process can continue verified history; arbitrary resumed CLI state cannot.
 const gaps=(await client.query(`SELECT r.id FROM dev_agent_runs r WHERE r.conversation_id=$1 AND r.id<>$2 AND
 (r.profile<>'business' OR NOT r.with_mcp OR r.launch_source NOT IN ('panel_web','panel_mobile','panel_voice') OR
 r.principal_user_id IS DISTINCT FROM (SELECT principal_user_id FROM dev_agent_runs WHERE id=$2) OR
 NOT EXISTS(SELECT 1 FROM ask_context_inputs i WHERE i.conversation_id=$1 AND i.run_id=r.id AND i.kind='prompt' AND i.complete AND i.output_hash=encode(sha256(convert_to(r.prompt,'UTF8')),'hex')) OR
 NOT EXISTS(SELECT 1 FROM ask_context_inputs i WHERE i.conversation_id=$1 AND i.run_id=r.id AND i.kind='delivery' AND i.complete AND i.output_hash IS NOT NULL) OR
 NOT EXISTS(SELECT 1 FROM ask_context_inputs i WHERE i.conversation_id=$1 AND i.run_id=r.id AND i.kind='epoch' AND i.complete AND i.state='resolved' AND i.output_hash IS NOT NULL)) LIMIT 1`,[threadId,runId])).rows.length;
 const badMessages=(await client.query(`SELECT m.id FROM ai_messages m LEFT JOIN ask_context_inputs i ON i.conversation_id=m.conversation_id AND i.kind='ai_messages' AND i.ref=m.id::text
 WHERE m.conversation_id=$1 AND (i.id IS NULL OR i.output_hash IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')) LIMIT 1`,[threadId])).rows.length;
 const recorded=(await client.query("SELECT output_hash FROM ask_context_inputs WHERE conversation_id=$1 AND kind='epoch' AND ref=$2",[threadId,runId])).rows[0];
 const safe=valid===true&&!resumed&&!gaps&&!badMessages&&(!recorded||recorded.output_hash===hashBytes(policyHash));
 await client.query(`UPDATE ask_context_provenance SET epoch_run_id=$2,policy_hash=$3,unknown=unknown OR $4,revision=revision+1,updated_at=now() WHERE conversation_id=$1`,[threadId,runId,policyHash,!safe]);
 const existing=(await client.query("SELECT id FROM ask_context_inputs WHERE conversation_id=$1 AND kind='epoch' AND ref=$2",[threadId,runId])).rows[0];
 if(!existing){const id=await beginInput({client,threadId,runId,kind:'epoch',ref:runId});await completeInput({client,threadId,runId,id,bytes:policyHash,areas:safe?[]:null,complete:safe,facts:{policy_hash:policyHash}});}

}
export async function readOperatingDoc(id){
 if(typeof id!=='string'||!Object.hasOwn(operatingManifest,id)||id.split('/').some(p=>!p||p==='.'||p==='..')||/[\\%\0]/.test(id))throw Error('INPUT_UNAVAILABLE');
 if((await realpath(root))!==root)throw Error('INPUT_UNAVAILABLE');
 let cursor=root;
 for(const part of id.split('/')){cursor=path.join(cursor,part);const s=await lstat(cursor);if(s.isSymbolicLink())throw Error('INPUT_UNAVAILABLE');}
 const file=await open(cursor,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();if(!before.isFile()||before.nlink!==1||before.size>MAX_READER_BYTES)throw Error('INPUT_UNAVAILABLE');
  const bytes=await readBounded(file,before.size);const after=await file.stat();
  if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||bytes.length!==before.size||hashBytes(bytes)!==operatingManifest[id].sha256)throw Error('INPUT_UNAVAILABLE');
  // Check every ancestor again: an opened descriptor alone doesn't attest root.
  if((await realpath(cursor))!==cursor)throw Error('INPUT_UNAVAILABLE');
  return {id,version:operatingManifest[id].version,text:bytes.toString('utf8'),source_hash:hashBytes(bytes),start:0,end:bytes.length};
 }finally{await file.close();}
}
/** Closed stdio transport. Never uses principalPayload/HTTP claimed tags. */
export function createContextAdapter({transportKind,env=process.env,httpActive=()=>false,internalCall,trackingAvailable=async()=>true}){
 const captured=createPrivateBridgeContext({transportKind,env,httpActive});
 let poisoned=false,installed=false;
 async function send(action,input){const context=captured();if(!context)throw Error('RUN_CONTEXT_REQUIRED');const r=await internalCall('/api/internal/ask-context-provenance',{action,input,context});if(!r?.ok)throw Error('CONTEXT_PROVENANCE_INCOMPLETE');return r;}
 async function call(action,input){
  if(poisoned)throw Error('CONTEXT_PROVENANCE_INCOMPLETE');
  try{return await send(action,input);}catch(e){
   poisoned=true;
   // No data work or future delivery after a storage/transport gap. If the
   // service is reachable, leave a durable unresolved failure marker too.
   if(captured())try{await send('begin',{kind:'tool',ref:'tracking_failure'});}catch{}
   throw e;
  }
 }

 return Object.freeze({
  active:()=>!!captured(),
  enabled:async()=>{if(!captured())return false;const available=await trackingAvailable();if(installed&&!available)throw Error('CONTEXT_PROVENANCE_INCOMPLETE');installed||=available;return available;},
  async begin(kind,ref){return (await call('begin',{kind,ref})).id;},
  async complete(id,result){return call('complete',{id,result});},
  async read(action,input){return (await call(action,input)).result;},
  async question(id){return (await call('question',{id})).result;},
 });
}
export function validateQuestionResponse(payload,response){
 if(!response||response.kind!=='question'||Object.keys(response).some(k=>!['kind','answers'].includes(k))||!Array.isArray(response.answers)||response.answers.length!==payload.questions.length)throw Error('INVALID_INPUT');
 let complete=true;
 const answers=payload.questions.map((q,i)=>{
  const a=response.answers[i];if(!a||Object.keys(a).some(k=>!['question','choices','other'].includes(k))||!Array.isArray(a.choices)||a.choices.some(c=>!q.options.some(o=>o.label===c))||new Set(a.choices).size!==a.choices.length||(!q.multiSelect&&a.choices.length>1)||('other'in a&&(typeof a.other!=='string'||a.other.length>8000||!q.allowOther)))throw Error('INVALID_INPUT');
  if(a.other)complete=false;
  return {question:q.question,choices:q.options.filter(o=>a.choices.includes(o.label)).map(o=>o.label),...(a.other?{other:a.other}:{})};
 });
 return {response:{kind:'question',answers},complete};
}
export function formatQuestionResult(row){
 if(row.status!=='answered')return {ok:false,answer:row.status==='dismissed'?'Joe dismissed the question without answering. Proceed with your best judgment and clearly state what you assumed.':"Joe didn't answer in time. Proceed with your best judgment, clearly state what you assumed, and do NOT take any client-facing/irreversible action you were unsure about."};
 const {response}=validateQuestionResponse(row.payload,row.response);
 return {ok:true,answer:response.answers.map(a=>`${a.question}\nJoe's answer: ${a.choices.length?a.choices.join(' + '):'(no option picked)'}${a.other?` — Joe added: "${a.other}"`:''}`).join('\n\n')};
}
async function transaction(pool,fn){const db=pool.connect?await pool.connect():pool;try{await db.query('BEGIN');const r=await fn(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}finally{if(db!==pool)db.release();}}
export async function contextCommand(pool,action,input,context,options){
 return withPrivateRunner(pool,context,()=>transaction(pool,async client=>{
  const threadId=context.conversation_id,runId=context.run_id;await lock(client,threadId);
  const run=(await client.query('SELECT agent,with_mcp FROM dev_agent_runs WHERE id=$1',[runId])).rows[0];
  if(run?.agent!=='claude'||!run.with_mcp)throw Error('RUN_CONTEXT_REQUIRED');
  if(action==='begin')return {ok:true,id:await beginInput({client,threadId,runId,kind:input.kind,ref:`${input.ref}:${randomUUID()}`})};
  if(action==='complete'){
   const row=(await client.query('SELECT kind,ref FROM ask_context_inputs WHERE id=$1 AND run_id=$2 AND conversation_id=$3',[input.id,runId,threadId])).rows[0];if(!row)throw Error('RUN_CONTEXT_REQUIRED');
   // Only server registry can establish classification. Transport doesn't accept areas.
   const classification=row.kind==='tool'?classifyToolAreas(row.ref.split(':')[0],CLASSIFICATION_REGISTRY):{complete:false,areas:null};
   await completeInput({client,threadId,runId,id:input.id,bytes:JSON.stringify(input.result),...classification});return {ok:true};
  }
  if(action==='question'){
   const row=(await client.query('SELECT * FROM agent_interactions WHERE id=$1 AND run_id=$2 AND conversation_id=$3 FOR UPDATE',[input.id,runId,threadId])).rows[0];
   if(!row||row.status==='pending')throw Error('RUN_CONTEXT_REQUIRED');
   let result,complete=true;
   if(row.kind==='question'){result=formatQuestionResult(row);if(row.status==='answered')complete=validateQuestionResponse(row.payload,row.response).complete;}
   else {const r=row.response??{};if(row.status==='answered'&&(r.kind!=='permission'||!['allow','deny'].includes(r.decision)||Object.keys(r).some(k=>!['kind','decision','note'].includes(k))))throw Error('INVALID_INPUT');result={response:r,status:row.status};complete=!r.note;}
   const ref=`answer:${row.id}`,existing=(await client.query('SELECT id FROM ask_context_inputs WHERE conversation_id=$1 AND kind=$2 AND ref=$3',[threadId,'question',ref])).rows[0];
   const id=existing?.id??await beginInput({client,threadId,runId,kind:'question',ref});
   await completeInput({client,threadId,runId,id,bytes:JSON.stringify(result),areas:complete?[]:null,complete});
   return {ok:true,result};
  }
  throw Error('INVALID_INPUT');
 }),options);
}
/** Shared canonical reader used by admitted panel and unattended stdio. */
export async function operatingRead(action,input){
 let result;
 if(action==='read_operating_doc')result=await readOperatingDoc(input.id);
 else {
  if(action==='search_operating_docs'&&(typeof input.query!=='string'||!input.query.length||input.query.length>256))throw Error('INVALID_INPUT');
  const docs=[];
  for(const id of Object.keys(operatingManifest).sort()){
   const doc=await readOperatingDoc(id);
   if(action==='list_operating_docs')docs.push({id,version:doc.version,source_hash:doc.source_hash});
   else if(action==='search_operating_docs'){
    const index=doc.text.toLowerCase().indexOf(input.query.toLowerCase());
    if(index>=0)docs.push({id,version:doc.version,source_hash:doc.source_hash,start:Buffer.byteLength(doc.text.slice(0,index)),text:doc.text.slice(Math.max(0,index-100),index+400),query_hash:hashBytes(input.query)});
   }else throw Error('INVALID_INPUT');
   if(docs.length===20)break;
  }
  result={documents:docs};
 }
 if(Buffer.byteLength(JSON.stringify(result))>MAX_READER_BYTES)throw Error('INPUT_TOO_LARGE');
 return result;
}
export async function readPinnedAttachment(client,threadId,runId,id){
 // IDs refer to a server-pinned message generation, never a model path/hash.
 const row=(await client.query(`SELECT i.* FROM ask_context_inputs i JOIN ai_messages m ON m.id::text=split_part(i.ref,':',1) AND m.conversation_id=i.conversation_id WHERE i.id=$1 AND i.conversation_id=$2 AND i.kind='attachment'`,[id,threadId])).rows[0];
 if(!row)throw Error('INPUT_UNAVAILABLE');
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../uploads/ai-chat');
 const file=row.facts.path;
 if(typeof file!=='string'||!file.startsWith(base+path.sep)||(await realpath(file))!==file)throw Error('INPUT_UNAVAILABLE');
 let cur=path.parse(file).root;for(const part of file.slice(cur.length).split(path.sep)){cur=path.join(cur,part);if((await lstat(cur)).isSymbolicLink())throw Error('INPUT_UNAVAILABLE');}
 const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();if(!s.isFile()||s.nlink!==1||s.size>25*1024*1024||s.size!==row.facts.size)throw Error('INPUT_UNAVAILABLE');
  const bytes=await readBounded(f,s.size),after=await f.stat();
  if(hashBytes(bytes)!==row.source_hash||s.mtimeMs!==after.mtimeMs||s.ctimeMs!==after.ctimeMs)throw Error('INPUT_UNAVAILABLE');
  if(bytes.length>MAX_READER_BYTES||bytes.includes(0)||!Buffer.from(bytes.toString('utf8')).equals(bytes))throw Error('UNSUPPORTED_EXTRACTION');
  return {attachment_id:id,generation:row.source_hash,text:bytes.toString('utf8')};
 }finally{await f.close();}
}
export async function pinAttachments(pool,threadId,runId,messageId,files){
 const out=[];
 for(let index=0;index<files.length;index++){
  const file=files[index];
  const id=await transaction(pool,client=>beginInput({client,threadId,runId,kind:'attachment',ref:`${messageId}:${index}`}));
  // No DB locks during filesystem work; a failure leaves the durable marker.
  const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../uploads/ai-chat');
  if(!file.path.startsWith(base+path.sep)||(await realpath(file.path))!==file.path)throw Error('INPUT_UNAVAILABLE');
  const f=await open(file.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const before=await f.stat();if(!before.isFile()||before.nlink!==1||before.size>25*1024*1024)throw Error('INPUT_UNAVAILABLE');
   const bytes=await readBounded(f,before.size),after=await f.stat();
   if(before.size!==bytes.length||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('INPUT_UNAVAILABLE');
   const generation=hashBytes(bytes);
   await transaction(pool,client=>completeInput({client,threadId,runId,id,bytes:'attachment available',sourceHash:generation,areas:null,complete:false,facts:{path:file.path,size:bytes.length}}));
   out.push({id,generation});
  }finally{await f.close();}
 }return out;
}
export async function readerCommand(pool,action,input,context,options){
 let id;
 await withPrivateRunner(pool,context,()=>transaction(pool,async client=>{const run=(await client.query('SELECT agent,with_mcp FROM dev_agent_runs WHERE id=$1',[context.run_id])).rows[0];if(run?.agent!=='claude'||!run.with_mcp)throw Error('RUN_CONTEXT_REQUIRED');id=await beginInput({client,threadId:context.conversation_id,runId:context.run_id,kind:'reader',ref:`${action}:${randomUUID()}`});}),options);
 let result,known=true;
 try{result=action==='read_chat_attachment'?await withPrivateRunner(pool,context,()=>readPinnedAttachment(pool,context.conversation_id,context.run_id,input.id),options):await operatingRead(action,input);}
 catch{result={ok:false,code:'INPUT_UNAVAILABLE'};known=false;}
 await withPrivateRunner(pool,context,()=>transaction(pool,async client=>{await completeInput({client,threadId:context.conversation_id,runId:context.run_id,id,bytes:JSON.stringify(result),areas:known&&action!=='read_chat_attachment'?[]:null,complete:known&&action!=='read_chat_attachment',sourceHash:result.source_hash??null,facts:{query_hash:input.query?hashBytes(input.query):null,sources:(result.documents??[]).map(d=>({id:d.id,version:d.version,hash:d.source_hash}))}});}),options);
 return {ok:true,result};
}
/** Internal bearer forwarder with no ordinary claimed principal/header fields. */
export function createContextForwarder(config=key=>process.env[key]){
 const send=globalThis.fetch;
 return async(route,body)=>{
  if(!['/api/internal/canvas','/api/internal/ask-context-provenance'].includes(route))throw Error('INVALID_INPUT');
  const secret=config('CRON_SECRET');if(!secret)throw Error('RUN_CONTEXT_REQUIRED');
  const base=new URL(config('APP_INTERNAL_URL')||'http://127.0.0.1:3017');
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('RUN_CONTEXT_REQUIRED');
  const r=await send(new URL(route,base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},body:JSON.stringify(body)});
  const result=await r.json();if(!r.ok&&result?.ok!==false)throw Error('CONTEXT_PROVENANCE_INCOMPLETE');return result;
 };
}
/** Both MCP question servers share pending-before-wait and exact completion. */
export function trackedInteractions(base,contextAdapter){
 const pending=new Map();
 return {...base,
  async create(kind,payload){if(!await contextAdapter.enabled())return base.create(kind,payload);const marker=await contextAdapter.begin('tool','ask_owner');const id=await base.create(kind,payload);pending.set(id,marker);return id;},
  async beforeDeliver(id){
   if(!pending.has(id)&&!await contextAdapter.enabled())return base.beforeDeliver(id);
   const result=await contextAdapter.question(id),marker=pending.get(id);
   if(!marker)throw Error('RUN_CONTEXT_REQUIRED');
   await contextAdapter.complete(marker,result);return result;
  },
 };
}

/** Trusted schema capability, independent of feature flags. Errors never downgrade. */
export async function trackingAvailable(client){
 const r=(await client.query("SELECT to_regclass('public.ask_context_provenance') IS NOT NULL AS installed,EXISTS(SELECT 1 FROM schema_migrations WHERE id=107) AS required")).rows[0];
 if(r.required&&!r.installed)throw Error('CONTEXT_PROVENANCE_INCOMPLETE');return r.installed;
}
/** Server-derived control envelope: exact templates and real same-thread records. */
export async function instructionEnvelope(client,threadId,prompt){
 const row=(await client.query('SELECT * FROM ask_canvas_instruction($1,$2)',[threadId,prompt])).rows[0];
 return row?.known?{complete:true,areas:row.areas,facts:row.envelope}:{complete:false,areas:null,facts:{}};
}
