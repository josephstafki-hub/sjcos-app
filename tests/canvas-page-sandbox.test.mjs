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
 const context={crypto:{getRandomValues:a=>a.fill(7)},Uint8Array,performance:{now:()=>500},setTimeout:()=>1,clearTimeout(){},ResizeObserver:class{observe(){}disconnect(){}},document:{documentElement:{scrollHeight:1e12,setAttribute(){}},body:{scrollHeight:1e12,getBoundingClientRect:()=>({height:1e12})}},parent:{postMessage:()=>globalPosts++},addEventListener:(k,v)=>handlers[k]=v,removeEventListener:k=>delete handlers[k]};context.window=context;
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
 for(const check of ["event.source!==frame.contentWindow","event.origin!=='null'",'data.nonce!==nonce','height>8192','Object.keys'])assert.ok(s.includes(check),check);
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
 assert.deepEqual(changes,[]);c.port.onmessage({data:{type:'print-layout',instance_id,nonce,sequence:1,print:true,layout_id:1}});assert.equal(JSON.stringify(changes),JSON.stringify([['data-print','true']]));
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

// Round 1 expectations FIRST: observer ordering, trailing resize, shrinking,
// disposal, immediate/correlated print response, parent coalescing and timeout.
function clockwork(){let now=0,id=0;const timers=new Map();return {now:()=>now,setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},tick(ms){const end=now+ms;for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;}};}
function scheduledChild(){const clock=clockwork(),handlers={},sent=[];let height=1200,resize,closed=0;
 const port={postMessage:m=>sent.push(m),start(){},close(){closed++;}};
 const context={...clock,performance:{now:clock.now},crypto:{getRandomValues:a=>a.fill(7)},Uint8Array,ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}},document:{documentElement:{scrollHeight:600,setAttribute(){}},body:{scrollHeight:600,getBoundingClientRect:()=>({height})}},parent:{postMessage(){}},addEventListener:(k,v)=>handlers[k]=v,removeEventListener:k=>delete handlers[k]};
 vm.runInNewContext(CANVAS_PREVIEW_BOOTSTRAP,context);const identity={instance_id:'07'.repeat(16),nonce:'07'.repeat(16)};
 return {clock,handlers,sent,resize:()=>resize(),setHeight:h=>height=h,get closed(){return closed;},connect:()=>handlers.message({source:context.parent,origin:'https://app.test',data:{type:'connect',...identity},ports:[port]}),print:layout_id=>port.onmessage({data:{type:'print-layout',...identity,sequence:1,print:true,layout_id}})};
}
test('judge case 12: observer before connection does not consume the initial report',()=>{const c=scheduledChild();c.resize();c.clock.tick(20);c.connect();assert.equal(c.sent.find(m=>m.type==='height')?.height,1200);});
test('judge case 13: resize inside throttle reports the final height without another resize',()=>{const c=scheduledChild();c.connect();c.clock.tick(20);c.setHeight(1400);c.resize();c.clock.tick(180);assert.equal(c.sent.at(-1).height,1400);});
test('connected measurement precedes the first observer and coalesces a resize burst',()=>{const c=scheduledChild();c.connect();for(const h of [900,1000,1300]){c.clock.tick(20);c.setHeight(h);c.resize();}c.clock.tick(140);assert.deepEqual(c.sent.filter(m=>m.type==='height').map(m=>m.height),[1200,1300]);});
test('content measurement shrinks below a 600px viewport and clamps to a sensible minimum',()=>{const c=scheduledChild();c.setHeight(80);c.connect();assert.equal(c.sent.at(-1).height,200);c.clock.tick(200);c.setHeight(350);c.resize();assert.equal(c.sent.at(-1).height,350);});
test('child disposal cancels trailing measurement and closes the port',()=>{const c=scheduledChild();c.connect();c.clock.tick(20);c.resize();const n=c.sent.length;c.handlers.pagehide();c.clock.tick(1000);assert.equal(c.sent.length,n);assert.equal(c.closed,1);});
test('print layout immediately after ready returns its own forced correlated measurement',()=>{const c=scheduledChild();c.connect();c.setHeight(1500);c.print(1);assert.equal(c.sent.at(-1).type,'print-height');assert.equal(c.sent.at(-1).layout_id,1);assert.equal(c.sent.at(-1).height,1500);});
async function scheduledParent(){const ts=await import('typescript'),clock=clockwork(),events={},heights=[],ports=[],commands=[];let failures=0;
 const controller=new AbortController(),frameWindow={postMessage(){}},frame={contentWindow:frameWindow,removeAttribute(){}};
 const context={exports:{},...clock,performance:{now:clock.now},window:{addEventListener:(k,v)=>events[k]=v,removeEventListener:k=>delete events[k]},MessageChannel:class{constructor(){this.port1={start(){},close(){},postMessage:m=>commands.push(m)};this.port2={};ports.push(this.port1);}}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/panel/canvas/page-bridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const bridge=context.exports.connectCanvasPage({frame,signal:controller.signal,onReady(){},onHeight:(height,overflow)=>heights.push({height,overflow}),onBoundary(){},onFailure:()=>failures++});
 const identity={instance_id:'a'.repeat(32),nonce:'b'.repeat(32)};events.message({source:frameWindow,origin:'null',data:{type:'canvas-ready',...identity}});
 return {bridge,clock,heights,commands,controller,get failures(){return failures;},post:m=>ports[0].onmessage({data:{...identity,sequence:0,...m}})};
}
test('parent coalesces valid rapid measurements instead of dropping the final height',async()=>{const p=await scheduledParent();p.post({type:'height',height:500,overflow:false});p.clock.tick(20);p.post({type:'height',height:1200,overflow:false});p.clock.tick(180);assert.deepEqual(p.heights.map(h=>h.height),[500,1200]);p.bridge.close();});
test('parent accepts print measurement inside throttle only for the requested layout',async()=>{const p=await scheduledParent();p.post({type:'height',height:500,overflow:false});const pending=p.bridge.printLayout(true);const layout_id=p.commands.at(-1).layout_id;p.post({type:'print-height',height:999,overflow:false,layout_id:layout_id+1});assert.equal(p.heights.length,1);p.post({type:'print-height',height:1500,overflow:false,layout_id});const result=await pending;assert.equal(result.height,1500);assert.equal(p.heights.at(-1).height,1500);p.bridge.close();});
test('print measurement timeout is bounded and leaves the connector reusable',async()=>{const p=await scheduledParent();const pending=p.bridge.printLayout(true);p.clock.tick(3000);assert.equal(await pending,null);assert.equal(p.failures,0);p.bridge.close();});
test('abort resolves pending print and cancels a queued parent height',async()=>{const p=await scheduledParent();p.post({type:'height',height:500,overflow:false});p.clock.tick(20);p.post({type:'height',height:1400,overflow:false});const pending=p.bridge.printLayout(true);p.controller.abort();p.clock.tick(3000);assert.equal(await pending,null);assert.equal(p.heights.length,1);});

async function printComponent(){
 const ts=await import('typescript'),states=[],refs=[],deps=[],effects=[],rafs=new Map();let cursor=0,rafId=0,options,resolve,prints=0;
 const bridge={close(){},printLayout:()=>new Promise(r=>resolve=r)};
 const hooks={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef(initial){const i=cursor++;return refs[i]??(refs[i]={current:initial});},useEffect(fn,next){const i=cursor++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){deps[i]=next;effects.push(fn);}}};
 const context={exports:{},AbortController,requestAnimationFrame:fn=>{rafs.set(++rafId,fn);return rafId;},cancelAnimationFrame:id=>rafs.delete(id),window:{addEventListener(){},removeEventListener(){},print:()=>prints++},require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='./page-bridge')return {connectCanvasPage:opts=>{options=opts;return bridge;}};throw Error(name);}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../components/panel/canvas/PagePrint.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
 const render=()=>{cursor=0;const tree=context.exports.PagePrint({id:'c',version:1,title:'Weekly board'});while(effects.length)effects.shift()();return tree;};
 const all=tree=>!tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(all)];
 const button=()=>all(render()).find(n=>n.type==='button');
 render();return {button,render,get options(){return options;},get prints(){return prints;},resolve:m=>resolve(m),flushFrames(){for(const [id,fn] of rafs){rafs.delete(id);fn();}}};
}
test('print button stays disabled at ready until a valid non-overflow height arrives',async()=>{const p=await printComponent();p.options.onReady();assert.equal(p.button().props.disabled,true);p.options.onHeight(500,true);assert.equal(p.button().props.disabled,true);p.options.onHeight(500,false);assert.equal(p.button().props.disabled,false);});
test('print waits for measured print layout and a React height commit before opening dialog',async()=>{const p=await printComponent();p.options.onReady();p.options.onHeight(500,false);p.button().props.onClick();p.flushFrames();assert.equal(p.prints,0);p.resolve({height:1500,overflow:false});await new Promise(setImmediate);p.flushFrames();assert.equal(p.prints,0);const tree=p.render();assert.equal(tree.props.children[1].props.style.height,1500);p.flushFrames();assert.equal(p.prints,1);});
test('print measurement failure never opens a dialog and permits retry',async()=>{const p=await printComponent();p.options.onReady();p.options.onHeight(500,false);p.button().props.onClick();p.resolve(null);await new Promise(setImmediate);p.render();p.flushFrames();assert.equal(p.prints,0);assert.equal(p.button().props.disabled,false);});
