import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {parseDocument,DomUtils} from 'htmlparser2';
import ts from 'typescript';
import swc from 'next/dist/build/swc/index.js';
import {buildCanvasRendererDocument,MERMAID_ASSET_PATH,MERMAID_ASSET_SHA256} from '../lib/canvas-renderer.mjs';
import {validateCanvasSvg} from '../lib/canvas-content.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const asset=read(MERMAID_ASSET_PATH);
const options={mermaidBundle:asset,mermaidSha256:MERMAID_ASSET_SHA256};
const hash=s=>createHash('sha256').update(s,'utf8').digest('base64');
const scripts=doc=>[...doc.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const {connectCanvasRenderer}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(read('components/panel/canvas/bridge.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const source='flowchart TD\nA[Plan]-->B[Build]\nB-->C[Inspect]\nC-->D[Handover]';
// Output conventions from pinned Mermaid 12.3.0: setupGraphViewbox.js,
// accessibility.ts and rendering-util/createText.ts. This is a DOM/layout seam,
// NOT a claim to run a browser layout engine in Node. The coordinator's probe
// below exercises real Mermaid render, text metrics, sandbox and HTTP CSP.
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 180 400" role="graphics-document document" style="max-width:180px"><style>.node{fill:red}</style><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z"/></marker></defs><g class="node"><rect width="160" height="40"/><text><tspan x="0" y="-0.1em" dy="1.1em">Plan</tspan><tspan x="0" y="1em" dy="1.1em">Build</tspan><tspan>Inspect</tspan><tspan>Handover</tspan></text></g><path d="M10 10 L20 20" marker-end="url(#arrow)"/></svg>`;

// Tiny XML DOM adapter for the sanitizer only, using the installed XML parser.
// No Mermaid layout, DOMPurify, CSP or browser behavior is mocked as successful.
class Element {
 constructor(node){this.node=node;}
 get localName(){return this.node.name;}
 get namespaceURI(){return 'http://www.w3.org/2000/svg';}
 get attributes(){return Object.entries(this.node.attribs).map(([name,value])=>({name,value}));}
 getAttribute(name){return this.node.attribs[name]??null;}
 setAttribute(name,value){this.node.attribs[name]=value;}
 hasAttribute(name){return Object.hasOwn(this.node.attribs,name);}
 removeAttribute(name){delete this.node.attribs[name];}
 remove(){DomUtils.removeElement(this.node);}
 querySelectorAll(){return DomUtils.findAll(n=>!!n.name,this.node.children).map(n=>new Element(n));}
 getBoundingClientRect(){return {width:Number(this.getAttribute('width')),height:Number(this.getAttribute('height'))};}
}
class DOMParser {
 parseFromString(text){const doc=parseDocument(text,{xmlMode:true});return {documentElement:new Element(doc.children.find(n=>n.name)),querySelector:()=>null,doctype:null};}
}
class XMLSerializer {serializeToString(element){return DomUtils.getOuterHTML(element.node,{xmlMode:true});}}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
async function harness(doc,{drawing=svg,announce=true,expire=null,stall=false,abort=false,spoof=false}={}){
 const hostListeners=new Map(),childListeners=new Map(),timers=new Map(),logs=[],rendered=[],failures=[],sent=[];
 let clock=0,timerId=0,child,removed=false,disconnected=false,renderCalls=0;
 const timer=(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;};
 const clear=id=>timers.delete(id);
 class Channel {
  constructor(){const a={start(){},close(){this.closed=true;}},b={start(){},close(){this.closed=true;}};a.postMessage=data=>queueMicrotask(()=>{if(!b.closed)b.onmessage?.({data});});b.postMessage=data=>queueMicrotask(()=>{if(!a.closed)a.onmessage?.({data});});this.port1=a;this.port2=b;}
 }
 const parent={postMessage:data=>{if(announce)queueMicrotask(()=>hostListeners.get('message')?.({data,source:child,origin:'null'}));}};
 const frame={get contentWindow(){return child;},removeAttribute:name=>{assert.equal(name,'src');removed=true;}};
 const root={replaceChildren(element){this.firstElementChild=element;}};
 const context=createContext({crypto:webcrypto,TextEncoder,setTimeout:timer,clearTimeout:clear,performance:{now:()=>clock},parent,document:{getElementById:()=>root,documentElement:{scrollHeight:400},importNode:n=>n},DOMParser,XMLSerializer,
  addEventListener:(name,fn)=>childListeners.set(name,fn),removeEventListener:name=>childListeners.delete(name),ResizeObserver:class{observe(){}disconnect(){disconnected=true;}}});
 context.window=context;
 child={postMessage:(data,target,ports)=>{sent.push(data.type);assert.equal(target,'*');queueMicrotask(()=>childListeners.get('message')?.({data,source:parent,origin:'https://app.test',ports}));}};
 const saved={};
 for(const name of ['window','MessageChannel','setTimeout','clearTimeout'])saved[name]=globalThis[name];
 const warn=console.warn;
 const controller=new AbortController();
 let disconnect;
 try{
  globalThis.window={addEventListener:(n,fn)=>hostListeners.set(n,fn),removeEventListener:n=>hostListeners.delete(n)};
  globalThis.MessageChannel=Channel;globalThis.setTimeout=timer;globalThis.clearTimeout=clear;console.warn=code=>logs.push(code);
  disconnect=connectCanvasRenderer({frame,id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',version:3,source,signal:controller.signal,onRendered:r=>rendered.push(r),onHeight(){},onEscape(){},onFailure:c=>failures.push(c)});
  if(spoof){
   const message={type:'canvas-ready',instance_id:'a'.repeat(32),nonce:'b'.repeat(32)};
   for(const event of [{source:{},origin:'null',data:message},{source:child,origin:'https://app.test',data:message},{source:child,origin:'null',data:{...message,nonce:'wrong'}},{source:child,origin:'null',data:{...message,source:'private'}}])hostListeners.get('message')(event);
   assert.deepEqual(sent,[]);
  }
  const [bundle,bootstrap]=scripts(doc);
  runInContext(bundle,context,{timeout:3000});
  assert.equal(typeof context.mermaid.initialize,'function');
  // Real vendored startup/initialize; explicit parser+layout seam for SVG adapter.
  const vertices=runInContext('new Map([[1,{}],[2,{}],[3,{}],[4,{}]])',context);
  context.mermaid={initialize:context.mermaid.initialize,mermaidAPI:{getDiagramFromText:async text=>{assert.equal(text,source);return {db:{getVertices:()=>vertices,getEdges:()=>[1,2,3]}};}},render:async (_id,text)=>{renderCalls++;assert.equal(text,source);return stall?new Promise(()=>{}):{svg:drawing};}};
  runInContext(bootstrap,context,{timeout:1000});
  await flush();
  if(abort)controller.abort();
  if(expire!==null){clock+=expire;for(const [id,t] of [...timers])if(t.delay===expire){timers.delete(id);t.fn();}await flush();}
  return {logs,rendered,failures,sent,root,renderCalls,removed:()=>removed,disconnected:()=>disconnected};
 }finally{
  disconnect?.();
  for(const [name,value] of Object.entries(saved))globalThis[name]=value;
  console.warn=warn;
 }
}

test('served inline script bytes, including the real vendored bundle, match exact CSP hashes',()=>{
 const doc=buildCanvasRendererDocument(options),csp=doc.headers['Content-Security-Policy'];
 assert.equal(scripts(doc).length,2);
 for(const script of scripts(doc))assert.ok(csp.includes(`'sha256-${hash(script)}'`));
 assert.doesNotMatch(csp,/allow-same-origin|unsafe-eval|connect-src (?!'none')/);
});

test('parent and served bootstrap complete one-shot render after normalizing Mermaid SVG',async()=>{
 const h=await harness(buildCanvasRendererDocument(options),{spoof:true});
 assert.deepEqual(h.failures,[]);assert.equal(h.renderCalls,1);assert.equal(h.rendered.length,1);assert.deepEqual(h.sent,['connect']);
 const result=h.rendered[0];assert.equal(result.width,180);assert.equal(result.height,400);
 const canonical=validateCanvasSvg(result.svg).svg;
 for(const label of ['Plan','Build','Inspect','Handover'])assert.ok(canonical.includes(label));
 assert.match(result.svg,/y="-1.6" dy="17.6"/);assert.match(result.svg,/role="graphics-document"/);
 assert.doesNotMatch(result.svg,/<style|class=|style=|100%|\dem"/);
 assert.match(result.svg,/marker-end="url\(#canvas-[a-f0-9]{32}-1-\d+\)"/);
 // Cleanup removes the frame without producing a late diagnostic.
 assert.ok(h.removed());assert.deepEqual(h.logs,[]);
});

test('production SWC-minified builder hashes and executes its emitted bootstrap bytes',async()=>{
 await swc.loadBindings();
 const content=await swc.minify(read('lib/canvas-content.mjs'),{compress:true,mangle:true,module:true,ecma:2017});
 const contentUrl='data:text/javascript;base64,'+Buffer.from(content.code).toString('base64');
 const renderer=await swc.minify(read('lib/canvas-renderer.mjs').replace("'./canvas-content.mjs'",JSON.stringify(contentUrl)),{compress:true,mangle:true,module:true,ecma:2017});
 const compiled=await import('data:text/javascript;base64,'+Buffer.from(renderer.code).toString('base64'));
 const doc=compiled.buildCanvasRendererDocument(options);
 for(const script of scripts(doc))assert.ok(doc.headers['Content-Security-Policy'].includes(`'sha256-${hash(script)}'`));
 const h=await harness(doc);assert.equal(h.rendered.length,1);assert.deepEqual(h.failures,[]);
});

for(const [name,drawing] of [
 ['oversized viewBox',svg.replace('180 400','9000 400')],
 ['invalid viewBox',svg.replace('180 400','NaN 400')],
 ['nonpositive viewBox',svg.replace('180 400','0 400')],
 ['event attribute',svg.replace('<rect ','<rect onclick="alert(1)" ')],
 ['foreignObject',svg.replace('<rect ','<foreignObject/><rect ')],
 ['external marker',svg.replace('url(#arrow)','url(https://example.test/#arrow)')],
 ['unrecognized role',svg.replace('graphics-document document','evil')],
 ['excessive text offset',svg.replace('-0.1em','9000em')],
])test(`SVG adapter still fails closed: ${name}`,async()=>{
 const h=await harness(buildCanvasRendererDocument(options),{drawing});
 assert.equal(h.rendered.length,0);assert.deepEqual(h.failures,['RENDER_FAILED']);assert.deepEqual(h.logs,['CANVAS_RENDER_FAILED']);assert.ok(h.removed());
});

// Real Mermaid 12.3.0 output (captured from the vendored bundle in Chromium with the
// renderer's own initialize config). It carries decorative <filter><feDropShadow/>
// drop shadows; the adapter must strip them and still draw. A hand-made fixture
// without shadows let the coordinator's real-browser QA fail every diagram.
test('real Mermaid 12.3.0 flowchart output (with drop-shadow filters) renders', async () => {
 const real = read('tests/fixtures/canvas-mermaid-12.3.0-flowchart.svg');
 assert.match(real, /<filter[\s>]/);
 const h = await harness(buildCanvasRendererDocument(options), {drawing: real});
 assert.deepEqual(h.failures, []);
 assert.equal(h.rendered.length, 1);
 assert.doesNotMatch(h.rendered[0].svg, /<filter|feDropShadow|filter=/);
});
test('SVG adapter still fails closed on a non-decorative unknown element next to a filter', async () => {
 const real = read('tests/fixtures/canvas-mermaid-12.3.0-flowchart.svg').replace('<g', '<foreignObject/><g');
 const h = await harness(buildCanvasRendererDocument(options), {drawing: real});
 assert.equal(h.rendered.length, 0); assert.deepEqual(h.failures, ['RENDER_FAILED']);
});

test('a missing child announcement logs only a fixed handshake diagnostic and closes the frame',async()=>{
 const h=await harness(buildCanvasRendererDocument(options),{announce:false,expire:10000});
 assert.deepEqual(h.failures,['LOAD_TIMEOUT']);assert.deepEqual(h.logs,['CANVAS_HANDSHAKE_TIMEOUT']);assert.equal(h.sent.length,0);assert.equal(h.rendered.length,0);assert.ok(h.removed());
});
test('a stalled render logs only the fixed render timeout diagnostic',async()=>{
 const h=await harness(buildCanvasRendererDocument(options),{stall:true,expire:3000});
 assert.deepEqual(h.failures,['RENDER_TIMEOUT']);assert.deepEqual(h.logs,['CANVAS_RENDER_TIMEOUT']);assert.ok(h.removed());
});
test('aborting a stalled frame cancels the watchdog without logging private data or failure',async()=>{
 const h=await harness(buildCanvasRendererDocument(options),{stall:true,abort:true,expire:3000});
 assert.deepEqual(h.failures,[]);assert.deepEqual(h.logs,[]);assert.equal(h.rendered.length,0);assert.ok(h.removed());
});

test('upstream responsive SVG, fallback role and em offsets each require adaptation',()=>{
 for(const raw of [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 180 400"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 400" role="graphics-document document"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 400"><text><tspan y="-0.1em" dy="1.1em">Plan</tspan></text></svg>',
 ])assert.throws(()=>validateCanvasSvg(raw),{code:'UNSAFE_CONTENT'});
});
