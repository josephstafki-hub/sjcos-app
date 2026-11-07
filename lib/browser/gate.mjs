/** Serialized request authority. This is containment, never an origin-only read
 * authorization. Parser must call reserve BEFORE allocation, not after hooks.
 * No I/O here; the transport adapter owns closing sockets and durable outcomes. */
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createNetworkPolicy,decideRequest,validateAuthorityBinding,validateSocketPeer,validateTaskManifest} from './network-policy.mjs';
import {createBudget,reserveFlow,abortFlow,releaseFlow,markFlowConsumed,validateResponseHeaders,accountResponseChunk,accountTransport,drainTransport,expireFlows,MiB} from './response-budget.mjs';
const deny=(code='BROWSER_SERVICE_UNAVAILABLE',outcome='failed')=>({ok:false,code,outcome,retry:false});
const boundedId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(x);
export function requestHeaders(method,headers) {
  if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method)||!Array.isArray(headers)||headers.length>128) throw Error('BROWSER_BAD_INPUT');
  const out=[],seen=new Set();let size=0;
  for(const pair of headers) {
    if(!Array.isArray(pair)||pair.length!==2||pair.some(x=>typeof x!=='string'))throw Error('BROWSER_BAD_INPUT');
    const [raw,value]=pair,name=raw.toLowerCase();
    if(!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)||/[\x00-\x1f\x7f]/.test(value)||seen.has(name))throw Error('BROWSER_BAD_INPUT');
    size+=Buffer.byteLength(name)+Buffer.byteLength(value)+4;if(size>32768)throw Error('BROWSER_BAD_INPUT');seen.add(name);
    if(['transfer-encoding','trailer','expect','upgrade','proxy-authorization','proxy-authenticate'].includes(name))throw Error('BROWSER_BAD_INPUT');
    if(name==='content-encoding'&&value!=='identity')throw Error('BROWSER_BAD_INPUT');
    // No application cookies/Referer released by baseline. Future exact adapters
    // must explicitly project/review site cookies; never copy application headers.
    if(['authorization','referer','cookie'].includes(name))throw Error('BROWSER_FORBIDDEN');
    if(name!=='accept-encoding')out.push([name,value]);
  }
  const length=out.find(([n])=>n==='content-length')?.[1];
  const bodyMethod=['POST','PUT','PATCH','DELETE'].includes(method);
  if(length!==undefined&&!/^(0|[1-9][0-9]{0,7})$/.test(length))throw Error('BROWSER_BAD_INPUT');
  if(bodyMethod&&length===undefined)throw Error('BROWSER_BAD_INPUT');
  const bytes=length===undefined?0:Number(length);
  if(bytes>25*MiB||(!bodyMethod&&bytes!==0))throw Error('BROWSER_BAD_INPUT');
  out.push(['accept-encoding','identity']);return {headers:out,bytes};
}
export class RequestGate {
  #policy; #clock; #close; #key; #listeners=new Map(); #flows=new Map(); #budget; #dead=false;
  constructor({config,now=Date.now,closeListener,baselineBytes=144*MiB,key=randomBytes(32)}={}) {
    if(typeof closeListener!=='function'||!Buffer.isBuffer(key)||key.length!==32)throw Error('BROWSER_BAD_INPUT');
    this.#policy=createNetworkPolicy(config);this.#clock=now;this.#close=closeListener;this.#key=Buffer.from(key);this.#budget=createBudget({baselineBytes,contextOrder:['slot1','slot2']});
  }
  bind(binding) {
    const b=structuredClone(binding),old=this.#listeners.get(b.listener);
    if(this.#dead||![18081,18082].includes(b.listener)||!Number.isSafeInteger(b.generation)||b.generation<1||!['contextId','taskId','bootId'].every(k=>boundedId(b[k]))||!b.manifest)throw Error('BROWSER_BAD_INPUT');
    validateTaskManifest(b.manifest);
    if(old){if(b.generation<=old.generation)throw Error('BROWSER_REVOKED');this.revoke(b.listener);if(this.#dead)throw Error('BROWSER_REVOKED');}
    if([...this.#listeners.values()].some(x=>x.active&&x.contextId===b.contextId))throw Error('BROWSER_BUSY');
    this.#listeners.set(b.listener,{...b,active:true,slot:b.listener===18081?'slot1':'slot2'});
  }
  headers(input) {
    try {
      const x=structuredClone(input),l=this.#listeners.get(x.listener),now=this.#clock();
      if(this.#dead||!l?.active||x.generation!==l.generation||!boundedId(x.id)||this.#flows.has(x.id)||x.transport!=='tcp'||x.protocol!=='http/1.1')return deny();
      const parsed=requestHeaders(x.method,x.headers);
      if(parsed.headers.find(([n])=>n==='host')?.[1]!==x.hostAuthority)return deny();
      if(!validateAuthorityBinding(x).ok)return deny('BROWSER_SITE_BLOCKED');
      const decision=decideRequest(this.#policy,{...x,manifest:l.manifest,guardAttached:true,listenerGeneration:l.generation,now});
      if(!decision.ok)return decision;
      const r=reserveFlow(this.#budget,{id:x.id,contextId:l.slot,now,requestBytes:parsed.bytes,requestCopies:2,requestOverheadBytes:4096,transportBytes:4096});
      if(!r.ok)return deny(r.code);this.#budget=r.budget;
      this.#flows.set(x.id,{listener:x.listener,generation:x.generation,taskId:l.taskId,bootId:l.bootId,manifestRevision:decision.manifestRevision,pin:decision.pin,created:now,deadline:now+60000,bytes:parsed.bytes,method:x.method,url:decision.url,headers:parsed.headers,state:'collecting'});
      return {ok:true,readLimit:parsed.bytes,bodyDeadline:now+15000};
    }catch{return deny('BROWSER_BAD_INPUT');}
  }
  body(id,bytes) {
    const f=this.#flows.get(id),now=this.#clock();
    if(!f||f.state!=='collecting'||!this.#live(f)||now>=f.created+15000||!Buffer.isBuffer(bytes)||bytes.length!==f.bytes)return this.finish(id,false);
    // Full worst-case immutable copy was reserved at headers. HMAC never logs.
    f.body=Buffer.from(bytes);f.nonce=randomUUID();f.digest=createHmac('sha256',this.#key).update(JSON.stringify([f.method,f.url,f.headers,f.generation,f.nonce])).update(f.body).digest('hex');f.state='awaiting';
    return {ok:true,digest:f.digest,nonce:f.nonce,deadline:f.deadline,manifestRevision:f.manifestRevision};
  }
  #live(f) {const l=this.#listeners.get(f.listener);return !this.#dead&&l?.active&&l.generation===f.generation&&l.bootId===f.bootId&&this.#clock()<f.deadline;}
  dispatch(id,proof,verify) {
    const f=this.#flows.get(id),now=this.#clock();
    try {
      if(!f||f.state!=='awaiting'||!this.#live(f)||proof?.digest!==f.digest||proof.nonce!==f.nonce||proof.generation!==f.generation||proof.taskId!==f.taskId||proof.bootId!==f.bootId||proof.manifestRevision!==f.manifestRevision||!Number.isSafeInteger(proof.readManifestRevision)||proof.readManifestRevision<1||!/^([a-f0-9]{64})$/.test(proof.readManifestDigest)||!Number.isFinite(proof.issuedAt)||proof.issuedAt>now||!Number.isFinite(proof.expiresAt)||proof.expiresAt<=now||proof.expiresAt>f.deadline||proof.expiresAt-proof.issuedAt>2000||!['read','write'].includes(proof.kind)||typeof verify!=='function'||verify(proof)!==true) return this.finish(id,false);
      if(proof.kind==='write'&&(!proof.consumeReceipt||!proof.auditAck))return this.finish(id,false);
      // Mark conservative unknown BEFORE the one possible send. Signed verifier
      // must validate durable receipt + independent checkpoint for exact digest.
      if(proof.kind==='write'){const r=markFlowConsumed(this.#budget,id,now);this.#budget=r.budget;if(!r.ok)return this.finish(id,false);}
      f.state='dispatched';f.decisionExpiresAt=proof.expiresAt;return {ok:true,pin:{...f.pin},sni:f.pin.hostname};
    }catch{return this.finish(id,false);}
  }
  peer(id,peer){const f=this.#flows.get(id);if(!f||f.state!=='dispatched'||!this.#live(f)||this.#clock()>=f.decisionExpiresAt||!validateSocketPeer(f.pin,peer,this.#clock()).ok)return this.finish(id,false);f.state='sending';return {ok:true};}
  takeRequest(id){const f=this.#flows.get(id);if(!f||f.state!=='sending'||!this.#live(f)||this.#clock()>=f.decisionExpiresAt)return this.finish(id,false);f.state='sent';const body=f.body;f.body=null;return {ok:true,headers:structuredClone(f.headers),body};}
  responseHeaders(id,headers){const f=this.#flows.get(id);if(!f||f.state!=='sent'||!this.#live(f)||!validateResponseHeaders(headers).ok)return this.finish(id,false);f.responseLength=headers.length??null;f.received=0;return {ok:true};}
  responseChunk(id,bytes){const f=this.#flows.get(id);if(!f||!this.#live(f)||f.received===undefined)return this.finish(id,false);const r=accountResponseChunk(this.#budget,id,{bytes,encoding:'identity',now:this.#clock()});this.#budget=r.budget;if(!r.ok)return this.finish(id,false);f.received+=bytes;return {ok:true};}
  transport(id,bytes,direction){const f=this.#flows.get(id);if(!f||!this.#live(f))return this.finish(id,false);const r=accountTransport(this.#budget,id,{bytes,direction,now:this.#clock()});this.#budget=r.budget;if(!r.ok&&!r.pauseReads)return this.finish(id,false);return {...r,budget:undefined};}
  drain(id,bytes,direction){const r=drainTransport(this.#budget,id,{bytes,direction});this.#budget=r.budget;return {...r,budget:undefined};}
  finish(id,success=false){const f=this.#flows.get(id);if(success&&(!f||!this.#live(f)||f.received===undefined||(f.responseLength!==null&&f.responseLength!==f.received)))success=false;const r=abortFlow(this.#budget,id);this.#budget=success?releaseFlow(this.#budget,id):r.budget;if(f?.body)f.body.fill(0);this.#flows.delete(id);return success?{ok:true,outcome:'succeeded'}:deny('BROWSER_SERVICE_UNAVAILABLE',r.outcome);}
  revoke(listener){const l=this.#listeners.get(listener);if(!l)return [];l.active=false;const outcomes=[];for(const [id,f]of this.#flows)if(f.listener===listener)outcomes.push({id,...this.finish(id,false)});try{if(this.#close(listener,l.generation)!==true)this.#dead=true;}catch{this.#dead=true;}return outcomes;}
  interceptionLost(){this.#dead=true;return [...this.#listeners.keys()].flatMap(l=>this.revoke(l));}
  tick(){const bodyTimeouts=[];for(const [id,f]of this.#flows)if(f.state==='collecting'&&this.#clock()>=f.created+15000)bodyTimeouts.push({id,...this.finish(id,false)});const r=expireFlows(this.#budget,this.#clock());this.#budget=r.budget;for(const {id}of r.outcomes){const f=this.#flows.get(id);f?.body?.fill(0);this.#flows.delete(id);}return [...bodyTimeouts,...r.outcomes];}
  stats(){return {dead:this.#dead,flows:this.#flows.size,pools:{...this.#budget.pools}};}
}
/** Wrap every addon/IPC callback. Never let an exception return to forwarding. */
export async function dispatchClosed(gate,operation){try{return await operation();}catch{gate.interceptionLost();return deny();}}
