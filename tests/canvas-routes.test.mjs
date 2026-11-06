import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildCanvasRendererDocument,MERMAID_ASSET_PATH,MERMAID_ASSET_SHA256,CANVAS_BOOTSTRAP_SHA256,CANVAS_IFRAME_SANDBOX,canvasResponseHeaders,CANVAS_ERROR_CSP} from '../lib/canvas-renderer.mjs';
const asset=readFileSync(new URL('../'+MERMAID_ASSET_PATH,import.meta.url),'utf8');
test('vendored renderer digest and exact child CSP; no same-origin or CDN',()=>{
 assert.equal(createHash('sha256').update(asset).digest('base64'),MERMAID_ASSET_SHA256);
 const doc=buildCanvasRendererDocument({mermaidBundle:asset,mermaidSha256:MERMAID_ASSET_SHA256});
 assert.equal(doc.headers['Content-Security-Policy'],`sandbox allow-scripts; default-src 'none'; script-src 'sha256-${CANVAS_BOOTSTRAP_SHA256}' 'sha256-${MERMAID_ASSET_SHA256}'; script-src-attr 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`);
 assert.equal(CANVAS_IFRAME_SANDBOX,'allow-scripts');assert.doesNotMatch(doc.html,/<script[^>]+src=/);assert.equal(doc.headers['X-Frame-Options'],undefined);
});
test('packaging rejects modified assets',()=>assert.throws(()=>buildCanvasRendererDocument({mermaidBundle:asset+' ',mermaidSha256:MERMAID_ASSET_SHA256})));
test('error/code responses stay private, sandboxed and no CORS',()=>{for(const type of ['error','code','api']){const h=canvasResponseHeaders(type);assert.equal(h['Content-Security-Policy'],CANVAS_ERROR_CSP);assert.equal(h['Cache-Control'],'private, no-store');assert.equal(h['Access-Control-Allow-Origin'],undefined);}});
test('all owned routes call shared authenticated boundary and wrapper DENY is scoped',()=>{
 for(const action of ['code','preview','render','download']){const s=readFileSync(new URL(`../app/api/canvas/[id]/versions/[version]/${action}/route.ts`,import.meta.url),'utf8');assert.match(s,/canvasRoute/);}
 const cfg=readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');assert.match(cfg,/\/panel\/canvas\/:path\*/);assert.match(cfg,/renderer-assets\/mermaid-12.3.0.min.js/);
 const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');assert.match(proxy,/canvasWrapperHeaders/);
});

// Execute real route handlers with controlled auth/command seams; never open a DB.
import {registerHooks} from 'node:module';
import {existsSync,statSync} from 'node:fs';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
const seams=new Map([
 ['@/lib/canvas-exports',`export async function canvasRender(id,n,input){return {ok:true,canvas_id:id,version:n,renderer_version:'1',sha256:'a'.repeat(64)};} export async function canvasDrawing(id,n){return {svg:'<svg/>',title:'Drawing',version:n};}`],
 ['server-only','export {};'],
 ['@/lib/ask-canvases',`export async function canvasGet(id,input){globalThis.__canvasCalls.push([id,input]);if(globalThis.__canvasFailure)throw {code:globalThis.__canvasFailure};return globalThis.__canvasData;}
 export function canvasFailure(e){const code=e?.code??'INTERNAL_ERROR';return {ok:false,code,message:'Fixed error',retryable:false};}
 export function canvasStatus(e){return ({AUTH_REQUIRED:401,CANVAS_UNAVAILABLE:404,INVALID_INPUT:400,CANVAS_DISABLED:503,UNSUPPORTED_KIND:422,ASK_PAUSED:503})[e.code]??500;}
 export async function canvasBody(req){return req.json();} export function canvasSameOrigin(req){if(req.headers.get('origin')!==new URL(req.url).origin)throw {code:'CANVAS_UNAVAILABLE'};}`],
 ['@/lib/thread-access',`export async function threadPrincipal(){if(globalThis.__principalFailure)throw {code:globalThis.__principalFailure};return {id:'u',role:globalThis.__canvasRole??'owner'};}`],
 ['@/lib/db',`export const pool={query:async()=>({rows:[{key:'canvas.diagrams_enabled',value:true},{key:'canvas.staff_enabled',value:false}]})};`],
 ['@/lib/web-sessions',`export const WEB_SESSION_ISSUER='s',WEB_SESSION_AUDIENCE='s';export const verifyWebSessionToken=async()=>null;export const renewWebSession=async()=>null;export const validateBrowserReturnPath=()=>null;export const validateAppReturnPath=p=>p?.startsWith('/')?p:null;`],
]);
registerHooks({resolve(s,c,n){if(seams.has(s))return {url:'canvas-seam:'+s,shortCircuit:true};if(s==='next/server')return n('next/server.js',c);if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}return n(s,c);},load(u,c,n){if(u.startsWith('canvas-seam:'))return {format:'module',shortCircuit:true,source:seams.get(u.slice(12))};if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return n(u,c);}});
const code=await import('../app/api/canvas/[id]/versions/[version]/code/route.ts');
const download=await import('../app/api/canvas/[id]/versions/[version]/download/route.ts');
const render=await import('../app/api/canvas/[id]/versions/[version]/render/route.ts');
const preview=await import('../app/api/canvas/[id]/versions/[version]/preview/route.ts');
const renderer=await import('../app/api/canvas/renderer/route.ts');
const proxy=(await import('../proxy.ts')).default;
const cfg=(await import('../next.config.ts')).default;
const ctx={params:Promise.resolve({id:'canvas-id',version:'2'})};
function reset(){globalThis.__canvasCalls=[];delete globalThis.__canvasFailure;delete globalThis.__principalFailure;globalThis.__canvasRole='owner';globalThis.__canvasData={ok:true,canvas:{id:'canvas-id',kind:'diagram'},selected:{title:'Drawing "危险/steps',version:2},availability:{master:true,exports:false,source:true},capabilities:{code:true,preview:true},code:{ok:true,canvas_id:'canvas-id',version:2,kind:'diagram',code:'flowchart TD\n A["<script>"] --> B',sha256:'hash',untrusted:true,availability:{source:true}}};}
function secure(response){assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-security-policy'),CANVAS_ERROR_CSP);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('x-frame-options'),null);}
test('real code route uses selected version and canonical source envelope',async()=>{reset();const r=await code.GET(new Request('https://app.test/code'),ctx);assert.equal(r.status,200);secure(r);assert.deepEqual(await r.json(),globalThis.__canvasData.code);assert.deepEqual(globalThis.__canvasCalls,[['canvas-id',{version:2,include_source:true}]]);});
for(const failure of ['AUTH_REQUIRED','CANVAS_UNAVAILABLE','CANVAS_DISABLED','ASK_PAUSED'])test(`real private routes retain CSP for ${failure}`,async()=>{reset();globalThis.__canvasFailure=failure;for(const handler of [code.GET,download.GET,preview.GET]){const r=await handler(new Request('https://app.test/?format=mmd'),ctx);secure(r);assert.equal((await r.json()).code,failure);}});
test('auth precedes malformed version diagnostics',async()=>{reset();globalThis.__principalFailure='AUTH_REQUIRED';const r=await code.GET(new Request('https://app.test/'),{params:Promise.resolve({id:'bad',version:'0'})});assert.equal(r.status,401);assert.equal(globalThis.__canvasCalls.length,0);});
test('source attachment is plain text, selected source, encoded safe filename',async()=>{reset();const r=await download.GET(new Request('https://app.test/?format=mmd'),ctx);secure(r);assert.match(r.headers.get('content-type'),/^text\/plain/);assert.match(r.headers.get('content-disposition'),/^attachment; filename="diagram-v2.mmd"; filename\*=UTF-8''/);assert.doesNotMatch(r.headers.get('content-disposition'),/危险|steps"/);assert.equal(await r.text(),globalThis.__canvasData.code.code);});
test('SVG download and render fail closed while exports are disabled',async()=>{reset();let r=await download.GET(new Request('https://app.test/?format=svg'),ctx);assert.equal(r.status,503);secure(r);r=await render.POST(new Request('https://app.test/render',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/json'},body:'{"svg":"<svg/>"}'}),ctx);assert.equal(r.status,503);secure(r);});
test('source incident kill denies source attachment, wrong-origin render is refused',async()=>{reset();globalThis.__canvasData.availability.source=false;assert.equal((await download.GET(new Request('https://app.test/?format=mmd'),ctx)).status,503);reset();const r=await render.POST(new Request('https://app.test/render',{method:'POST',headers:{Origin:'null'}}),ctx);assert.equal(r.status,404);secure(r);});
test('static page preview is not advertised by Phase 1',async()=>{reset();const r=await preview.GET(new Request('https://app.test/'),ctx);assert.equal(r.status,422);secure(r);});
test('actual renderer response is source-free, hash-bound and private; staff off is strict error',async()=>{reset();const old=process.env.SJC_CANVAS_ENABLED;process.env.SJC_CANVAS_ENABLED='1';try{let r=await renderer.GET();assert.equal(r.status,200);assert.equal(r.headers.get('x-frame-options'),null);assert.equal(r.headers.get('content-security-policy'),buildCanvasRendererDocument({mermaidBundle:asset,mermaidSha256:MERMAID_ASSET_SHA256}).headers['Content-Security-Policy']);assert.doesNotMatch(await r.text(),/Drawing .危险|canvas-id/);globalThis.__canvasRole='staff';r=await renderer.GET();assert.equal(r.status,503);secure(r);}finally{if(old===undefined)delete process.env.SJC_CANVAS_ENABLED;else process.env.SJC_CANVAS_ENABLED=old;}});
test('actual wrapper redirect headers deny framing; API paths never receive wrapper DENY',async()=>{
 const req=(pathname)=>({url:'https://app.test'+pathname,method:'GET',cookies:{get(){return undefined;}},headers:new Headers(),nextUrl:{pathname,search:'',searchParams:new URLSearchParams(),clone(){return new URL('https://app.test'+pathname);}}});
 const r=await proxy(req('/panel/canvas/id/print'));assert.equal(r.status,307);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('content-security-policy'),"frame-ancestors 'none'");
 const api=await proxy(req('/api/canvas/renderer'));assert.equal(api.headers.get('x-frame-options'),null);
 const headers=await cfg.headers();assert.deepEqual(headers.map(h=>h.source),['/panel/canvas/:path*']);assert.equal(cfg.outputFileTracingIncludes['/api/canvas/renderer'][0],'./renderer-assets/mermaid-12.3.0.min.js');
});

test('0108 SVG route uses accepted derivative and attachment, no CORS',async()=>{reset();globalThis.__canvasData.availability.exports=true;const response=await download.GET(new Request('https://app.test/?format=svg'),ctx);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/svg\+xml/);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(await response.text(),'<svg/>');});
test('0108 render forwards the strict derivative contract and selected version',async()=>{reset();globalThis.__canvasData.availability.exports=true;const response=await render.POST(new Request('https://app.test/render',{method:'POST',headers:{Origin:'https://app.test','Content-Type':'application/json'},body:JSON.stringify({svg:'<svg/>'})}),ctx);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,canvas_id:'canvas-id',version:2,renderer_version:'1',sha256:'a'.repeat(64)});});

test('actual renderer HTTP body script bytes match every script-src hash',async()=>{
 reset();const old=process.env.SJC_CANVAS_ENABLED;process.env.SJC_CANVAS_ENABLED='1';
 try{
  const response=await renderer.GET();assert.equal(response.status,200);
  const body=await response.text();
  const scripts=[...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const policy=response.headers.get('content-security-policy').split('script-src ')[1].split(';')[0];
  assert.equal(scripts.length,2);
  assert.deepEqual(policy.match(/'sha256-[^']+'/g).sort(),scripts.map(s=>`'sha256-${createHash('sha256').update(s,'utf8').digest('base64')}'`).sort());
 }finally{if(old===undefined)delete process.env.SJC_CANVAS_ENABLED;else process.env.SJC_CANVAS_ENABLED=old;}
});
