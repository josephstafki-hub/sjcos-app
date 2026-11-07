/** Production-only exact-read authority. No fixture signer, OPTIONS or writes.
 * Repository transactions resolve after COMMIT; audit anchors must already be
 * independently checkpointed before the one-use SQL consume can succeed. */
import {validateReadProposal} from './read-manifest.mjs';
import {createHmac,createHash,sign,verify,randomUUID} from 'node:crypto';
import {ReadEntry,ReadConsumeProof,ReadDispatchV1,UUID} from './phase1-contracts.mjs';
import {browserReadConsume} from './repository.mjs';
import {canonical} from './acceptance-attestation.mjs';
import {classifyRequest,EMPTY_BODY_SHA256} from './outbound-data.mjs';
import {verifyReadManifest} from './read-manifest.mjs';
const fail=()=>{throw Error('BROWSER_PHASE1_READ_ONLY');};
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function actualRequestHmac({actualRequest,binding,flow,key}) {
  if(!(key instanceof Uint8Array)||key.length!==32)fail();
  return createHmac('sha256',key).update('browser-phase1-actual-request:'+canonical({request:actualRequest,binding,flow_nonce:flow.nonce})).digest('hex');
}
export async function prepareReadDispatch({task,entry,actualRequest,flow,binding,repository,audit}) {
  entry=ReadEntry.parse(entry);UUID.parse(flow.nonce);
  const classification=classifyRequest({request:actualRequest,task,readManifest:flow.readManifest,provenance:flow.provenance,now:(flow.now??Date.now)()});
  if(classification.kind!=='read'||classification.entry_id!==entry.id)fail();
  const now=flow.now??Date.now,monotonicNow=flow.monotonicNow??(()=>performance.now());
  const expired=()=>now()>=flow.deadline||!Number.isFinite(flow.monotonicDeadline)||monotonicNow()>=flow.monotonicDeadline;
  if(task.private||task.privacy_mode!=='public'||task.state!=='active'||!['GET','HEAD'].includes(actualRequest.method)||actualRequest.bodySha256!==EMPTY_BODY_SHA256||entry.canonical_url!==actualRequest.url||entry.method!==actualRequest.method||entry.role!==actualRequest.kind||entry.parent_document_epoch!==task.document_epoch+(entry.role==='document'?1:0)||Date.parse(entry.expires_at)<=now()||binding.taskId!==task.id||binding.bootId!==task.controller_boot_id||binding.generation!==task.listener_generation||binding.contextGeneration!==task.context_generation||!binding.guardId||!binding.targetId||!binding.listenerCookie||!Number.isSafeInteger(flow.deadline)||flow.deadline<=now())fail();
  const headers=actualRequest.headers;
  if(actualRequest.requestDigest!==hash({method:actualRequest.method,url:actualRequest.url,headers,bodySha256:actualRequest.bodySha256}))fail();
  const request_hmac=actualRequestHmac({actualRequest,binding,flow,key:flow.requestKey});
  const intent={boot_id:task.controller_boot_id,context_generation:task.context_generation,revision:task.read_manifest_revision,entry_id:entry.id,manifest_digest:flow.manifestDigest,request_hmac,flow_nonce:flow.nonce,listener_generation:task.listener_generation,document_epoch:task.document_epoch,control_epoch:task.control_epoch};
  await audit.anchorReadIntent({task_id:task.id,binding:intent});
  if(expired())fail();
  const proof=ReadConsumeProof.parse(await repository.transaction(client=>browserReadConsume(client,{tid:task.id,boot:task.controller_boot_id,revision:task.read_manifest_revision,entry:entry.id,manifest_d:Buffer.from(flow.manifestDigest,'hex'),request_d:Buffer.from(request_hmac,'hex'),flow_nonce:flow.nonce,generation:task.listener_generation,epoch:task.control_epoch})));
  // Do not trust a structurally valid proof for a different principal or flow.
  const expected={task_id:task.id,original_run_id:task.current_run_id,boot_id:task.controller_boot_id,context_generation:task.context_generation,task_origins_revision:task.manifest_revision,manifest_revision:task.read_manifest_revision,manifest_digest:flow.manifestDigest,entry_id:entry.id,parent_document_epoch:entry.parent_document_epoch,request_hmac,flow_nonce:flow.nonce,listener_generation:task.listener_generation};
  for(const [key,value]of Object.entries(expected))if(proof[key]!==value)fail();
  if(proof.use_ordinal>entry.max_uses)fail();
  const issued=now(),expires=Math.min(issued+2000,flow.deadline,Date.parse(proof.expires_at),Date.parse(entry.expires_at));
  if(expires<=issued||expired())fail();
  const payload={v:1,purpose:'browser-phase1-read-dispatch',proof,request:{method:actualRequest.method,url:actualRequest.url,kind:actualRequest.kind,bodySha256:actualRequest.bodySha256,requestDigest:actualRequest.requestDigest},decision_id:randomUUID(),issued_at:new Date(issued).toISOString(),expires_at:new Date(expires).toISOString()};
  if(flow.dispatchPrivateKey?.asymmetricKeyType!=='ed25519')fail();
  return ReadDispatchV1.parse({...payload,signature:sign(null,Buffer.from(canonical(payload)),flow.dispatchPrivateKey).toString('base64')});
}
export function verifyReadDispatch(dispatch,{publicKey,now=Date.now()}={}) {
  const d=ReadDispatchV1.parse(dispatch),{signature,...payload}=d;
  if(publicKey?.asymmetricKeyType!=='ed25519'||Date.parse(d.issued_at)>now||Date.parse(d.expires_at)<=now||!verify(null,Buffer.from(canonical(payload)),publicKey,Buffer.from(signature,'base64')))fail();return d;
}
export function createPhase1ReadAuthority({contextFor,repository,audit,manifestKey,requestKey,dispatchPrivateKey,dispatchPublicKey,journal,stageDiscovery,confirmedFactsFor,now=Date.now,monotonicNow=()=>performance.now()}) {
  if([contextFor,repository?.transaction,audit?.anchorReadIntent,journal?.claim].some(x=>typeof x!=='function'))fail();
  const pending=new Map();let dead=false;
  const current=async meta=>{if(dead)fail();const c=await contextFor(meta);if(dead||c?.eligible!==true||!c.task||!c.binding||meta?.targetId!==c.binding.targetId)fail();return {...c,task:structuredClone(c.task),binding:structuredClone(c.binding)};};
  return Object.freeze({phase:1,
    async discoverFetch(request,meta){
      const c=await current(meta);
      if(typeof stageDiscovery!=='function'||typeof confirmedFactsFor!=='function'||!['GET','HEAD'].includes(request.method)||!['document','resource'].includes(request.kind)||c.task.private||c.task.privacy_mode!=='public')return false;
      const facts=await confirmedFactsFor(c.task),proposal={v:1,entries:[{url:request.url,role:request.kind,source:'page'}]};
      if(validateReadProposal({proposal,task:c.task,confirmedFacts:facts,now:now()}).blocked_entries.length)return false;
      const after=await current(meta);if(canonical(after.binding)!==canonical(c.binding)||after.task.control_epoch!==c.task.control_epoch)return false;
      await stageDiscovery({task:c.task,proposal});return true;
    },
    async authorizeFetch(request,meta){const c=await current(meta);const m=verifyReadManifest(c.manifest,{key:manifestKey,now:now()});return classifyRequest({request:{...request,bodySha256:EMPTY_BODY_SHA256},task:c.task,readManifest:m,provenance:c.provenance,now:now()}).kind==='read';},
    async authorizeRequest(request,meta){
      const started=now(),monotonicDeadline=monotonicNow()+2000,c=await current(meta),manifest=verifyReadManifest(c.manifest,{key:manifestKey,now:now()});
      const actualRequest=structuredClone({...request,headers:meta.headers});
      const result=classifyRequest({request:actualRequest,task:c.task,readManifest:manifest,provenance:c.provenance,now:now()});if(result.kind!=='read')fail();
      const flow={nonce:randomUUID(),deadline:started+2000,monotonicDeadline,monotonicNow,now,manifestDigest:manifest.digest,readManifest:manifest,provenance:c.provenance,requestKey,dispatchPrivateKey};
      // Durable claim burns on all failures/restarts; never auto-replay a flow.
      await journal.claim('phase1-read',hash([c.task.id,c.binding,meta.id]),{task_id:c.task.id,flow_nonce:flow.nonce});
      const dispatch=await prepareReadDispatch({task:c.task,entry:manifest.entries.find(e=>e.id===result.entry_id),actualRequest,flow,binding:c.binding,repository,audit});
      const after=await current(meta);
      if(after.task.private||after.task.control_epoch!==c.task.control_epoch||after.task.context_generation!==c.task.context_generation||after.task.read_manifest_revision!==manifest.revision||canonical(after.binding)!==canonical(c.binding)||now()>=flow.deadline||monotonicNow()>=monotonicDeadline)fail();
      pending.set(dispatch.decision_id,{dispatch,meta,binding:c.binding,monotonicDeadline,controlEpoch:c.task.control_epoch});
      return {kind:'read',expiresAt:Date.parse(dispatch.expires_at),dispatch};
    },
    async authorizeDispatch(receipt,meta){
      const dispatch=verifyReadDispatch(receipt.dispatch,{publicKey:dispatchPublicKey,now:now()}),p=pending.get(dispatch.decision_id);
      if(!p||canonical(dispatch)!==canonical(p.dispatch)||meta.id!==p.meta.id||meta.targetId!==p.meta.targetId)fail();
      pending.delete(dispatch.decision_id); // one dispatch, including re-entrant races
      const c=await current(meta),proof=dispatch.proof;
      if(c.task.private||c.task.state!=='active'||c.task.current_run_id!==proof.original_run_id||c.task.control_epoch!==p.controlEpoch||c.task.context_generation!==proof.context_generation||c.task.manifest_revision!==proof.task_origins_revision||c.task.read_manifest_revision!==proof.manifest_revision||c.task.document_epoch!==proof.parent_document_epoch||canonical(c.binding)!==canonical(p.binding)||now()>=Date.parse(dispatch.expires_at)||monotonicNow()>=p.monotonicDeadline)fail();
      return true;
    },
    async unknownAll(){dead=true;pending.clear();},
  });
}
