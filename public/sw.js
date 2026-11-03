/* Consult-only, data-free precache. No API, authenticated document, or RSC caching. */
let stopped=false;
const PREFIX='sjcos-consult-shell:';
self.addEventListener('install',()=>{}); // Get ready explicitly prepares the build.
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const allowed=path=>path.startsWith('/consult/assets/')||path==='/consult/offline.html';
self.addEventListener('message',event=>{
 const data=event.data??{},port=event.ports?.[0];
 const reply=value=>port?.postMessage(value);
 event.waitUntil((async()=>{try{
  if(data.type==='STOP_CACHE'){stopped=true;for(const key of await caches.keys())if(key.startsWith(PREFIX))await caches.delete(key);reply({ok:true,capture_blocked:true});await self.registration.unregister();return;}
  if(data.type==='ACTIVATE'){if(data.safe!==true)throw Error('queue_not_safe');await self.skipWaiting();reply({ok:true});return;}
  if(data.type!=='PRECACHE'&&data.type!=='CHECK')return;
  if(stopped)throw Error('capture_blocked');
  const manifest=data.manifest;if(!manifest||!Array.isArray(manifest.assets)||!manifest.assets.some(a=>a.url==='/consult/offline.html')||!manifest.assets.some(a=>a.url==='/consult/assets/capture.js'))throw Error('missing_precache');
  for(const asset of manifest.assets)if(!allowed(asset.url)||! /^[a-f0-9]{64}$/.test(asset.sha256))throw Error('invalid_manifest');
  const cache=await caches.open(PREFIX+manifest.build);
  for(const asset of manifest.assets){
   let response=data.type==='CHECK'?await cache.match(asset.url):await fetch(asset.url,{cache:'no-store',credentials:'omit',redirect:'error'});
   if(!response||!response.ok||response.redirected)throw Error('missing_precache');
   const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==asset.sha256)throw Error('checksum_mismatch');if(data.type==='PRECACHE')await cache.put(asset.url,response);
  }
  // A completeness marker is written only after every asset is verified.
  if(data.type==='PRECACHE')await cache.put('/consult/assets/ready',new Response(JSON.stringify(manifest)));
  if(!await cache.match('/consult/assets/ready'))throw Error('missing_precache');reply({ok:true,build:manifest.build});
 }catch(error){reply({ok:false,code:error.message});}})());
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(stopped||url.origin!==self.location.origin||!url.pathname.startsWith('/consult/')||event.request.method!=='GET'||event.request.headers.has('RSC'))return;
 if(event.request.mode!=='navigate'&&!allowed(url.pathname))return;
 event.respondWith((async()=>{
  // Online documents pass through without caching; disconnected navigation uses shell.
  if(event.request.mode==='navigate'){try{return await fetch(event.request);}catch{}}
  const keys=(await caches.keys()).filter(k=>k.startsWith(PREFIX));
  const client=event.clientId?await self.clients.get(event.clientId):null;
  const build=client?new URL(client.url).searchParams.get('consult_build'):null;
  const candidates=build?[PREFIX+build]:keys.length===1?keys:[];
  for(const key of candidates){const cache=await caches.open(key);if(!await cache.match('/consult/assets/ready'))continue;const hit=await cache.match(event.request.mode==='navigate'?'/consult/offline.html':url.pathname);if(hit)return hit;}
  if(event.request.mode==='navigate')return new Response('Open once with signal before the visit. Or use paper and enter the answers here after the visit.',{status:503,headers:{'Content-Type':'text/plain'}});
  return fetch(event.request);
 })());
});
