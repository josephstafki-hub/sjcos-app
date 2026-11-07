/** Browser web boundary. No ambient DB, cookie minting, CDP, logs or retries. */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {UUID,UInt,ManualInput,ControlMessage,OriginManifest,ReadProposal,PageRequest,MetadataPage,HTTP_STATUS,ERROR_CODES,webError} from './phase1-contracts.mjs';
/** Exact production SQL, shared with the harness regression (no ambient client). */
export const PREPARED_ANSWER_SOURCE_SQL=`SELECT m.body FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE m.id=$1 AND m.conversation_id=$2 AND m.role='user' AND c.owner_user_id=$3 AND c.deleted_at IS NULL`;
export const METADATA_LIMIT=32768;
export function metadataBytes(value){const bytes=Buffer.from(canonical(value));if(bytes.length>METADATA_LIMIT)fail('BROWSER_SERVICE_UNAVAILABLE');return bytes;}
export function verifyRpcResponse(response,request,key,now=Date.now()){
 if(!response||Array.isArray(response)||typeof response!=='object'||Object.keys(response).sort().join(',')!=='boot_id,command_id,result,sequence,signature')fail('BROWSER_SERVICE_UNAVAILABLE');
 metadataBytes(response);const {signature,...data}=response;
 if(!/^[a-f0-9]{64}$/.test(signature??'')||!equal(signature,digest(key,data))||data.command_id!==request.command_id||data.boot_id!==request.boot_id||data.sequence!==request.sequence||now>=Date.parse(request.expires_at)||!data.result||typeof data.result!=='object'||Array.isArray(data.result))fail('BROWSER_SERVICE_UNAVAILABLE');
 if(data.result.ok===false)fail(ERROR_CODES.includes(data.result.code)?data.result.code:'BROWSER_SERVICE_UNAVAILABLE');return data.result;
}
export function pageRequest(value={}){
 if(Object.keys(value).some(k=>!['cursor','limit'].includes(k)))fail();
 if(!PageRequest.safeParse(value).success)fail();const limit=value.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>20||value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor.length||Buffer.byteLength(value.cursor)>256))fail();
 return {...(value.cursor===undefined?{}:{cursor:value.cursor}),limit};
}
export function pageQuery(url){const params=new URL(url).searchParams,request={};for(const name of ['cursor','limit']){const values=params.getAll(name);if(values.length>1)fail();if(values.length){if(name==='limit'){if(!/^(?:[1-9]|1[0-9]|20)$/.test(values[0]))fail();request.limit=Number(values[0]);}else request.cursor=values[0];}}return pageRequest(request);}
/** A failed page never exposes a partial assembly, and never retries a mutation. */
export async function collectMetadataPages(fetchPage,{limit=20,maxItems=512}={}){
 pageRequest({limit});let cursor,revision,items=[];const seen=new Set();
 for(let n=0;n<128;n++){
  const page=await fetchPage(pageRequest({limit,...(cursor===undefined?{}:{cursor})}));
  if(!MetadataPage.safeParse(page).success||!page||!Array.isArray(page.items)||page.items.length>limit||!Number.isSafeInteger(page.revision)||page.revision<0||page.next_cursor!==null&&(typeof page.next_cursor!=='string'||!page.next_cursor.length||Buffer.byteLength(page.next_cursor)>256)||!page.items.length&&page.next_cursor!==null)fail('BROWSER_SERVICE_UNAVAILABLE');
  if(revision!==undefined&&revision!==page.revision)fail('BROWSER_REVIEW_STALE');revision=page.revision;
  items.push(...page.items);if(items.length>maxItems)fail('BROWSER_SERVICE_UNAVAILABLE');
  if(page.next_cursor===null)return {items,next_cursor:null,revision};
  if(seen.has(page.next_cursor))fail('BROWSER_SERVICE_UNAVAILABLE');seen.add(page.next_cursor);cursor=page.next_cursor;
 }fail('BROWSER_SERVICE_UNAVAILABLE');
}
/** Signed cursor binds current user/session/task/collection and dataset revision. */
export function projectMetadataPage({items,revision,request={},key,scope}){
 const {limit,cursor}=pageRequest(request);let offset=0;const fingerprint=digest(key,items).slice(0,16);
 if(cursor!==undefined){try{const [payload,signature,...extra]=cursor.split('.');if(extra.length||!equal(signature,digest(key,['browser-page-v1',scope,payload])))fail();const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(!Array.isArray(data)||data.length!==3||!Number.isSafeInteger(data[0])||data[0]<1)fail();if(data[1]!==revision||data[2]!==fingerprint||data[0]>=items.length)fail('BROWSER_REVIEW_STALE');offset=data[0];}catch(e){if(e.message==='BROWSER_REVIEW_STALE')throw e;fail();}}
 const selected=[];let length=0;while(offset+selected.length<items.length&&selected.length<limit){const item=items[offset+selected.length],size=Buffer.byteLength(canonical(item));if(size>24576)fail('BROWSER_SERVICE_UNAVAILABLE');if(length+size>24576)break;selected.push(item);length+=size;}
 const next=offset+selected.length,payload=Buffer.from(JSON.stringify([next,revision,fingerprint])).toString('base64url');
 return MetadataPage.parse({items:selected,next_cursor:next<items.length?payload+'.'+digest(key,['browser-page-v1',scope,payload]):null,revision});
}
/** Caller has already authenticated cookie/CSRF/device/current stream. Stop local
 * delivery before the remote close can race its binary disconnect notification.
 * Only a signed remote ACK is success; failure attempts an accidental-close fence.
 */
export async function acknowledgePlannedClose(live,send){
 live.remoteClosed=true;
 try{await live.close();await send(true);}catch(e){try{await send(false);}catch{}throw e;}
}
export function availableControls(task){if(['closed','failed'].includes(task.state))return [];if(['queued','starting'].includes(task.state))return ['stop'];return task.private?['take_over','pause','done','stop','fresh_browser']:['take_over','pause','stop',...(task.state==='paused'?['resume']:[])];}
export const CSRF_COOKIE='sjc_browser_csrf';
export const PRIVATE_HEADERS={'Cache-Control':'private, no-store, no-transform','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
/** @returns {never} */
export function fail(code='BROWSER_BAD_INPUT'){throw Error(code);}
export function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x!==null&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
export const digest=(key,x)=>createHmac('sha256',key).update(canonical(x)).digest('hex');
export function equal(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function keyReady(key){return typeof key==='string'?Buffer.byteLength(key)>=32:key?.length>=32;}
export function createCsrf(session,key,now=Date.now()){if(!keyReady(key))fail('BROWSER_DISABLED');const expires=Math.min(now+1800000,session.exp*1000),payload=Buffer.from(JSON.stringify([session.sid,expires,randomBytes(16).toString('hex')])).toString('base64url');return {token:payload+'.'+digest(key,['browser-csrf-v1',payload]),expires_at:new Date(expires).toISOString()};}
export function checkCsrf(request,session,key,now=Date.now()){
 if(!keyReady(key))fail('BROWSER_DISABLED');const token=request.headers.get('x-sjc-csrf'),cookies=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(CSRF_COOKIE+'='));
 if(!token||token.length>512||cookies.length!==1||!equal(cookies[0].slice(CSRF_COOKIE.length+1),token))fail('BROWSER_FORBIDDEN');
 const [payload,signature,...extra]=token.split('.');if(extra.length||!equal(signature,digest(key,['browser-csrf-v1',payload])))fail('BROWSER_FORBIDDEN');
 try{const [sid,expires,nonce]=JSON.parse(Buffer.from(payload,'base64url').toString());if(sid!==session.sid||!Number.isSafeInteger(expires)||expires<=now||expires>Math.min(now+1800000,session.exp*1000)||! /^[a-f0-9]{32}$/.test(nonce))fail();}catch{fail('BROWSER_FORBIDDEN');}
}
export class RateWindow{
 constructor({limit=120,interval=1000,maxKeys=2048,now=Date.now}={}){this.limit=limit;this.interval=interval;this.maxKeys=maxKeys;this.now=now;this.keys=new Map();}
 take(key,limit=this.limit){const now=this.now();let s=this.keys.get(key);if(!s||now-s.at>=this.interval){if(!s&&this.keys.size>=this.maxKeys){for(const [k,v]of this.keys)if(now-v.at>=this.interval)this.keys.delete(k);if(this.keys.size>=this.maxKeys)fail('BROWSER_RATE_LIMIT');}this.keys.set(key,s={at:now,n:0});}if(++s.n>limit)fail('BROWSER_RATE_LIMIT');}
}
/** Stores HMACs and acceptance results only, never event text. Unknown burns key. */
export class InputDedupe{
 constructor(key,{maxKeys=2048,now=Date.now}={}){this.key=key;this.entries=new Map();this.maxKeys=maxKeys;this.now=now;}
 async run(binding,input,forward){const key=binding+':'+input.seq,hash=digest(this.key,input),old=this.entries.get(key);if(old){if(old.hash!==hash)fail('BROWSER_IDEMPOTENCY_CONFLICT');return old.promise;}if(this.entries.size>=this.maxKeys){for(const [k,v]of this.entries)if(this.now()-v.at>60000)this.entries.delete(k);if(this.entries.size>=this.maxKeys)fail('BROWSER_RATE_LIMIT');}const record={hash,at:this.now(),promise:null};record.promise=Promise.resolve().then(forward);this.entries.set(key,record);return record.promise;}
}
const o=z.strictObject,I={idempotency_key:UUID},rev={expected_revision:UInt},secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/),device={viewer_id:UUID,device_secret:secret};
export const RequestSchemas=Object.freeze({
 create:o({conversation_id:UUID,task_kind:z.enum(['public_research','permit','invoice','purchase']),purpose:z.string().min(1).max(500),project_id:UUID.optional(),lead_slug:z.string().max(160).optional(),origins:OriginManifest.shape.entries,initial_url:z.string().min(1).max(2048),read_proposal:ReadProposal,...I}),
 start:o({...I}),decline:o({...I}),sites:o({origin:z.string().max(255),role:z.enum(['document','identity','resource']),...rev,...I}),reads:o({...rev,proposal:ReadProposal,decision:z.enum(['approve','deny']),...I}),
 answers:o({...rev,proposal:z.array(o({field_key:z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),value:z.string().max(4000),source_message_id:UUID})).max(100),decision:z.enum(['confirm','remove']),...I}),
 join:o({mode:z.enum(['initiator','owner_review']),local_thread_id:UUID.optional(),action_id:UUID.optional(),private_view:z.boolean().optional(),...I}),leave:o({...device,...I}),
 presence:o({...device,visible:z.boolean(),host_context:z.discriminatedUnion('kind',[o({kind:z.literal('initiator'),conversation_id:UUID}),o({kind:z.literal('owner_review'),claim_id:UUID})]),expected_epoch:UInt,...I}),
 stream_close:o({...device,stream_id:UUID,stream_generation:UInt.min(1),...I}),control:ControlMessage.extend({confirmed:z.literal(true).optional()}),input:ManualInput,decision:o({decision:z.enum(['approve','deny']),...rev,...I}),
 settings:o({enabled:z.boolean(),staff_enabled:z.boolean(),pilot_user_ids:z.array(UUID).max(100),suppress_own_takeover_confirm:z.boolean(),...rev,...I})
});
export function resolveRoute(method,path){
 const top={'/csrf':{GET:'csrf'},'/availability':{GET:'availability'},'/tasks':{GET:'tasks',POST:'create'},'/in-use':{GET:'in_use'},'/settings':{GET:'settings_get',POST:'settings'}};
 if(top[path])return top[path][method]??null;
 let m=path.match(/^\/tasks\/([^/]+)(?:\/(start|decline|sites|reads|answers|join|leave))?$/);if(m){UUID.parse(m[1]);return m[2]?(method==='POST'?m[2]:method==='GET'&&['reads','answers'].includes(m[2])?m[2]+'_get':null):method==='GET'?'status':null;}
 m=path.match(/^\/sessions\/([^/]+)\/(presence|control|stream-close|private-input|input|events|frame)$/);if(m){UUID.parse(m[1]);return ['events','frame'].includes(m[2])?(method==='GET'?m[2]:null):method==='POST'?(m[2]==='stream-close'?'stream_close':m[2]==='private-input'?'input_private':m[2]==='input'?'input_public':m[2]):null;}
 m=path.match(/^\/(actions|artifacts)\/([^/]+)(\/decision)?$/);if(m){UUID.parse(m[2]);return m[1]==='artifacts'&&!m[3]&&['GET','HEAD'].includes(method)?'artifact':m[1]==='actions'?(m[3]&&method==='POST'?'decision':!m[3]&&method==='GET'?'review':null):null;}
 return null;
}
export async function boundedJson(request,limit){if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))fail();const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>limit))fail('BROWSER_FILE_TOO_LARGE');if(!request.body)fail();const reader=request.body.getReader();let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},3000);let length=0;const chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();fail('BROWSER_FILE_TOO_LARGE');}chunks.push(value);}if(timedOut)fail('BROWSER_BAD_INPUT');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{clearTimeout(timeout);reader.releaseLock();}}
export function errorResponse(error,head=false){const code=ERROR_CODES.includes(error?.message)?error.message:'BROWSER_SERVICE_UNAVAILABLE';return new Response(head?null:JSON.stringify(webError(code)),{status:HTTP_STATUS[code],headers:{...PRIVATE_HEADERS,'Content-Type':'application/json'}});}
export function createBrowserWebHandler(deps){
 const rate=deps.rate??new RateWindow();
 return async request=>{try{
  const session=await deps.session(request);if(!session?.sid||session.exp*1000<=Date.now())fail('BROWSER_NOT_AUTHENTICATED');
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/agent-browser/,'');
  const context=await deps.authorize({request,session,path}); // uncached, even unsupported methods / HEAD / Range
  const flags=await deps.flags(session);if(!flags.can_start)fail('BROWSER_DISABLED');
  rate.take(session.sid);if(request.headers.get('sec-fetch-site')!=='same-origin')fail('BROWSER_FORBIDDEN');
  if(request.headers.has('origin')&&request.headers.get('origin')!==deps.origin)fail('BROWSER_FORBIDDEN');
  const operation=resolveRoute(request.method,path);
  if(['tasks','reads_get','answers_get','in_use'].includes(operation)){const allowed=operation==='tasks'?['conversation_id','cursor','limit']:['cursor','limit'];if([...url.searchParams.keys()].some(k=>!allowed.includes(k)))fail();if(operation==='tasks'&&(url.searchParams.getAll('conversation_id').length!==1||!UUID.safeParse(url.searchParams.get('conversation_id')).success))fail();pageQuery(url);}else if(url.search)fail();
  if(['events','frame'].includes(operation)&&request.headers.has('last-event-id'))fail('BROWSER_STREAM_STALE');
  if(request.method!=='GET'&&request.method!=='HEAD'){if(request.headers.get('origin')!==deps.origin)fail('BROWSER_FORBIDDEN');checkCsrf(request,session,deps.csrfKey);}
  if(!operation)fail('BROWSER_PHASE1_READ_ONLY');
  if(operation==='csrf'){const csrf=createCsrf(session,deps.csrfKey);return Response.json({ok:true,csrf_token:csrf.token,expires_at:csrf.expires_at},{headers:{...PRIVATE_HEADERS,'Set-Cookie':`${CSRF_COOKIE}=${csrf.token}; Path=/api/agent-browser; HttpOnly; Secure; SameSite=Strict; Max-Age=1800`}});}
  let body=null;if(request.method==='POST'){body=await boundedJson(request,operation==='input_private'?8192:65536);if(operation==='create'&&body?.adapter_id!==undefined)fail('BROWSER_PHASE1_READ_ONLY');if(operation==='settings'&&['vault_enabled','files_enabled','final_steps_enabled','permit_handoff_enabled'].some(k=>body?.[k]===true))fail('BROWSER_PHASE1_READ_ONLY');if(operation==='input_public')fail('BROWSER_PRIVATE_INPUT_REQUIRED');if(operation==='decision'&&body?.decision==='approve')fail('BROWSER_PHASE1_READ_ONLY');const name=operation==='input_private'?'input':operation;body=RequestSchemas[name].parse(body);if(operation==='control'&&body.action==='fresh_browser'&&body.confirmed!==true)fail();}
  const result=await deps.execute({operation,request,session,context,body,flags});
  if(result instanceof Response)return result;
  return new Response(request.method==='HEAD'?null:JSON.stringify({ok:true,...result}),{status:200,headers:{...PRIVATE_HEADERS,'Content-Type':'application/json'}});
 }catch(e){if(e?.name==='ZodError'||e instanceof SyntaxError||e instanceof TypeError)return errorResponse(Error('BROWSER_BAD_INPUT'),request.method==='HEAD');return errorResponse(e,request.method==='HEAD');}};
}

/** Content-free service projection; unknown details never become UI copy. */
export const StatusProjection=z.object({
 state_reason:z.enum(['queue_expired','offer_expired','idle_closed','turn_ended','owner_paused','absent','crashed','latched','unknown']).nullable(),
 reason_code:z.enum(ERROR_CODES).nullable(),idle_closes_at:z.iso.datetime().nullable(),
 controller:z.enum(['self','other_device','owner','other_person','none','unknown']),
 window_count:z.number().int().min(0).max(2).nullable(),watching_owner:z.boolean(),owner_label:z.string().min(1).max(120).nullable()
});
