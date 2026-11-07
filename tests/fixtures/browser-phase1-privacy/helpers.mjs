import {randomUUID,createHash} from 'node:crypto';
import {buildReadManifest} from '../../../lib/browser/read-manifest.mjs';
import {canonical} from '../../../lib/browser/acceptance-attestation.mjs';
import {EMPTY_BODY_SHA256} from '../../../lib/browser/outbound-data.mjs';
export const key=Buffer.alloc(32,17);
export const makeTask=(over={})=>({id:randomUUID(),current_run_id:randomUUID(),state:'active',private:false,privacy_mode:'public',vault_dependency:'none',manifest_revision:1,read_manifest_revision:1,control_epoch:0,document_epoch:0,controller_boot_id:randomUUID(),context_generation:0,listener_generation:1,revision:1,attention:'none',origins:{v:1,entries:[{origin:'https://portal.example',role:'document'}]},...over});
export function makeManifest(task=makeTask(),over={}){
 const now=Date.now();return buildReadManifest({proposal:{v:1,entries:[{url:'https://portal.example/public',role:'document',source:'person'}]},actorProof:{task,confirmedFacts:{values:[],classifyPublicUrl:()=>true},key,userId:randomUUID(),sessionId:randomUUID(),sessionExpiresAt:now+300000,now,authorize:()=>true,...over},expectedRevision:task.read_manifest_revision});
}
export function makeRequest(over={}){
 const r={method:'GET',url:'https://portal.example/public',kind:'document',headers:[],bodySha256:EMPTY_BODY_SHA256,...over};
 r.requestDigest=createHash('sha256').update(canonical({method:r.method,url:r.url,headers:r.headers,bodySha256:r.bodySha256})).digest('hex');return r;
}
export const provenance={classification:'public_nonbusiness'};
