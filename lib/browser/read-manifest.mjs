/** Person-reviewed exact public reads. Origins, caller labels and hashes alone
 * never grant authority. The classifier and actor proof are trusted web adapters. */
import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {ReadProposal,ReadEntry,ReadManifestV1,ReadCandidate,OriginManifest,UUID,UInt} from './phase1-contracts.mjs';
import {parseBrowserUrl} from './network-policy.mjs';
import {canonical} from './acceptance-attestation.mjs';
const verified=new WeakSet();
const fail=(code='BROWSER_READ_PROVENANCE_UNKNOWN')=>{throw Error(code);};
export const hasMutationSemantics=url=>/(?:^|[^a-z])(?:submit|pay|payment|sign|delete|remove|save|commit|update|create|checkout|purchase|approve|autosave|send|logout)(?:$|[^a-z])/i.test(decodeURIComponent(new URL(url).pathname+new URL(url).search));
const keyCheck=key=>{if(!(key instanceof Uint8Array)||key.length!==32)fail();};
export function readManifestDigest(manifest,key) {
  keyCheck(key);const {digest,...content}=manifest;
  return createHmac('sha256',key).update('browser-phase1-read-manifest:'+canonical(content)).digest('hex');
}
export function verifyReadManifest(manifest,{key,now=Date.now()}={}) {
  const parsed=ReadManifestV1.parse(manifest);
  const actual=readManifestDigest(parsed,key);
  if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(parsed.digest,'hex')))fail();
  for(const e of parsed.entries){
    if(parseBrowserUrl(e.canonical_url).url!==e.canonical_url||Date.parse(e.approved_at)>now||Date.parse(e.expires_at)<=now||e.value_schema.static_rule_id!==null||canonical(e.value_schema.query)!==canonical([...new URL(e.canonical_url).searchParams].map(([key,value])=>({key,value}))))fail();
    for(const pair of e.value_schema.query)Object.freeze(pair);Object.freeze(e.value_schema.query);Object.freeze(e.value_schema);Object.freeze(e.provenance);Object.freeze(e);
  }
  Object.freeze(parsed.entries);Object.freeze(parsed);verified.add(parsed);return parsed;
}
export const isVerifiedReadManifest=manifest=>verified.has(manifest);
function includesFact(url,values) {
  const decoded=decodeURIComponent(url).toLowerCase();
  return values.some(value=>{
    if(typeof value!=='string'||!value.length)return false;
    return [value,Buffer.from(value).toString('base64'),Buffer.from(value).toString('base64url'),Buffer.from(value).toString('hex')].some(x=>decoded.includes(x.toLowerCase()));
  });
}
export function validateReadProposal({proposal,task,confirmedFacts,now=Date.now()}) {
  const p=ReadProposal.parse(proposal),entries=[],candidates=[],blocked_entries=[];
  const origins=OriginManifest.parse(task.origins),epoch=UInt.parse(task.document_epoch);
  for(const item of p.entries){
    const id=randomUUID();let code='BROWSER_READ_PROVENANCE_UNKNOWN',url;
    try {
      if(task.private!==false||task.privacy_mode!=='public')fail();
      url=parseBrowserUrl(item.url).url;
      const origin=origins.entries.find(x=>x.origin===new URL(url).origin);
      if(!origin||(item.role==='document'&&origin.role==='resource'))fail('BROWSER_SITE_BLOCKED');
      if(hasMutationSemantics(url)||item.static_rule_id||!confirmedFacts||!Array.isArray(confirmedFacts.values)||typeof confirmedFacts.classifyPublicUrl!=='function'||includesFact(url,confirmedFacts.values)||confirmedFacts.classifyPublicUrl(url,{role:item.role,source:item.source})!==true)fail();
      entries.push({id,url,role:item.role,source:item.source,parent_document_epoch:epoch+1});
      code='BROWSER_REVIEW_REQUIRED';
    }catch(error){code=['BROWSER_SITE_BLOCKED','BROWSER_READ_PROVENANCE_UNKNOWN'].includes(error.message)?error.message:'BROWSER_READ_PROVENANCE_UNKNOWN';blocked_entries.push({id,code});}
    // Only verified-public URLs can appear in the protected human review sheet.
    if(code==='BROWSER_REVIEW_REQUIRED')candidates.push(ReadCandidate.parse({id,url,role:item.role,source:item.source,code,server_deadline:new Date(now+60000).toISOString(),parent_document_epoch:epoch+1}));
  }
  return {entries,candidates,blocked_entries};
}
export function buildReadManifest({proposal,actorProof,expectedRevision}) {
  const {task,confirmedFacts,key,userId,sessionId,sessionExpiresAt,now=Date.now()}=actorProof;
  UUID.parse(userId);UUID.parse(sessionId);UInt.parse(expectedRevision);
  if(typeof actorProof.authorize!=='function'||actorProof.authorize()!==true||expectedRevision!==task.read_manifest_revision||!Number.isSafeInteger(now)||!Number.isFinite(sessionExpiresAt)||sessionExpiresAt<=now)fail('BROWSER_REVIEW_STALE');
  const checked=validateReadProposal({proposal,task,confirmedFacts,now});
  if(checked.blocked_entries.length||!checked.entries.some(e=>e.role==='document'))fail();
  const expiry=new Date(Math.min(now+300000,sessionExpiresAt)).toISOString();
  const entries=checked.entries.map(e=>ReadEntry.parse({id:e.id,role:e.role,method:'GET',canonical_url:e.url,headers_schema_id:'anonymous_public_v1',value_schema:{v:1,kind:'exact_public',query:[...new URL(e.url).searchParams].map(([key,value])=>({key,value})),static_rule_id:null},provenance:{v:1,source:e.source,classification:'public_nonbusiness',source_ref:null},approved_by:userId,approved_session_id:sessionId,approved_at:new Date(now).toISOString(),expires_at:expiry,max_uses:e.role==='document'?1:32,parent_document_epoch:e.parent_document_epoch,release_action_id:null}));
  const content={v:1,revision:expectedRevision+1,initial_entry_id:entries.find(e=>e.role==='document').id,entries};
  return verifyReadManifest({...content,digest:readManifestDigest(content,key)},{key,now});
}
export async function publishReadManifest({proposal,actorProof,expectedRevision,repository}) {
  const manifest=buildReadManifest({proposal,actorProof,expectedRevision});
  // Website adapter calls browserWebReads, in a transaction with its web proof.
  // It must resolve only after COMMIT; no service approval capability is exposed.
  if(typeof repository?.publishReadManifest!=='function')fail();
  await repository.publishReadManifest({manifest,expectedRevision});return manifest;
}
/** Discovery does not approve or replay. A website repository adapter persists
 * an immutable pending revision and serves these URLs only to the human sheet. */
export async function stageReadCandidates({proposal,task,confirmedFacts,repository,now=Date.now()}) {
  const result=validateReadProposal({proposal,task,confirmedFacts,now});
  const candidates=result.candidates;
  if(candidates.length){
    if(typeof repository?.stageReadCandidates!=='function')fail();
    await repository.stageReadCandidates({taskId:task.id,expectedRevision:task.read_manifest_revision,candidates});
  }
  return {candidates,blocked_entries:result.blocked_entries};
}
