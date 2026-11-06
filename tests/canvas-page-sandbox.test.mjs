import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildCanvasPageDocument,buildCanvasPageFile,CANVAS_PREVIEW_BOOTSTRAP,CANVAS_PREVIEW_BOOTSTRAP_SHA256,CANVAS_PREVIEW_CSP} from '../lib/canvas-renderer.mjs';
import {validatePageSource} from '../lib/canvas-content.mjs';
import {layouts,adversarial} from './fixtures/canvas-page-layouts.mjs';
test('static grammar yields canonical, idempotent bytes for realistic pages',()=>{
 for(const source of layouts){const a=validatePageSource(source);assert.equal(validatePageSource(a.source).source,a.source);const d=buildCanvasPageDocument(source);assert.ok(d.html.includes(a.source));}
});
test('bridge has an exact source-independent hash and cannot be replaced',()=>{
 assert.equal(createHash('sha256').update(CANVAS_PREVIEW_BOOTSTRAP).digest('base64'),CANVAS_PREVIEW_BOOTSTRAP_SHA256);
 for(const source of layouts){const d=buildCanvasPageDocument(source);assert.equal(d.headers['Content-Security-Policy'],CANVAS_PREVIEW_CSP);assert.equal(d.html.split('<script>').length,2);assert.ok(d.html.includes('<script>'+CANVAS_PREVIEW_BOOTSTRAP+'</script>'));}
 for(const source of adversarial)assert.throws(()=>buildCanvasPageDocument(source));
});
test('source closing script text never joins bridge and static files have no bridge',()=>{
 const source='<p>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>';
 const d=buildCanvasPageDocument(source);assert.equal(d.html.match(/<script>/g).length,1);assert.ok(d.html.includes(source));
 const file=buildCanvasPageFile(source,'Weekly <board>',1);assert.ok(!file.includes('<script'));assert.ok(!file.includes(CANVAS_PREVIEW_BOOTSTRAP));assert.match(file,/script-src &#39;none&#39;/);assert.match(file,/Weekly &lt;board&gt;/);
 assert.throws(()=>buildCanvasPageFile('<script>alert(1)</script>','old',1));
});
function child(){const handlers={},sent=[],port={postMessage:m=>sent.push(m),start(){},close(){}};let globalPosts=0;
 const context={crypto:{getRandomValues:a=>a.fill(7)},Uint8Array,performance:{now:()=>500},setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{scrollHeight:1e12,setAttribute(){}},body:{scrollHeight:1e12}},parent:{postMessage:()=>globalPosts++},addEventListener:(k,v)=>handlers[k]=v,removeEventListener:k=>delete handlers[k]};context.window=context;
 vm.runInNewContext(CANVAS_PREVIEW_BOOTSTRAP,context);return {context,handlers,port,sent,get globalPosts(){return globalPosts;}};
}
test('arbitrary window/port messages refused; one bound port, bounded height and print only',()=>{
 const c=child(),id='07'.repeat(16),nonce=id;
 c.handlers.message({source:{},data:{type:'connect',instance_id:id,nonce},ports:[c.port]});assert.equal(c.sent.length,0);
 c.handlers.message({source:c.context.parent,origin:'https://app.test',data:{type:'connect',instance_id:id,nonce,source:'<script>'},ports:[c.port]});assert.equal(c.sent.length,0);
 c.handlers.message({source:c.context.parent,origin:'https://app.test',data:{type:'connect',instance_id:id,nonce},ports:[c.port]});assert.equal(c.sent[0].type,'ready');assert.equal(c.sent.find(m=>m.type==='height').height,8192);assert.equal(c.sent.find(m=>m.type==='height').overflow,true);
 assert.equal(c.handlers.message,undefined);assert.equal(c.globalPosts,1);
 c.port.onmessage({data:{type:'render',instance_id:id,nonce,source:'alert(1)'}});assert.equal(c.sent.length,2);
});
test('parent protocol checks exact frame, opaque origin, nonce, shape and height',()=>{
 const s=readFileSync(new URL('../components/panel/canvas/page-bridge.ts',import.meta.url),'utf8');
 for(const check of ["event.source!==frame.contentWindow","event.origin!=='null'",'data.nonce!==nonce','height<=8192','Object.keys'])assert.ok(s.includes(check),check);
});
test('bounds cover deep trees, excessive grids, SVG paths, resources and namespace confusion',()=>{
 for(const source of ['<div>'.repeat(25)+'x'+'</div>'.repeat(25),'<iframe src="/"/>','<object data="/"/>','<div style="font-family:remote">x</div>','<div style="background:@import x">x</div>','<svg><path d="M0 0 L1 1" onload="x"/></svg>','<svg><use href="https://evil.test/#x"/></svg>','<math><mtext>x</mtext></math>','<div style="grid-template-columns:repeat(24,repeat(24,1fr))">x</div>'])assert.throws(()=>validatePageSource(source));
});

test('aggregate drawing and CSS grid/depth bounds are enforced on realistic static pages',()=>{
 const path='<svg><path d="M0 0 '+'H0 '.repeat(50001)+'"/></svg>';
 assert.throws(()=>validatePageSource(path),e=>e.code==='TOO_COMPLEX');
 assert.throws(()=>validatePageSource('<div>'+'<span>x</span>'.repeat(5001)+'</div>'),e=>e.code==='TOO_COMPLEX');
 assert.throws(()=>validatePageSource('<svg><defs><marker id="a"><path d="M0 0 L1 1"/></marker></defs><path d="M0 0 L2 2" marker-end="url(#missing)"/></svg>'));
 assert.equal(validatePageSource('<svg><defs><marker id="a"><path d="M0 0 L1 1"/></marker></defs><path d="M0 0 L2 2" marker-end="url(#a)"/></svg>').kind,'page');
});

test('bound print-layout command never accepts source, navigation or another nonce',()=>{
 const c=child(),instance_id='07'.repeat(16),nonce=instance_id;let changes=[];
 c.context.document.documentElement.setAttribute=(...args)=>changes.push(args);
 c.handlers.message({source:c.context.parent,origin:'https://app.test',data:{type:'connect',instance_id,nonce},ports:[c.port]});
 for(const m of [{type:'print-layout',instance_id,nonce:'wrong',sequence:1,print:true},{type:'print-layout',instance_id,nonce,sequence:1,print:true,source:'<script>x</script>'},{type:'navigate',instance_id,nonce,sequence:1,print:true}])c.port.onmessage({data:m});
 assert.deepEqual(changes,[]);c.port.onmessage({data:{type:'print-layout',instance_id,nonce,sequence:1,print:true}});assert.equal(JSON.stringify(changes),JSON.stringify([['data-print','true']]));
});

test('real parent connector rejects sibling frames, stale nonces and action-shaped messages',async()=>{
 const ts=await import('typescript');const events={},ports=[],calls=[],frameWindow={postMessage:(...a)=>calls.push(a)},controller=new AbortController();let removed=false,ready=0,height=0,boundary=0;
 const frame={contentWindow:frameWindow,removeAttribute:()=>removed=true};
 const context={exports:{},window:{addEventListener:(k,v)=>events[k]=v,removeEventListener:k=>delete events[k]},MessageChannel:class{constructor(){this.port1={start(){},close(){}};this.port2={};ports.push(this.port1);}},performance:{now:()=>500},setTimeout:()=>1,clearTimeout(){}};
 const source=ts.transpileModule(readFileSync(new URL('../components/panel/canvas/page-bridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,context);context.exports.connectCanvasPage({frame,signal:controller.signal,onReady:()=>ready++,onHeight:()=>height++,onBoundary:()=>boundary++,onFailure:()=>assert.fail('unexpected failure')});
 const instance_id='a'.repeat(32),nonce='b'.repeat(32),m={type:'canvas-ready',instance_id,nonce};
 for(const e of [{source:{},origin:'null',data:m},{source:frameWindow,origin:'https://app.test',data:m},{source:frameWindow,origin:'null',data:{...m,action:'save'}}])events.message(e);
 assert.equal(ports.length,0);events.message({source:frameWindow,origin:'null',data:m});assert.equal(calls.length,1);assert.equal(events.message,undefined);
 const post=m=>ports[0].onmessage({data:{instance_id,nonce,sequence:0,...m}});
 for(const m of [{type:'ready',nonce:'wrong'},{type:'save'},{type:'height',height:999999,overflow:true},{type:'height',height:600,overflow:false,action:'approve'},{type:'boundary',backward:'true'}])post(m);
 assert.equal(ready+height+boundary,0);post({type:'ready'});post({type:'ready'});assert.equal(ready,1);post({type:'height',height:8192,overflow:true});assert.equal(height,1);post({type:'escape'});assert.equal(boundary,1);controller.abort();assert.equal(removed,true);
});
