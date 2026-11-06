// Controller-only primitive. Never import into app/agent/MCP entrypoints.
// The service bootstrap must attest its actual DB session identity before loading
// keys. This module provides crypto, not a substitute for one-use SQL/RPC proofs.
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
const fields={
 login:['login_id','owner_user_id','origin','credential_revision'],
 profile:['profile_id','user_id','login_id','origin_chain_digest','credential_revision','profile_revision'],
 request_body:['artifact_id','task_id','action_id','initiating_user_id','origin','action_revision'],
 read_manifest:['manifest_id','task_id','initiating_user_id','origins_digest','task_origins_revision','manifest_revision'],
 handoff_answers:['handoff_id','source_task_id','initiating_user_id','recipient_owner_id','project_id','snapshot_revision'],
 review_image:['artifact_id','task_id','action_id','initiating_user_id','origin','action_revision','document_epoch'],
 quarantine_file:['artifact_id','task_id','user_id','origin','download_id','revision'],
 saved_file:['artifact_id','file_id','project_id','source_task_id','user_id','origin','revision'],
};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail=()=>{throw new Error('BROWSER_VAULT_UNAVAILABLE');};
// RFC8785/JCS for this restricted no-float JSON domain. JS sort uses UTF-16
// code units and JSON.stringify uses ECMAScript string serialization (JCS).
export function canonicalJson(value){
 if(value===null || typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='string'){if(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))fail();return JSON.stringify(value);}
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||Object.is(value,-0))fail();return String(value);}
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value && Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>canonicalJson(k)+':'+canonicalJson(value[k])).join(',')+'}';
 fail();
}
export function vaultBindings(purpose,input){
 const names=fields[purpose];if(!names || !input || Object.keys(input).sort().join()!==[...names].sort().join())fail();
 for(const key of names){const v=input[key];
  if(key==='origin'){let u;try{u=new URL(v);}catch{fail();}if(u.protocol!=='https:'||u.origin!==v||u.username||u.password||u.port||u.hostname!==u.hostname.toLowerCase())fail();}
  else if(key.endsWith('revision')||key==='document_epoch'){if(!Number.isSafeInteger(v)||v<(key==='document_epoch'?0:1))fail();}
  else if(key.endsWith('digest')){if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v))fail();}
  else if(key==='file_id'){if(typeof v!=='string'||! /^[a-z0-9_-]{1,200}$/.test(v))fail();}
  else if(!(key==='project_id'&&purpose==='handoff_answers'&&v===null) && (typeof v!=='string'||!uuid.test(v)))fail();
 }
 return {version:1,purpose,...input};
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const dataAad=b=>Buffer.from('SJCOS/browser/data/v1\0'+canonicalJson(b));
const wrapAad=(b,id,rev)=>Buffer.from('SJCOS/browser/wrap/v1\0'+canonicalJson({purpose:b.purpose,artifact_id:b.login_id&&b.purpose==='login'?b.login_id:b.profile_id??b.artifact_id??b.manifest_id??b.handoff_id,data_aad_sha256:hash(dataAad(b)),kek_id:id,wrap_revision:rev}));
function encrypt(key,plaintext,aad){const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);c.setAAD(aad);return {ciphertext:Buffer.concat([c.update(plaintext),c.final()]),nonce,tag:c.getAuthTag()};}
function decrypt(key,box,aad){const d=createDecipheriv('aes-256-gcm',key,box.nonce);d.setAAD(aad);d.setAuthTag(box.tag);return Buffer.concat([d.update(box.ciphertext),d.final()]);}
function bytes(s,n){if(typeof s!=='string'||s.length>140000000)fail();const b=Buffer.from(s,'base64');if(b.toString('base64')!==s||(n&&b.length!==n))fail();return b;}
const encode=box=>Object.fromEntries(Object.entries(box).map(([k,v])=>[k,v.toString('base64')]));
function parseEnvelope(e,b){
 if(!e||Object.keys(e).sort().join()!==['version','purpose','bindings','ciphertext','nonce','tag','wrapped_key','wrap_nonce','wrap_tag','key_id','wrap_revision'].sort().join()||e.version!==1||e.purpose!==b.purpose||canonicalJson(e.bindings)!==canonicalJson(b)||!Number.isSafeInteger(e.wrap_revision)||e.wrap_revision<1)fail();
 return {data:{ciphertext:bytes(e.ciphertext),nonce:bytes(e.nonce,12),tag:bytes(e.tag,16)},wrap:{ciphertext:bytes(e.wrapped_key,32),nonce:bytes(e.wrap_nonce,12),tag:bytes(e.wrap_tag,16)}};
}
/** Read a root/service-owned 0640 (or stricter) regular credential file. No env
 * containing raw keys, symlinks, repo paths, or fallback development keys. */
export async function loadVaultKeys({credentialPath,serviceUid=process.getuid(),repositoryRoot=process.cwd()}={}){
 let f;try{
  if(!path.isAbsolute(credentialPath??''))fail();
  const resolved=await realpath(credentialPath),repo=await realpath(repositoryRoot);
  if(resolved===repo||resolved.startsWith(repo+path.sep)||resolved!==credentialPath)fail();
  const parent=await stat(path.dirname(resolved));if((parent.mode&0o027)!==0||![0,serviceUid].includes(parent.uid))fail();
  f=await open(credentialPath,constants.O_RDONLY|constants.O_NOFOLLOW);const s=await f.stat();
  if(!s.isFile()||s.size>65536||(s.mode&0o137)!==0||![0,serviceUid].includes(s.uid))fail();
  return JSON.parse(await f.readFile('utf8'));
 }catch{fail();}finally{await f?.close();}
}
/** reserveWrap(purpose,keyId) MUST commit a durable monotonic reservation before
 * returning {count,activated_at}. No implicit memory counter. Factory is only
 * usable by a trusted controller/reader bootstrap with actual session proof. */
export function createVaultCrypto({keys,reserveWrap,sessionIdentity,now=()=>Date.now()}){
 if(!['sjcos_browser','sjcos_browser_reader'].includes(sessionIdentity)||!keys||!keys.purposes)fail();
 keys=structuredClone(keys);
 const all=[];
 for(const [purpose,ring] of Object.entries(keys.purposes)){
  if(!fields[purpose]||!ring.versions||!ring.versions[ring.active])fail();
  for(const [id,v] of Object.entries(ring.versions)){
   if(!/^[a-z0-9_-]{1,80}$/.test(id)||!['active','decrypt_only'].includes(v.state)||!Number.isFinite(Date.parse(v.activated_at)))fail();
   if(id===ring.active&&v.state!=='active')fail();
   const k=bytes(v.key,32);if(all.some(b=>b.equals(k)))fail();all.push(k);
  }
 }
 function get(p,id){const v=keys.purposes[p]?.versions[id];if(!v)fail();return bytes(v.key,32);}
 async function wrap(p,b,dek,rev){
  const ring=keys.purposes[p],id=ring?.active,v=ring?.versions[id];
  if(!v||v.state!=='active'||typeof reserveWrap!=='function'||sessionIdentity!=='sjcos_browser')fail();
  const age=now()-Date.parse(v.activated_at);if(age<0||age>=90*86400000)fail();
  const r=await reserveWrap(p,id);if(!r||!Number.isSafeInteger(r.count)||r.count<1||r.count>2**24||r.activated_at!==v.activated_at)fail();
  return {id,box:encrypt(get(p,id),dek,wrapAad(b,id,rev))};
 }
 return Object.freeze({
  async seal(p,input,plaintext){let dek;try{const b=vaultBindings(p,input);if(!Buffer.isBuffer(plaintext)||!plaintext.length||plaintext.length>100*1024*1024)fail();dek=randomBytes(32);const w=await wrap(p,b,dek,1),d=encode(encrypt(dek,plaintext,dataAad(b)));return {version:1,purpose:p,bindings:b,...d,wrapped_key:w.box.ciphertext.toString('base64'),wrap_nonce:w.box.nonce.toString('base64'),wrap_tag:w.box.tag.toString('base64'),key_id:w.id,wrap_revision:1};}catch{fail();}finally{dek?.fill(0);}},
  open(p,input,envelope){let dek;try{if(sessionIdentity==='sjcos_browser_reader'&&p!=='saved_file')fail();const b=vaultBindings(p,input),e=parseEnvelope(envelope,b);dek=decrypt(get(p,envelope.key_id),e.wrap,wrapAad(b,envelope.key_id,envelope.wrap_revision));return decrypt(dek,e.data,dataAad(b));}catch{fail();}finally{dek?.fill(0);}},
  async rewrap(p,input,envelope,expectedWrapRevision){let dek;try{if(envelope.wrap_revision!==expectedWrapRevision)fail();const b=vaultBindings(p,input),e=parseEnvelope(envelope,b);dek=decrypt(get(p,envelope.key_id),e.wrap,wrapAad(b,envelope.key_id,envelope.wrap_revision));const checked=decrypt(dek,e.data,dataAad(b));checked.fill(0);const revision=envelope.wrap_revision+1,w=await wrap(p,b,dek,revision);return {...envelope,wrapped_key:w.box.ciphertext.toString('base64'),wrap_nonce:w.box.nonce.toString('base64'),wrap_tag:w.box.tag.toString('base64'),key_id:w.id,wrap_revision:revision};}catch{fail();}finally{dek?.fill(0);}},
 });
}
