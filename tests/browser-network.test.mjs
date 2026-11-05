import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBrowserUrl,classifyAddress,createNetworkPolicy,validateTaskManifest,validateResolution,decideRequest,decideRedirect,validateSocketPeer,validateAuthorityBinding} from '../lib/browser/network-policy.mjs';
import {createBudget,reserveFlow,chargePool,releaseFlow,accountResponseChunk,accountTransport,drainTransport,expireFlows,admitContenders,validateResponseHeaders,markFlowConsumed,abortFlow,MiB,LIMITS} from '../lib/browser/response-budget.mjs';
import {adversarialUrls,nonglobalAddresses,appConfig,manifest,dns} from './fixtures/browser-network-cases.mjs';
import {responseBudgetScenario as scenario} from './fixtures/browser-response-budget.mjs';
const policy = () => createNetworkPolicy(appConfig);
const request = (changes={}) => ({url:'https://permit.example/',kind:'document',manifest,resolution:dns(),now:1000,guardAttached:true,listenerGeneration:1,...changes});
for(const [name,url] of adversarialUrls) test(`fresh adversarial URL: ${name}`,()=>assert.throws(()=>parseBrowserUrl(url)));
for(const address of nonglobalAddresses) test(`non-global address: ${address}`,()=>assert.equal(classifyAddress(address).global,false));
test('IDNA + case + explicit 443 normalized, exact query bytes/order retained',()=>{
  assert.equal(parseBrowserUrl('https://BÜCHER.example:443/a?b=%41&a=2').url,'https://xn--bcher-kva.example/a?b=%41&a=2');
});
test('global v4/v6 classified without network',()=>{
  for(const x of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) assert.equal(classifyAddress(x).global,true,x);
});
test('forbidden schemes and ports',()=>{
  for(const x of ['http://permit.example','file:///etc/passwd','data:text/html,x','javascript:1','chrome://settings','ftp://permit.example','https://permit.example:80']) assert.throws(()=>parseBrowserUrl(x));
});
test('configuration fails closed and host aliases cannot bypass app deny',()=>{
  assert.throws(()=>createNetworkPolicy({}));
  for(const h of ['sjcos.example','tunnel.example','db.internal','mcp.internal'])
    for(const path of ['/','/api','/mcp','/admin','/settings','/engine/permissions','/portal','/files'])
      assert.equal(decideRequest(policy(),request({url:`https://${h}${path}`})).ok,false);
  for(const ip of appConfig.hostPublicAddresses) assert.equal(decideRequest(policy(),request({resolution:dns('permit.example',[ip])})).ok,false);
});
test('manifest exact roles, canonical origins and ceilings',()=>{
  assert.equal(validateTaskManifest(manifest).revision,1);
  for(const origins of [[{origin:'https://permit.example/',role:'document'}],[{origin:'https://permit.example',role:'bogus'}],Array.from({length:9},(_,i)=>({origin:`https://x${i}.example`,role:'document'})),Array.from({length:25},(_,i)=>({origin:`https://x${i}.example`,role:'resource'})),[...manifest.origins,manifest.origins[0]]]) assert.throws(()=>validateTaskManifest({revision:1,origins}));
});
test('resource origins never document, popup, subframe or credentials',()=>{
  for(const kind of ['document','popup','subframe','credential']) assert.equal(decideRequest(policy(),request({url:'https://assets.example/a',kind,resolution:dns('assets.example')})).ok,false);
  for(const kind of ['css','font','image','fetch','beacon','download','prefetch','preconnect']) assert.equal(decideRequest(policy(),request({url:'https://assets.example/a',kind,resolution:dns('assets.example')})).ok,true,kind);
  assert.equal(decideRequest(policy(),request({kind:'worker'})).ok,false);
  assert.equal(decideRequest(policy(),request({kind:'made_up'})).ok,false);
});
test('allowlist is not exact-read or outbound-data authorization',()=>{
  const result=decideRequest(policy(),request());
  assert.equal(result.ok,true); assert.equal(result.requiresRequestAuthorization,true);
  for(const changes of [{guardAttached:false},{guardAttached:undefined},{manifest:null},{resolution:null},{listenerGeneration:0}]) assert.equal(decideRequest(policy(),request(changes)).ok,false);
  assert.equal(decideRequest(policy(),request({url:'https://permit.example.evil.example/'})).ok,false);
});
test('DNS chain complete, bounded, no mixed answers or CNAME bypasses',()=>{
  const valid={hostname:'permit.example',complete:true,expiresAt:2000,chain:[{name:'permit.example',cname:'edge.example',addresses:[]},{name:'edge.example',cname:null,addresses:['8.8.8.8','2606:4700:4700::1111']}]};
  assert.equal(validateResolution(policy(),'permit.example',valid,1000).ok,true);
  for(const bad of [dns('permit.example',['8.8.8.8','127.0.0.1']),{...valid,complete:false},{...valid,expiresAt:999},{...valid,hostname:'evil.example'},{...valid,chain:valid.chain.slice(0,1)},{...valid,chain:[{name:'permit.example',cname:'permit.example',addresses:[]}]},{...valid,chain:[{name:'permit.example',cname:'tunnel.example',addresses:[]},{name:'tunnel.example',cname:null,addresses:['8.8.8.8']}]},dns('permit.example',[])]) assert.equal(validateResolution(policy(),'permit.example',bad,1000).ok,false);
});
test('redirect re-resolves even same host; public to private and mapped refused',()=>{
  assert.equal(decideRedirect(policy(),request({fromUrl:'https://permit.example/a',url:'https://permit.example/b'})).ok,true);
  for(const addresses of [['169.254.169.254'],['::ffff:8.8.8.8'],['8.8.8.8','10.0.0.1']]) assert.equal(decideRedirect(policy(),request({fromUrl:'https://permit.example/a',resolution:dns('permit.example',addresses)})).ok,false);
  assert.equal(decideRedirect(policy(),request({fromUrl:'https://permit.example/a',url:'https://169.254.169.254/'})).ok,false);
});
test('socket peer, hostname, TTL and listener generation must match pin',()=>{
  const pin=decideRequest(policy(),request()).pin;
  const peer={address:'8.8.8.8',hostname:'permit.example',listenerGeneration:1};
  assert.equal(validateSocketPeer(pin,peer,1000).ok,true);
  for(const bad of [{...peer,address:'1.1.1.1'},{...peer,hostname:'evil.example'},{...peer,listenerGeneration:2}]) assert.equal(validateSocketPeer(pin,bad,1000).ok,false);
  assert.equal(validateSocketPeer(pin,peer,2001).ok,false);
});
test('malformed resolver and URL inputs always deny',()=>{
  for(const x of [undefined,null,{},[],42,'x']) {assert.equal(validateResolution(policy(),'permit.example',x,1000).ok,false);assert.equal(decideRequest(policy(),request({url:x})).ok,false);}
});
test('budget two-context slow-reader fixture: fixed pools, no queues or borrowing',()=>{
  let b=createBudget({baselineBytes:144*MiB,contextOrder:scenario.contexts});
  let r=reserveFlow(b,{id:'a',contextId:'joe',now:0,requestBytes:scenario.requestBytes,requestCopies:2}); assert.equal(r.ok,true); b=r.budget;
  r=reserveFlow(b,{id:'b',contextId:'staff',now:0,requestBytes:scenario.requestBytes,requestCopies:2}); assert.equal(r.ok,false); assert.equal(r.code,'BROWSER_BUFFER_BUSY');
  r=reserveFlow(b,{id:'b',contextId:'staff',now:0,requestBytes:0,requestCopies:1}); assert.equal(r.ok,true); b=r.budget;
  assert.equal(b.pools.response,112*MiB); assert.equal(reserveFlow(b,{id:'c',contextId:'joe',now:0}).ok,false);
  assert.equal(chargePool(b,'a','request',7*MiB).ok,false);
  assert.equal(chargePool(b,'a','transport',24*MiB+1).ok,false);
  assert.equal(b.pools.request,50*MiB);
  b=releaseFlow(releaseFlow(b,'a'),'b'); assert.deepEqual(b.pools,{request:0,response:0,transport:0});
});
test('budget allocation refusal, size, encoding, deadline and unknown write result',()=>{
  assert.throws(()=>createBudget({baselineBytes:145*MiB,contextOrder:['joe']}));
  let b=createBudget({baselineBytes:144*MiB,contextOrder:['joe']});
  for(const opts of [{requestBytes:26*MiB},{requestBytes:1,requestCopies:0},{requestBytes:-1},{now:NaN}]) assert.equal(reserveFlow(b,{id:'bad',contextId:'joe',now:0,...opts}).ok,false);
  b=reserveFlow(b,{id:'a',contextId:'joe',now:0,consumedWrite:true}).budget;
  for(const opts of [{bytes:1,encoding:'gzip',now:1},{bytes:26*MiB,encoding:'identity',now:1},{bytes:1,encoding:'identity',now:60000}]) {
    const r=accountResponseChunk(b,'a',opts);assert.equal(r.ok,false);assert.equal(r.outcome,'unknown');assert.equal(r.retry,false);assert.equal(r.budget.pools.response,0);
  }
  assert.equal(expireFlows(b,60000).budget.pools.response,0);
  assert.deepEqual(expireFlows(b,60000).outcomes,[{id:'a',outcome:'unknown',retry:false}]);
  assert.equal(LIMITS.memoryMax,384*MiB);
});
test('backpressure before allocation, drain, finally cleanup and fair admission',()=>{
  let b=createBudget({baselineBytes:144*MiB,contextOrder:['joe','staff']});
  b=reserveFlow(b,{id:'a',contextId:'joe',now:0}).budget;
  assert.equal(reserveFlow(b,{id:'a2',contextId:'joe',now:0}).ok,false);
  b=accountTransport(b,'a',{bytes:65536,direction:'incoming',now:1}).budget;
  const paused=accountTransport(b,'a',{bytes:1,direction:'incoming',now:1});assert.equal(paused.pauseReads,true);assert.equal(paused.budget,b);
  b=drainTransport(b,'a',{bytes:65536,direction:'incoming'}).budget;
  assert.equal(b.pools.transport,0);
  assert.equal(accountResponseChunk(b,'a',{bytes:65536,encoding:'identity',now:1}).ok,true);
  b=releaseFlow(b,'a'); assert.equal(b.nextContext,'staff');
  assert.equal(reserveFlow(b,{id:'b',contextId:'staff',now:2}).ok,true);
  assert.equal(releaseFlow(b,'a'),b);
});
test('CONNECT, Host/authority and TLS SNI must agree exactly',()=>{
  const x={url:'https://permit.example/a',connectAuthority:'permit.example:443',hostAuthority:'permit.example',sni:'permit.example'};
  assert.equal(validateAuthorityBinding(x).ok,true);
  for(const bad of [{...x,connectAuthority:'permit.example:80'},{...x,hostAuthority:'evil.example'},
    {...x,sni:'evil.example'},{...x,hostAuthority:'permit.example.'},{...x,sni:undefined},
    {...x,hostAuthority:['permit.example','evil.example']},{...x,connectAuthority:'8.8.8.8:443'}]) assert.equal(validateAuthorityBinding(bad).ok,false);
});
test('invalid Unicode, secret queries and malformed socket pins fail closed',()=>{
  for(const url of ['https://permit.example/\ud800','https://permit.example/?password=abc','https://permit.example/?access_token=x']) assert.throws(()=>parseBrowserUrl(url));
  const peer={address:'8.8.8.8',hostname:'permit.example',listenerGeneration:1};
  for(const pin of [{...peer},{...peer,expiresAt:NaN},{...peer,expiresAt:2000,listenerGeneration:0}]) assert.equal(validateSocketPeer(pin,{...peer,listenerGeneration:pin.listenerGeneration},1000).ok,false);
});
test('response header rejection happens before body collection; unknown/chunked allowed within slot',()=>{
  assert.equal(validateResponseHeaders({length:null}).ok,true);
  for(const x of [{length:26*MiB},{length:-1},{encoding:'br'},{ambiguous:true},{upgrade:true},{trailers:true}]) assert.equal(validateResponseHeaders(x).ok,false);
});
test('pure two 25 MiB response fixture: held until slow downstream finishes',()=>{
  let b=createBudget({baselineBytes:144*MiB,contextOrder:['joe','staff']});
  for(const [id,contextId] of [['a','joe'],['b','staff']]) b=reserveFlow(b,{id,contextId,now:0,requestBytes:25*MiB,requestCopies:1}).budget;
  for(let i=0;i<400;i++) for(const id of ['a','b']) {
    const r=accountResponseChunk(b,id,{bytes:65536,encoding:'identity',now:1});assert.equal(r.ok,true);b=r.budget;
  }
  assert.equal(b.pools.response,112*MiB);assert.equal(b.pools.request,50*MiB);
  assert.equal(chargePool(b,'a','response',1).ok,false);
  assert.equal(reserveFlow(b,{id:'c',contextId:'joe',now:2}).ok,false);
  assert.equal(accountResponseChunk(b,'a',{bytes:1,encoding:'identity',now:2}).ok,false);
  b=releaseFlow(releaseFlow(b,'a'),'b');assert.deepEqual(b.pools,{request:0,response:0,transport:0});
});
test('rotating simultaneous contention, no retained completed flows',()=>{
  let b=createBudget({baselineBytes:144*MiB,contextOrder:['joe','staff']});
  for(let i=0;i<10;i++) {
    const first=b.nextContext;
    assert.equal(first,i%2===0?'joe':'staff');
    const r=admitContenders(b,[{id:'a',contextId:'joe',now:i},{id:'b',contextId:'staff',now:i}]);
    assert.equal(r.results[0].budget.flows[r.results[0].id].contextId,first);
    b=releaseFlow(releaseFlow(r.budget,'a'),'b');assert.equal(Object.keys(b.flows).length,0);
  }
});
test('inherited flow names cannot corrupt the ledger',()=>{
  const b=createBudget({baselineBytes:144*MiB,contextOrder:['joe']});
  for(const id of ['toString','constructor','__proto__']) {
    assert.equal(chargePool(b,id,'transport',1).ok,false);
    assert.equal(accountTransport(b,id,{bytes:1,direction:'incoming',now:1}).ok,false);
    assert.equal(accountResponseChunk(b,id,{bytes:1,encoding:'identity',now:1}).ok,false);
    assert.equal(releaseFlow(b,id),b);
  }
});
test('consume only after reservation; disconnect/revoke/exception retain unknown and free pools',()=>{
  const initial=createBudget({baselineBytes:144*MiB,contextOrder:['joe']});
  let b=reserveFlow(initial,{id:'a',contextId:'joe',now:0}).budget;
  const unconsumed=abortFlow(b,'a');assert.equal(unconsumed.outcome,'failed');
  const expired=markFlowConsumed(b,'a',60000);assert.equal(expired.ok,false);
  b=markFlowConsumed(b,'a',1).budget;
  const result=abortFlow(b,'a');assert.equal(result.outcome,'unknown');assert.equal(result.retry,false);
  assert.deepEqual(result.budget.pools,{request:0,response:0,transport:0});
  assert.equal(markFlowConsumed(initial,'missing',1).ok,false);
});
