/** Observation strings are untrusted page data, never tool instructions. Only
 * server-extracted visible text nodes/control metadata are accepted; raw HTML,
 * console, network bodies, values and titles have no output channel here. */
import {randomUUID} from 'node:crypto';
import {ObservationV1,CONTROL_ROLES} from './contracts.mjs';
import {UUID,UInt} from './phase1-contracts.mjs';
import {parseBrowserUrl} from './network-policy.mjs';
const sensitive=/password|credential|payment|credit.?card|cc.?number|cvc|cvv|otp|one.?time|token|secret|session|authorization/i;
const clean=(s,max)=>typeof s==='string'?s.replace(/<[^>]*>/gu,'').replace(/[\u0000-\u001f\u007f-\u009f]/gu,' ').slice(0,max):'';
export function sanitizePublicObservation({raw,task,observationId=randomUUID(),now=Date.now()}) {
  UUID.parse(observationId);UInt.parse(task.document_epoch);
  if(!Number.isSafeInteger(now))throw Error('BROWSER_OBSERVATION_STALE');
  const base={ok:true,observation_id:observationId,document_epoch:task.document_epoch,expires_at:new Date(now+30000).toISOString()};
  if(task.private!==false||task.privacy_mode!=='public')return ObservationV1.parse({...base,private:true,adapter_id:null,controls:[]});
  try{
    if(!raw||!Array.isArray(raw.textNodes)||!Array.isArray(raw.controls)||raw.textNodes.length>10000||raw.controls.length>10000)throw Error();
    const origin=parseBrowserUrl(raw.url).origin;
    let remaining=20000;const pieces=[];
    for(const node of raw.textNodes){
      if(remaining<=0)break;
      if(node.visible!==true||node.hidden===true||node.editable===true||node.sensitive===true||sensitive.test(node.type??'')||sensitive.test(node.name??'')||!['text','paragraph','heading','link'].includes(node.kind))continue;
      const text=clean(node.text,remaining);pieces.push(text);remaining-=text.length;
    }
    const controls=[],seen=new Set();
    for(const c of raw.controls){
      if(controls.length===150)break;
      if(c.visible!==true||c.hidden===true||c.sensitive===true||sensitive.test(c.type??'')||sensitive.test(c.name??'')||sensitive.test(c.autocomplete??'')||!CONTROL_ROLES.includes(c.role)||typeof c.ref!=='string'||!/^c[0-9]{1,6}$/.test(c.ref)||seen.has(c.ref))continue;
      seen.add(c.ref);controls.push({ref:c.ref,role:c.role,label:clean(c.label,300)});
    }
    const value={...base,private:false,untrusted_page:{origin,text:pieces.join('\n'),controls}};
    // Encoded total, including labels, escaping and multibyte text, is bounded.
    while(Buffer.byteLength(JSON.stringify(value),'utf8')>32768){
      if(value.untrusted_page.controls.length)value.untrusted_page.controls.pop();
      else value.untrusted_page.text=value.untrusted_page.text.slice(0,Math.floor(value.untrusted_page.text.length*.75));
    }
    return ObservationV1.parse(value);
  }catch{throw Error('BROWSER_OBSERVATION_STALE');}
}
/** Reads and publication must share this fence; a private transition occurring
 * during capture returns a content-free private schema, never the captured raw. */
export async function observePublic({readTask,capture,outputFence,emit,registry,now=Date.now,observationId=randomUUID()}) {
  const ticket=outputFence.ticket();let task=await readTask();
  if(task.private||!outputFence.isOpen())return sanitizePublicObservation({task:{...task,private:true},observationId,now:now()});
  let raw;
  try{raw=await capture();}catch{throw Error('BROWSER_OBSERVATION_STALE');}
  task=await readTask();
  if(task.private||!outputFence.isOpen())return sanitizePublicObservation({task:{...task,private:true},observationId,now:now()});
  const observation=sanitizePublicObservation({raw,task,observationId,now:now()});
  if(registry)registry.register({observation,task,now:now()});
  if(!outputFence.publish({ticket,task,sink:'model',value:observation,emit}))return sanitizePublicObservation({task:{...task,private:true},observationId,now:now()});
  return observation;
}
/** Ref authority lives outside the frozen ObservationV1 wire shape. Neither the
 * model nor page can mint a registry entry. Revisions/generation bind all refs. */
export function createObservationRegistry({maxEntries=64}={}) {
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64)throw Error('BROWSER_BAD_INPUT');
  const entries=new Map();
  return Object.freeze({
    register({observation,task,now=Date.now()}) {
      ObservationV1.parse(observation);
      if(observation.private||task.private||task.privacy_mode!=='public'||Date.parse(observation.expires_at)<=now||Date.parse(observation.expires_at)>now+30000||observation.document_epoch!==task.document_epoch)throw Error('BROWSER_OBSERVATION_STALE');
      UInt.parse(task.read_manifest_revision);UInt.parse(task.context_generation);
      const frozen=structuredClone(observation);
      entries.set(observation.observation_id,{observation:frozen,readRevision:task.read_manifest_revision,generation:task.context_generation});
      while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
    },
    resolve({observationId,task,ref,now=Date.now()}) {
      const e=entries.get(observationId);
      if(!e||task.private||task.privacy_mode!=='public'||e.readRevision!==task.read_manifest_revision||e.generation!==task.context_generation||e.observation.document_epoch!==task.document_epoch||Date.parse(e.observation.expires_at)<=now)throw Error('BROWSER_OBSERVATION_STALE');
      if(ref!==undefined&&!e.observation.untrusted_page.controls.some(c=>c.ref===ref))throw Error('BROWSER_OBSERVATION_STALE');
      return structuredClone(e.observation);
    },
    clear(){entries.clear();},
  });
}
