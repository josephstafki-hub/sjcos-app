// Durable local deletion fence + independently authenticated live authority.
// The authority is provisioned separately, outside DB AND primary-volume restore
// sets. Protocol: nonce-bound Ed25519 read/CAS receipts, strongly consistent CAS,
// encrypted immutable/versioned prefixes durable before high-water advancement.
import { open, mkdir, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv, verify } from 'node:crypto';
export const ZERO='0'.repeat(64);
export const PAUSED='Chats are paused while SJC OS checks its records. Try again in a few minutes.';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fields=e=>({sequence:e.sequence,operation_uuid:e.operation_uuid,entity_type:e.entity_type,opaque_ids:e.opaque_ids,deleted_at:e.deleted_at,purge_after:e.purge_after,prev_hash:e.prev_hash});
export function validateChain(entries){
 if(!Array.isArray(entries)||entries.length>10000)throw Error('JOURNAL_BOUND');
 let head=ZERO; const operations=new Set();
 for(let i=0;i<entries.length;i++){
  const e=entries[i];
  if(e.sequence!==i+1||!uuid.test(e.operation_uuid)||operations.has(e.operation_uuid)||e.entity_type!=='thread'||!Array.isArray(e.opaque_ids)||e.opaque_ids.length!==1||!uuid.test(e.opaque_ids[0])||e.prev_hash!==head||e.checksum!==hash(fields(e))||!Number.isFinite(Date.parse(e.deleted_at))||Date.parse(e.purge_after)-Date.parse(e.deleted_at)!==30*86400000||Object.keys(e).length!==8)throw Error('JOURNAL_INVALID');
  operations.add(e.operation_uuid); head=e.checksum;
 }return {sequence:entries.length,head_hash:head};
}
export function makeIntent(entries,threadId,operation=randomUUID(),now=new Date()){
 const old=entries.find(e=>e.operation_uuid===operation);
 if(old){if(old.opaque_ids[0]!==threadId)throw Error('JOURNAL_OPERATION_CONFLICT');return old;}
 const {sequence,head_hash}=validateChain(entries);
 const e={sequence:sequence+1,operation_uuid:operation,entity_type:'thread',opaque_ids:[threadId],deleted_at:now.toISOString(),purge_after:new Date(+now+30*86400000).toISOString(),prev_hash:head_hash};
 return {...e,checksum:hash(e)};
}
export async function withLedgerLock(dir,fn,timeoutMs=9000){
 if(!dir||!path.isAbsolute(dir))throw Error('JOURNAL_NOT_CONFIGURED');
 await mkdir(dir,{recursive:true,mode:0o700});
 const st=await lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw Error('JOURNAL_PERMISSIONS');
 // Kernel lock releases on process death; no stale lock-directory guessing.
 const child=spawn('flock',['-x','-w',String(Math.min(8,timeoutMs/1000)),path.join(dir,'journal.lock'),process.execPath,'-e',"process.stdout.write('locked\\n'); process.stdin.resume(); process.stdin.on('end',()=>process.exit(0));"],{stdio:['pipe','pipe','pipe']});
 const exit=once(child,'exit');
 let timer,locked=false;
 try{
  await Promise.race([once(child.stdout,'data'),exit.then(()=>{throw Error('JOURNAL_LOCK_FAILED');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('JOURNAL_LOCK_TIMEOUT')),timeoutMs);})]);
  locked=true;return await fn();
 }finally{clearTimeout(timer);if(!locked)child.kill();child.stdin.end();await exit;}
}
export async function readLocal(dir){
 const file=path.join(dir,'intents.jsonl');
 let raw;try{const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>8*1024*1024)throw Error('JOURNAL_FILE');raw=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const end=raw.lastIndexOf('\n')+1;
 if(end!==raw.length){
  if(Buffer.byteLength(raw.slice(end))>4096)throw Error('JOURNAL_TAIL');
  const f=await open(file,'r+');try{await f.truncate(Buffer.byteLength(raw.slice(0,end)));await f.sync();}finally{await f.close();}
 }
 const entries=raw.slice(0,end).split('\n').filter(Boolean).map(s=>JSON.parse(s));validateChain(entries);return entries;
}
export async function appendLocal(dir,e){
 const file=path.join(dir,'intents.jsonl');
 const f=await open(file,'a',0o600);try{await f.writeFile(JSON.stringify(e)+'\n');await f.sync();}finally{await f.close();}
 const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
}
function encrypt(entries,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const bytes=Buffer.concat([c.update(JSON.stringify(entries)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
function decrypt(data,key){const b=Buffer.from(data,'base64');const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'));}
export function configuredAuthority(env=process.env,deadline=Infinity){
 const {SJC_CANVAS_AUTHORITY_URL:url,SJC_CANVAS_LEDGER_ID:id,SJC_CANVAS_AUTHORITY_PUBLIC_KEY:publicKey,SJC_CANVAS_AUTHORITY_TOKEN:token,SJC_CANVAS_JOURNAL_KEY:keyHex}=env;
 if(!url||!id||!uuid.test(id)||!publicKey||!token||!/^[a-f0-9]{64}$/i.test(keyHex??''))throw Error('JOURNAL_AUTHORITY_NOT_CONFIGURED');
 const endpoint=new URL(url);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('JOURNAL_AUTHORITY_URL');
 const key=Buffer.from(keyHex,'hex');
 async function call(action,extra={}){
  const nonce=randomBytes(32).toString('hex');
  const res=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(4000,Math.floor(deadline-Date.now())))),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,ledger_id:id,nonce,...extra})});
  if(!res.ok)throw Error('JOURNAL_AUTHORITY_UNAVAILABLE');
  const bytes=await res.text();if(Buffer.byteLength(bytes)>12*1024*1024)throw Error('JOURNAL_AUTHORITY_BOUND');
  const {payload,signature}=JSON.parse(bytes);
  if(typeof payload!=='string'||typeof signature!=='string'||!verify(null,Buffer.from(payload),publicKey,Buffer.from(signature,'base64')))throw Error('JOURNAL_AUTHORITY_SIGNATURE');
  const receipt=JSON.parse(payload);
  if(receipt.nonce!==nonce||receipt.ledger_id!==id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
  const entries=decrypt(receipt.encrypted_prefix,key),head=validateChain(entries);
  if(receipt.sequence!==head.sequence||receipt.head_hash!==head.head_hash)throw Error('JOURNAL_AUTHORITY_PREFIX');
  return {...head,ledger_id:id,entries};
 }
 return {id,read:()=>call('read'),advance:async(expected,entries)=>{
  const head=validateChain(entries);
  const r=await call('compare_and_swap',{expected:{sequence:expected.sequence,head_hash:expected.head_hash},...head,encrypted_prefix:encrypt(entries,key),operation_uuid:entries.at(-1)?.operation_uuid});
  if(r.sequence!==head.sequence||r.head_hash!==head.head_hash)throw Error('JOURNAL_AUTHORITY_CAS');return r;
 }};
}
async function bindLocalLedger(dir,id,entries){
 const file=path.join(dir,'ledger-id');
 try{
  const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.size>128)throw Error('JOURNAL_BINDING');
  if((await readFile(file,'utf8')).trim()!==id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
 }catch(e){
  if(e.code!=='ENOENT')throw e;
  if(entries.length)throw Error('JOURNAL_BINDING_MISSING');
  const f=await open(file,'wx',0o600);try{await f.writeFile(id+'\n');await f.sync();}finally{await f.close();}
  const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
 }
}
// Must run under the same OS lock for reads, delete, replay and maintenance.
export async function synchronizeLedger(dir,authority){
 let entries=await readLocal(dir);await bindLocalLedger(dir,authority.id,entries);let live=await authority.read();
 if(live.ledger_id!==authority.id)throw Error('JOURNAL_AUTHORITY_IDENTITY');
 const remote=validateChain(live.entries);
 if(remote.sequence!==live.sequence||remote.head_hash!==live.head_hash)throw Error('JOURNAL_AUTHORITY_PREFIX');
 for(let i=0;i<Math.min(entries.length,live.entries.length);i++)if(entries[i].checksum!==live.entries[i].checksum)throw Error('JOURNAL_DIVERGED');
 // Primary-volume loss: reconstruct ONLY from the live, independently pinned
 // authority, never the DB checkpoint or an old replica receipt.
 for(const e of live.entries.slice(entries.length))await appendLocal(dir,e);
 if(entries.length<live.entries.length)entries=live.entries;
 if(entries.length>live.sequence)live=await authority.advance(live,entries);
 return {entries,live};
}
