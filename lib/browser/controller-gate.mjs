/** Policy endpoint for transport_runtime/UnixPolicy. No bodies over IPC. */
import {randomUUID} from 'node:crypto';
import {canonical} from './acceptance-attestation.mjs';
import {sha256} from './runtime-readiness.mjs';
import {createNetworkPolicy,parseBrowserUrl,validateResolution,validateAuthorityBinding} from './network-policy.mjs';
import {requestHeaders} from './gate.mjs';
import {hex} from './controller-authority.mjs';
import {EMPTY_BODY_SHA256,validatePublicHeaders} from './outbound-data.mjs';
const fail=()=>{throw Error('BROWSER_GATE_AUTHORITY_REFUSED');};
export function createGateAuthority({authority,networkConfig,bindingFor,fetchFor,registerDigest=async()=>{},now=Date.now,onFatal=async()=>{},phase=authority?.phase===1?1:0}){
  if(![0,1].includes(phase)||(phase===1&&(authority?.phase!==1||typeof authority.authorizeDispatch!=='function')))fail();
  const policy=createNetworkPolicy(networkConfig),flows=new Map();let dead=false;
  const alive=()=>{if(dead)fail();};
  const pin=e=>{
    const d=e.dns,p=parseBrowserUrl(e.url??`https://${e.hostname}/`);
    if(!d||d.hostname!==p.hostname||!Array.isArray(d.chain)||d.chain[0]!==p.hostname||!Number.isSafeInteger(d.ttlMs)||d.ttlMs<1||d.ttlMs>60000)fail();
    const chain=d.chain.map((name,i)=>({name,cname:i===d.chain.length-1?null:d.chain[i+1],addresses:i===d.chain.length-1?d.addresses:[]}));
    const result=validateResolution(policy,p.hostname,{hostname:d.hostname,complete:true,expiresAt:now()+d.ttlMs,chain},now());if(!result.ok)fail();
    return {hostname:p.hostname,address:result.addresses[0],addresses:result.addresses,expiresAt:result.expiresAt};
  };
  return async e=>{
    let stage='BROWSER_GATE_VALIDATE';
    try{
      const terminal=['close_flow','persist_unknown'].includes(e.event);if(!terminal)alive();if(e.v!==1||!Number.isFinite(e.remainingMs)||e.remainingMs<=0||e.remainingMs>60000||typeof e.id!=='string'||e.id.length>120||!['http_connect','requestheaders','request','server_connect','server_connected','request_dispatch','responseheaders','response','close_flow','persist_unknown'].includes(e.event))fail();
      const b=terminal?flows.get(e.id)?.binding:await bindingFor(e);if(!terminal)alive();if(!b||['listener','generation','listenerCookie','guardId','contextId','taskId','bootId','targetId'].some(k=>e[k]!==b[k]))fail();
      const reply={ok:true,event:e.event,id:e.id,generation:e.generation,listenerCookie:e.listenerCookie,guardId:e.guardId};
      let f=flows.get(e.id);
      if(e.event==='http_connect'){
        if(f||!/^([a-z0-9.-]+):443$/.test(e.authority))fail();parseBrowserUrl('https://'+e.authority+'/');flows.set(e.id,{binding:b,authority:e.authority,state:'connect'});return reply;
      }
      if(!f||canonical(f.binding)!==canonical(b))fail();
      if(e.event==='requestheaders'){
        if(f.state!=='connect')fail();
        const p=pin(e);if(!validateAuthorityBinding({...e,connectAuthority:f.authority}).ok)fail();requestHeaders(e.method,e.headers);
        const fetch=await fetchFor(e);alive();if(!fetch||fetch.contextId!==b.contextId)fail();const selected=await bindingFor(fetch);alive();if(!selected||selected.listenerCookie!==b.listenerCookie||selected.generation!==b.generation)fail();
        if(phase===1&&(!['document','resource'].includes(fetch.kind)||!['GET','HEAD'].includes(e.method)||!validatePublicHeaders(e.headers,e.url)||await authority.authorizeFetch({method:e.method,url:e.url,kind:fetch.kind,headers:e.headers,bodySha256:EMPTY_BODY_SHA256},{id:e.id,targetId:selected.targetId})!==true))fail();
        alive();
        f={...f,state:'headers',pin:p,method:e.method,url:e.url,headers:e.headers,kind:fetch.kind,selected};flows.set(e.id,f);return reply;
      }
      if(e.event==='request'){
        if(f.state!=='headers'||f.method!==e.method||f.url!==e.url||canonical(f.headers)!==canonical(e.headers)||!hex(e.bodySha256)||!hex(e.requestDigest)||e.requestDigest!==sha256(canonical({method:e.method,url:e.url,headers:e.headers,bodySha256:e.bodySha256})))fail();
        stage='BROWSER_GATE_AUTHORIZE';
        const decisionDeadline=now()+Math.min(2000,e.remainingMs);const receipt=await authority.authorizeRequest({method:e.method,url:e.url,kind:f.kind,bodySha256:e.bodySha256,requestDigest:e.requestDigest},{id:e.id,targetId:f.selected.targetId,headers:e.headers});alive();
        if(phase===1&&receipt.kind!=='read')fail();
        stage='BROWSER_GATE_DIGEST_REGISTER';
        await registerDigest(e,f.selected);alive();f.binding=f.selected;f.state='authorized';f.receipt=receipt;f.requestDigest=e.requestDigest;f.decisionId=phase===1?receipt.dispatch.decision_id:randomUUID();f.expiresAt=Math.min(decisionDeadline,receipt.expiresAt);if(!Number.isSafeInteger(receipt.expiresAt)||now()>=f.expiresAt)fail();
        return {...reply,guardId:f.selected.guardId,allow:true,requestDigest:e.requestDigest,decisionId:f.decisionId,expiresInMs:f.expiresAt-now(),pin:{hostname:f.pin.hostname,address:f.pin.address},kind:receipt.kind,...(receipt.kind==='write'?{consumed:true,unknownToken:receipt.consumeReceipt.id}:{})};
      }
      if(e.event==='server_connect'){
        if(f.state!=='authorized'||now()>=f.expiresAt)fail();const fresh=pin(e);if(e.hostname!==f.pin.hostname||!fresh.addresses.includes(f.pin.address)||e.address!==f.pin.address)fail();f.state='connecting';return reply;
      }
      if(e.event==='server_connected'){
        if(f.state!=='connecting'||now()>=f.expiresAt||e.hostname!==f.pin.hostname||e.peerAddress!==f.pin.address)fail();f.state='tls';return reply;
      }
      if(e.event==='request_dispatch'){
        if(f.state!=='tls'||now()>=f.expiresAt||e.requestDigest!==f.requestDigest||e.decisionId!==f.decisionId)fail();
        if(phase===1&&await authority.authorizeDispatch(f.receipt,{id:e.id,targetId:f.selected.targetId})!==true)fail();
        alive();if(now()>=f.expiresAt)fail();
        f.state='sending';return {...reply,requestDigest:f.requestDigest,decisionId:f.decisionId};
      }
      if(e.event==='persist_unknown'){
        if(f.receipt?.kind!=='write'||e.unknownToken!==f.receipt.consumeReceipt.id)fail();await authority.unknown(e.unknownToken);return {...reply,durable:true};
      }
      if(e.event==='close_flow'){if(e.success!==true&&f.receipt?.kind==='write')await authority.unknown(f.receipt.consumeReceipt.id);flows.delete(e.id);return reply;}
      if(!['sending','response'].includes(f.state))fail();
      if(e.event==='responseheaders'){if(!Number.isSafeInteger(e.status)||e.status<100||e.status>599)fail();f.state='response';return reply;}
      if(e.event==='response'){if(f.state!=='response'||!Number.isSafeInteger(e.bodyBytes)||e.bodyBytes<0||!hex(e.bodySha256))fail();return reply;}
      fail();
    }catch(error){
      dead=true;
      const code=stage==='BROWSER_GATE_DIGEST_REGISTER'&&error?.code==='EAGAIN'?'BROWSER_GATE_DIGEST_BACKPRESSURE':stage;
      // Fence synchronously, but never await the control-channel revoke from a
      // policy reply: that revoke may be joining this very handler's cleanup.
      try{Promise.resolve(onFatal({code})).catch(()=>{});}catch{}
      return {ok:false};
    }
  };
}
