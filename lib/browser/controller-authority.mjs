/** Exact signed request authority. Files are exclusive, fsynced before ACK and
 * never deleted on error: ambiguity burns a claim, it never authorizes retry. */
import {createPublicKey,verify} from 'node:crypto';
import {open,lstat,constants} from 'node:fs/promises';
import path from 'node:path';
import {canonical} from './acceptance-attestation.mjs';
import {sha256} from './runtime-readiness.mjs';
import {parseBrowserUrl} from './network-policy.mjs';
const fail=()=>{throw Error('BROWSER_CONTROLLER_REFUSED');};
export const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const exact=(x,keys)=>x&&Object.getPrototypeOf(x)===Object.prototype&&Object.keys(x).sort().join(',')===[...keys].sort().join(',');
export function verifySigned(envelope,publicKey){
  try{
    if(!exact(envelope,['payload','signature']))fail();
    const decode=(v,max)=>{if(typeof v!=='string'||!v.length||v.length>max)fail();const b=Buffer.from(v,'base64');if(b.toString('base64')!==v)fail();return b;};
    const bytes=decode(envelope.payload,65536),signature=decode(envelope.signature,128),key=publicKey?.type==='public'?publicKey:createPublicKey(publicKey);
    if(key.asymmetricKeyType!=='ed25519'||signature.length!==64||!verify(null,bytes,key,signature))fail();
    const result=JSON.parse(bytes.toString('utf8'));if(canonical(result)!==bytes.toString('utf8'))fail();return result;
  }catch{fail();}
}
export function verifyManifest(envelope,{publicKey,now=Date.now(),runId,taskId,userId,bootId}={}){
  const d=verifySigned(envelope,publicKey);
  if(!exact(d,['format','purpose','manifestId','runId','taskId','userId','bootId','revision','issuedAt','expiresAt','requests'])||d.format!==1||!['browser-read-manifest','browser-action-manifest'].includes(d.purpose)||![d.manifestId,d.runId,d.taskId,d.userId,d.bootId].every(uuid)||d.runId!==runId||d.taskId!==taskId||d.userId!==userId||d.bootId!==bootId||!Number.isSafeInteger(d.revision)||d.revision<1||!Number.isSafeInteger(now)||!Number.isSafeInteger(d.issuedAt)||!Number.isSafeInteger(d.expiresAt)||d.issuedAt>now||d.expiresAt<=now||d.expiresAt-d.issuedAt>60000||!Array.isArray(d.requests)||!d.requests.length||d.requests.length>128)fail();
  const seen=new Set();
  for(const r of d.requests){
    if(!exact(r,['method','url','kind','bodySha256','requestDigest'])||!hex(r.bodySha256)||!hex(r.requestDigest)||!['document','popup','subframe','resource','css','font','image','script','fetch','beacon','download','credential','prefetch','websocket'].includes(r.kind)||parseBrowserUrl(r.url).url!==r.url||!(d.purpose==='browser-read-manifest'?['GET','HEAD','OPTIONS']:['POST','PUT','PATCH','DELETE']).includes(r.method))fail();
    const key=canonical(r);if(seen.has(key))fail();seen.add(key);
  }
  return structuredClone(d);
}
export class DurableJournal {
  constructor(directory){if(!path.isAbsolute(directory))fail();this.directory=directory;}
  async claim(kind,id,record){
    if(!/^[a-z-]{1,32}$/.test(kind)||!hex(id))fail();
    const s=await lstat(this.directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))fail();
    const bytes=Buffer.from(canonical(record));if(bytes.length>65536)fail();
    const fd=await open(path.join(this.directory,kind+'-'+id+'.json'),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
    const dir=await open(this.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await dir.sync();}finally{await dir.close();}
    return {id,digest:sha256(bytes)};
  }
}
export function createAuthority({publicKey,now=Date.now,runId,taskId,userId,bootId,journal,checkpoint,verifyCheckpoint}){
  if(![runId,taskId,userId,bootId].every(uuid)||!journal||typeof checkpoint!=='function'||typeof verifyCheckpoint!=='function')fail();
  const admitted=new Map(),writes=new Map(),unknowns=new Map(),used=new Set();let dead=false;
  // used: (manifest, request) pairs already taken in this process, marked synchronously so concurrent identical
  // requests never select the same one-use manifest. The durable journal claim still enforces one use across restarts.
  const useId=(d,request)=>sha256(canonical([runId,d.manifestId,request]));
  const alive=()=>{if(dead)fail();};
  const api={
    async admit(envelope){
      alive();const d=verifyManifest(envelope,{publicKey,now:now(),runId,taskId,userId,bootId});
      const digest=sha256(canonical(d)),id=sha256(canonical([runId,d.manifestId]));
      // Manifest ID, not only the envelope hash: re-signing changed bytes cannot
      // reuse an already admitted authority, including across process restart.
      await journal.claim('manifest',id,{digest,manifestId:d.manifestId,runId,bootId});alive();
      const token=Object.freeze({manifestId:d.manifestId,digest});admitted.set(token,d);return token;
    },
    async consume(token,request){
      alive();const d=admitted.get(token);if(!d||now()>=d.expiresAt||!d.requests.some(r=>canonical(r)===canonical(request)))fail();
      const id=useId(d,request),kind=d.purpose==='browser-action-manifest'?'write':'read';
      if(used.has(id))fail();used.add(id);
      const receipt={runId,taskId,bootId,manifestDigest:token.digest,manifestRevision:d.revision,requestDigest:sha256(canonical(request)),kind,at:now(),outcome:kind==='write'?'unknown':'consumed'};
      // Insert into pending set BEFORE durability awaits so boot revocation
      // includes a consume racing with checkpoint/fsync.
      if(kind==='write')writes.set(id,receipt);
      const committed=await journal.claim('consume',id,receipt);alive();
      const ack=await checkpoint({...committed,runId,bootId,kind});alive();
      if(await verifyCheckpoint(ack,{...committed,runId,bootId,kind})!==true)fail();alive();
      await journal.claim('checkpoint',id,{...committed,ack});alive();
      return Object.freeze({...receipt,consumeReceipt:committed,auditAck:ack});
    },
    async authorizeFetch(request){alive();return [...admitted.values()].some(d=>now()<d.expiresAt&&d.requests.some(r=>r.method===request.method&&r.url===request.url&&r.kind===request.kind));},
    // Select an admitted, unexpired manifest whose (manifest, request) use is still unspent — never the first match blindly.
    async authorizeRequest(request){alive();for(const [token,d]of admitted)if(now()<d.expiresAt&&d.requests.some(r=>canonical(r)===canonical(request))&&!used.has(useId(d,request)))return api.consume(token,request);fail();},
    async unknown(id){if(!hex(id)||!writes.has(id))fail();if(!unknowns.has(id))unknowns.set(id,journal.claim('unknown',id,{...writes.get(id),outcome:'unknown',retry:false}));return unknowns.get(id);},
    async unknownAll(){dead=true;const outcomes=await Promise.allSettled([...writes.keys()].map(id=>api.unknown(id)));if(outcomes.some(r=>r.status==='rejected'))fail();},
  };return api;
}
