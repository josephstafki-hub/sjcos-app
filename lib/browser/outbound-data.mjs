/** Anonymous Phase 1 header/value policy. Exact manifest covers ALL path/query
 * bytes. No automatic trust for same-origin scripts, hash-like assets or GET. */
import {createHash} from 'node:crypto';
import {parseBrowserUrl} from './network-policy.mjs';
import {isVerifiedReadManifest,hasMutationSemantics} from './read-manifest.mjs';
export const EMPTY_BODY_SHA256=createHash('sha256').update('').digest('hex');
const fixedHeaders=Object.freeze({
 'accept':['*/*','text/html','text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8','text/css,*/*;q=0.1','image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'],
 'accept-encoding':['identity'],
 'user-agent':['SJC-Public-Browser/1'],
 'sec-fetch-mode':['navigate','no-cors','cors','same-origin'],
 'sec-fetch-site':['none','same-origin','same-site','cross-site'],
 'sec-fetch-dest':['document','style','script','image','font','empty'],
 'sec-fetch-user':['?1'],
 'upgrade-insecure-requests':['1'],
});
export function validatePublicHeaders(headers,url) {
  if(!Array.isArray(headers)||headers.length>16)return false;
  const seen=new Set(),host=new URL(url).host;
  for(const pair of headers){
    if(!Array.isArray(pair)||pair.length!==2||pair.some(x=>typeof x!=='string'))return false;
    const [raw,value]=pair,name=raw.toLowerCase();
    if(seen.has(name)||/[\x00-\x1f\x7f]/u.test(value))return false;seen.add(name);
    if(name==='host'){if(value!==host&&value!==host+':443')return false;continue;}
    if(name==='content-length'){if(value!=='0')return false;continue;}
    if(!Object.hasOwn(fixedHeaders,name)||!fixedHeaders[name].includes(value))return false;
  }
  return true;
}
export function classifyRequest({request,task,readManifest,provenance,now=Date.now()}) {
  const block=(code='BROWSER_PHASE1_READ_ONLY')=>({kind:'blocked',code,notice_kind:'write_blocked'});
  try {
    if(task?.private!==false||task.privacy_mode!=='public'||!['starting','active','paused'].includes(task.state)||!['GET','HEAD'].includes(request.method)||!['document','resource'].includes(request.kind)||request.bodySha256!==EMPTY_BODY_SHA256||!validatePublicHeaders(request.headers,request.url))return block();
    if(!isVerifiedReadManifest(readManifest)||readManifest.revision!==task.read_manifest_revision)return block('BROWSER_REVIEW_STALE');
    if(provenance?.classification!=='public_nonbusiness')return block('BROWSER_READ_PROVENANCE_UNKNOWN');
    const parsed=parseBrowserUrl(request.url);
    if(parsed.url!==request.url||hasMutationSemantics(parsed.url))return block();
    const entry=readManifest.entries.find(e=>e.canonical_url===request.url&&e.method===request.method&&e.role===request.kind);
    if(!entry)return block('BROWSER_REVIEW_REQUIRED');
    if(Date.parse(entry.expires_at)<=now)return block('BROWSER_READ_EXPIRED');
    if(entry.parent_document_epoch!==task.document_epoch+(entry.role==='document'?1:0))return block('BROWSER_REVIEW_STALE');
    return {kind:'read',entry_id:entry.id};
  }catch{return block();}
}
