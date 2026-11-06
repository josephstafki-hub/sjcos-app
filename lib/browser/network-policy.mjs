/** Pure containment decisions. No DNS, sockets, browser APIs, or implicit defaults.
 * A successful decision is NOT permission to transmit: exact read/action + data
 * provenance authorization and independent gate proofs are still mandatory.
 */
import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';

export class NetworkPolicyError extends Error {
  constructor(code='BROWSER_SITE_BLOCKED') { super(code); this.name='NetworkPolicyError'; this.code=code; }
}
const deny = (code='BROWSER_SITE_BLOCKED') => ({ok:false,code});
const fail = () => { throw new NetworkPolicyError(); };
const utf8Bytes = x => Buffer.byteLength(x,'utf8');
const blockedSuffixes = ['local','localhost','internal','lan','home','localdomain','test','invalid','onion','arpa'];
function hostname(raw) {
  if(typeof raw!=='string' || !raw || /[%\s\/:@\[\]\\]/u.test(raw)) fail();
  const host=domainToASCII(raw).toLowerCase();
  if(!host || host.endsWith('.') || host.length>253 || isIP(host) || !host.includes('.')) fail();
  const labels=host.split('.');
  if(labels.some(x=>x.length>63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))) fail();
  if(blockedSuffixes.some(x=>host===x || host.endsWith(`.${x}`))) fail();
  // WHATWG recognizes decimal, short, hexadecimal and octal IPv4 forms.
  if(isIP(new URL(`https://${host}`).hostname) || /^\d+$/.test(labels.at(-1))) fail();
  return host;
}
export function parseBrowserUrl(raw) {
  if(typeof raw!=='string' || !raw || !raw.isWellFormed() || utf8Bytes(raw)>2048 || /[\s\u0000-\u001f\u007f-\u009f\\#]/u.test(raw) || !/^https:\/\//i.test(raw)) fail();
  const authority=raw.slice(8).split(/[/?]/,1)[0];
  if(!authority || /[@%\[\]]/.test(authority)) fail();
  const parts=authority.split(':');
  if(parts.length>2 || (parts.length===2 && parts[1]!=='443')) fail();
  const host=hostname(parts[0]);
  const tail=raw.slice(8+authority.length);
  if(/%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(tail)) fail();
  // decode only to validate; signed path/query bytes retain encoding and order.
  try { const decoded=decodeURIComponent(tail); if(/[\u0000-\u001f\u007f-\u009f]/u.test(decoded)) fail(); } catch { fail(); }
  const path=tail.split('?',1)[0];
  if(path.split('/').some(x=>x==='.' || x==='..')) fail();
  let u; try { u=new URL(raw); } catch { fail(); }
  if(u.protocol!=='https:' || u.username || u.password || u.hash || u.hostname!==host || u.port) fail();
  const keys=new Set();
  for(const key of u.searchParams.keys()) {
    // Baseline secret-name refusal, not a substitute for typed provenance review.
    if(keys.has(key) || /^(?:password|passwd|pwd|(?:access_|refresh_|id_)?token|secret|api[_-]?key|authorization|auth|cookie|session(?:id)?|code)$/i.test(key)) fail();
    keys.add(key);
  }
  return Object.freeze({url:u.href,origin:u.origin,hostname:host,port:443,pathQuery:u.pathname+u.search});
}
export function canonicalOrigin(raw) {
  const p=parseBrowserUrl(raw);
  if(raw!==p.origin) fail();
  return p.origin;
}
function ipv4Number(address) { return address.split('.').reduce((n,x)=>(n<<8n)+BigInt(x),0n); }
function ipv6Number(address) {
  let s=address;
  if(s.includes('.')) { const i=s.lastIndexOf(':'); const v=ipv4Number(s.slice(i+1)); s=s.slice(0,i)+':'+(v>>16n).toString(16)+':'+(v&65535n).toString(16); }
  const [left,right]=s.split('::'); const a=left?left.split(':'):[]; const b=right?right.split(':'):[];
  const words=s.includes('::')?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
  return words.reduce((n,x)=>(n<<16n)+BigInt('0x'+x),0n);
}
const inRange=(n,base,bits,width)=>n>>BigInt(width-bits)===base>>BigInt(width-bits);
// Fail closed for special-purpose allocations (including globally reachable
// special exceptions). This deliberately permits a subset of global unicast.
const v4Denied=[['0.0.0.0',8,'unspecified'],['10.0.0.0',8,'private'],['100.64.0.0',10,'cgnat'],['127.0.0.0',8,'loopback'],['169.254.0.0',16,'link_local'],['172.16.0.0',12,'private'],['192.0.0.0',24,'special'],['192.0.2.0',24,'documentation'],['192.88.99.0',24,'transition'],['192.168.0.0',16,'private'],['198.18.0.0',15,'benchmark'],['198.51.100.0',24,'documentation'],['203.0.113.0',24,'documentation'],['224.0.0.0',4,'multicast'],['240.0.0.0',4,'reserved']];
export function classifyAddress(address) {
  if(typeof address!=='string' || address.includes('%')) return {global:false,reason:'invalid'};
  const version=isIP(address);
  if(version===4) {
    if(address==='168.63.129.16') return {global:false,reason:'metadata',family:4};
    const n=ipv4Number(address); const range=v4Denied.find(([base,bits])=>inRange(n,ipv4Number(base),bits,32));
    return {global:!range,reason:range?.[2]??'global',family:4,normalized:n.toString(16)};
  }
  if(version===6) {
    const n=ipv6Number(address);
    let reason='global';
    if(n===0n) reason='unspecified';
    else if(n===1n) reason='loopback';
    else if(inRange(n,ipv6Number('::ffff:0:0'),96,128)) reason='mapped';
    else if(inRange(n,0n,96,128)) reason='compatible';
    else if(inRange(n,ipv6Number('fc00::'),7,128)) reason='private';
    else if(inRange(n,ipv6Number('fe80::'),10,128)) reason='link_local';
    else if(inRange(n,ipv6Number('ff00::'),8,128)) reason='multicast';
    else if(!inRange(n,ipv6Number('2000::'),3,128)) reason='special';
    else if(inRange(n,ipv6Number('2001::'),23,128)) reason='special';
    else if(inRange(n,ipv6Number('2001:db8::'),32,128) || inRange(n,ipv6Number('3fff::'),20,128)) reason='documentation';
    else if(inRange(n,ipv6Number('2002::'),16,128)) reason='transition';
    // ISATAP embeds IPv4 in the interface identifier, including private targets.
    else if([0x00005efen,0x02005efen].includes((n>>32n)&0xffffffffn)) reason='transition';
    return {global:reason==='global',reason,family:6,normalized:n.toString(16)};
  }
  return {global:false,reason:'invalid'};
}
export function createNetworkPolicy(config) {
  if(!config || !Array.isArray(config.appHosts) || !config.appHosts.length || !Array.isArray(config.hostPublicAddresses) || !config.hostPublicAddresses.length || !Array.isArray(config.serviceHosts)) fail();
  const normalizeConfigHost = raw => {
    // Internal deny names need not themselves be valid outside destinations.
    if(typeof raw!=='string' || !/^[a-z0-9.-]+$/i.test(raw) || raw.endsWith('.')) fail();
    return raw.toLowerCase();
  };
  const deniedHosts=[...config.appHosts,...config.serviceHosts].map(normalizeConfigHost);
  const deniedAddresses=config.hostPublicAddresses.map(x=>{const c=classifyAddress(x); if(!c.global) fail(); return c.normalized;});
  return Object.freeze({deniedHosts:Object.freeze(deniedHosts),deniedAddresses:Object.freeze(deniedAddresses)});
}
function blockedHost(policy,host) {
  return policy.deniedHosts.some(x=>host===x || host.endsWith(`.${x}`));
}
export function validateTaskManifest(manifest) {
  if(!manifest || !Number.isSafeInteger(manifest.revision) || manifest.revision<1 || !Array.isArray(manifest.origins) || !manifest.origins.length || manifest.origins.length>32 || Object.keys(manifest).some(x=>!['revision','origins'].includes(x))) fail();
  let documents=0,resources=0; const seen=new Set();
  for(const entry of manifest.origins) {
    if(!entry || Object.keys(entry).some(x=>!['origin','role'].includes(x)) || !['document','identity','resource'].includes(entry.role)) fail();
    canonicalOrigin(entry.origin); if(seen.has(entry.origin)) fail(); seen.add(entry.origin);
    if(entry.role==='resource') resources++; else documents++;
  }
  if(documents>8 || resources>24 || documents===0) fail();
  return structuredClone(manifest);
}
export function validateResolution(policy,host,result,now) {
  try {
    if(!policy || !Number.isFinite(now) || !result || result.complete!==true || result.error || hostname(host)!==host || result.hostname!==host || !Number.isFinite(result.expiresAt) || result.expiresAt<=now || !Array.isArray(result.chain) || !result.chain.length || result.chain.length>8) return deny('BROWSER_ADDRESS_BLOCKED');
    let expected=host; const visited=new Set(); let addresses=[];
    for(let i=0;i<result.chain.length;i++) {
      const node=result.chain[i];
      if(!node || hostname(node.name)!==expected || visited.has(expected) || blockedHost(policy,expected) || !Array.isArray(node.addresses) || node.addresses.length>32) return deny('BROWSER_ADDRESS_BLOCKED');
      visited.add(expected);
      for(const address of node.addresses) {
        const c=classifyAddress(address);
        if(!c.global || policy.deniedAddresses.includes(c.normalized)) return deny('BROWSER_ADDRESS_BLOCKED');
      }
      if(i<result.chain.length-1) {
        if(node.addresses.length || typeof node.cname!=='string') return deny('BROWSER_ADDRESS_BLOCKED');
        expected=hostname(node.cname); if(expected!==node.cname) return deny('BROWSER_ADDRESS_BLOCKED');
      } else {
        if(node.cname!==null || !node.addresses.length) return deny('BROWSER_ADDRESS_BLOCKED');
        addresses=node.addresses;
      }
    }
    return {ok:true,hostname:host,addresses:[...addresses],expiresAt:result.expiresAt};
  } catch { return deny('BROWSER_ADDRESS_BLOCKED'); }
}
const documents=['document','popup','subframe','credential'];
const resources=['resource','css','font','image','script','fetch','beacon','download','prefetch','preconnect'];
export function decideRequest(policy,input) {
  try {
    if(!policy || !input || input.guardAttached!==true || !Number.isSafeInteger(input.listenerGeneration) || input.listenerGeneration<1) return deny();
    const p=parseBrowserUrl(input.url); const m=validateTaskManifest(input.manifest);
    if(blockedHost(policy,p.hostname) || ![...documents,...resources].includes(input.kind)) return deny();
    const entry=m.origins.find(x=>x.origin===p.origin);
    if(!entry || (documents.includes(input.kind) && entry.role==='resource')) return deny();
    const resolution=validateResolution(policy,p.hostname,input.resolution,input.now);
    if(!resolution.ok) return resolution;
    return {ok:true,url:p.url,origin:p.origin,manifestRevision:m.revision,requiresRequestAuthorization:true,requiresAuthorityBinding:true,
      pin:Object.freeze({hostname:p.hostname,address:resolution.addresses[0],expiresAt:resolution.expiresAt,listenerGeneration:input.listenerGeneration})};
  } catch { return deny(); }
}
export function decideRedirect(policy,input) {
  try { parseBrowserUrl(input.fromUrl); } catch { return deny(); }
  // No prior DNS answer or origin decision is inherited, even for same-host redirects.
  return decideRequest(policy,input);
}
export function validateSocketPeer(pin,peer,now) {
  try {
    if(!pin || !peer || !Number.isFinite(now) || !Number.isFinite(pin.expiresAt) || !Number.isSafeInteger(pin.listenerGeneration) || pin.listenerGeneration<1 || now>=pin.expiresAt || hostname(pin.hostname)!==pin.hostname || pin.hostname!==peer.hostname || pin.listenerGeneration!==peer.listenerGeneration || !classifyAddress(peer.address).global || classifyAddress(pin.address).normalized!==classifyAddress(peer.address).normalized) return deny('BROWSER_ADDRESS_BLOCKED');
    return {ok:true};
  } catch { return deny('BROWSER_ADDRESS_BLOCKED'); }
}
/** Independent TLS-gate check; an origin decision alone never proves authority.
 * Inputs must come from the actual parsed CONNECT/HTTP/TLS peer, not the model.
 */
export function validateAuthorityBinding(input) {
  try {
    const p=parseBrowserUrl(input.url);
    if(typeof input.connectAuthority!=='string' || input.connectAuthority!==`${p.hostname}:443` ||
      ![p.hostname,`${p.hostname}:443`].includes(input.hostAuthority) || input.sni!==p.hostname) return deny();
    return {ok:true};
  } catch { return deny(); }
}
