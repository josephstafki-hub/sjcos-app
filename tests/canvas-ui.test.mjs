import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {hostWidths,deviceCases} from './fixtures/ask-pane-host.mjs';
const root=new URL('../',import.meta.url);
registerHooks({resolve(s,c,n){if(s==='react'&&c.parentURL?.includes('/components/panel/'))return {url:'canvas-react:hooks',shortCircuit:true};if(c.parentURL==='canvas-react:hooks')return n(s,{...c,parentURL:import.meta.url});if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}return n(s,c);},load(u,c,n){if(u==='canvas-react:hooks')return {format:'module',shortCircuit:true,source:`export * from 'react'; export const useSyncExternalStore=(_subscribe,get)=>get();`};if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return n(u,c);}});
const {CanvasCard}=await import('../components/panel/CanvasCard.tsx');
const {CanvasPane}=await import('../components/panel/CanvasPane.tsx');
const {askPaneLayout}=await import('../components/panel/askPaneLayout.ts');
const {groupCanvasEvents,fixCanvasPrompt}=await import('../components/panel/canvas/state.ts');
const version={version:2,title:'Permit steps',summary:'From application through inspection.',change_note:'Moved inspection',actor:{id:'u',name:'Claude'},run_id:'r',created_at:'2026-11-05T12:00:00Z',restored_from_version:null,design:null};
const event={id:'2',thread_id:'t',actor_user_id:'u',run_id:'r',at:version.created_at,group_id:'run:r:canvas:c',kind:'updated',canvas_id:'c',version};
const availability={revision:'1',master:true,diagrams:true,pages:false,floor:false,exports:true,staff:true,source:true};
const render=(C,p)=>renderToString(React.createElement(C,p));
test('card showing remains a focusable suppressed action; older card opens pinned version',()=>{
 assert.match(render(CanvasCard,{event,availability,latestVersion:2,showing:true,onOpen(){}}),/aria-disabled="true"/);
 const older=render(CanvasCard,{event,availability,latestVersion:3,onOpen(){}});assert.match(older,/Open version 2/);assert.match(older,/newer version available/);
});
for(const kind of ['unavailable','deleted','off','creating'])test(`card ${kind} never leaks cached metadata`,()=>{
 const html=render(CanvasCard,{event:{...event,kind:kind==='off'?'updated':kind},availability:{...availability,master:kind!=='off'},creating:kind==='creating',onOpen(){}});
 assert.doesNotMatch(html,/Permit steps|From application/);
 assert.match(html,kind==='off'?/Canvas is turned off/:kind==='creating'?/Claude is making a canvas/:kind==='deleted'?/This canvas was deleted/:/This canvas isn/);
});
test('event pages merge run groups by version, redact deletions, and preserve human cards',()=>{
 const first={...event,id:'1',version:{...version,version:1}};
 assert.equal(groupCanvasEvents([event,first,event])[0].version.version,2);
 assert.equal(groupCanvasEvents([event,{...event,id:'3',kind:'deleted'}])[0].kind,'deleted');
 assert.equal(groupCanvasEvents([event,{...first,id:'4',run_id:null,group_id:'event:4'}]).length,2);
});
test('source fix prompt pins title/version and the bounded diagnostic, never guesses pronouns',()=>{
 assert.equal(fixCanvasPrompt(version,'RENDER_FAILED','SYNTAX_ERROR'),'Fix the "Permit steps" diagram (version 2). The error was: Mermaid could not parse the diagram. Check its syntax.');
});
for(const f of hostWidths)test(`Canvas consumes H5 measured width ${f.width}`,()=>{
 const p=askPaneLayout({width:f.width,height:900,mode:'popout',selected:true});assert.equal(p.split,f.split);assert.ok(Math.abs(p.pane-f.pane)<.02);
 const context={snapshot:{kind:'canvas',id:'c',label:version.title,thread_id:'t',user_id:'u',run_id:'r',selected_version:2,latest_version:2},mode:'popout',compact:p.compact,landscape:p.landscape,paneWidth:p.pane,viewportWidth:f.width,split:p.split,signal:new AbortController().signal,frameBoundary(){}};
 const html=render(CanvasPane,{context,slot:'content'});assert.match(html,/Loading canvas/);assert.doesNotMatch(html,/iframe|allow-same-origin/);
});
for(const f of deviceCases)test(`Canvas shared device fixture ${f.name}`,()=>{const p=askPaneLayout({width:f.width,height:f.height,mode:f.mode,selected:true,safeArea:80});assert.equal(p.compact,f.compact);assert.equal(p.landscape,f.landscape);if(f.stage)assert.equal(p.stage,f.stage);if(f.pane)assert.ok(Math.abs(p.pane-f.pane)<.02);});
test('orphan and human canvas cards stay at their server time between chat messages',async()=>{
 const {canvasTranscript}=await import('../components/panel/canvas/state.ts');
 const messages=[{id:'m1',role:'user',createdAt:'2026-11-05T11:00:00Z'},{id:'m2',role:'assistant',runId:'other',createdAt:'2026-11-05T13:00:00Z'}];
 const rows=canvasTranscript(messages,[event]);assert.deepEqual(rows.map(x=>x.kind),['message','canvas','message']);
 assert.deepEqual(canvasTranscript([...messages,{id:'reply',role:'assistant',runId:'r',createdAt:'2026-11-05T14:00:00Z'}],[event]).map(x=>x.kind),['message','message','message']);
});
test('private Canvas reset drops optional callbacks, updating state and all source bytes',async()=>{
 const store=await import('../components/panel/canvas/store.ts');store.updateCanvas({openCanvas(){},updating:true,views:{c:{code:{code:'private bytes'}}}});store.clearCanvas();
 assert.equal(store.canvasState().openCanvas,undefined);assert.equal(store.canvasState().updating,undefined);assert.deepEqual(store.canvasState().views,{});assert.equal(store.canvasState().scope,null);
});

const store=await import('../components/panel/canvas/store.ts');
const context={snapshot:{kind:'canvas',id:'c',label:version.title,thread_id:'t',user_id:'u',run_id:'r',selected_version:2,latest_version:3},mode:'popout',compact:false,landscape:false,paneWidth:721,viewportWidth:1280,split:true,signal:new AbortController().signal,frameBoundary(){}};
function loaded(patch={}){
 store.clearCanvas();store.patchCanvas('c',{data:{canvas:{id:'c',latest_version:3},selected:version,availability,capabilities:{code:true,save:true,preview:false}},code:{code:'A-->B',availability},...patch});
}
test('syntax error shows exactly Copy code and Ask Claude to fix it with the same diagnostic as the prompt',()=>{
 loaded({renderError:'RENDER_FAILED',renderDiagnostic:'SYNTAX_ERROR'});
 const html=render(CanvasPane,{context:{...context,compact:true},slot:'content'});
 assert.match(html,/Couldn&#x27;t draw this diagram. Its code is below./);assert.match(html,/Mermaid could not parse the diagram. Check its syntax./);
 assert.equal((html.match(/<button/g)||[]).length,2);assert.match(html,/>Copy code</);assert.match(html,/>Ask Claude to fix it</);assert.doesNotMatch(html,/Show code|Try again/);
 assert.match(html,/font-variant-ligatures:none/);assert.match(html,/font-feature-settings:/);
});
test('complexity state contains Show code and Ask Claude to simplify it without syntax copy',()=>{
 loaded({renderError:'RENDER_TIMEOUT'});const html=render(CanvasPane,{context:{...context,compact:true},slot:'content'});
 assert.match(html,/This diagram is too complex to show here./);assert.match(html,/>Show code</);assert.match(html,/>Ask Claude to simplify it</);assert.doesNotMatch(html,/Its code is below|Copy code/);
});
test('older-version meta retains version before ready notice at every width',()=>{
 loaded();for(const compact of [true,false]){
  const html=render(CanvasPane,{context:{...context,compact},slot:'meta'}).replaceAll('<!-- -->','');
  assert.match(html,/Diagram · Version 2 of 3/);assert.match(html,/· Version 3 is ready/);assert.match(html,/>Latest</);
 }
});
test('fuller Preview and Code pressed state is visible; Save and Open canvas have borders',()=>{
 loaded();let html=render(CanvasPane,{context,slot:'content'});assert.match(html,/aria-pressed="true"/);assert.match(html,/aria-pressed:bg-card/);assert.match(html,/border border-rule bg-card px-3[^>]*>Save to project files/);
 const card=render(CanvasCard,{event,availability,onOpen(){}});assert.match(card,/rounded-md border border-rule bg-card px-3/);
});
test('version times use time only today and month/day otherwise; notes have no empty separators',async()=>{
 const {canvasVersionTime,canvasVersionByline}=await import('../components/panel/canvas/state.ts');
 const now=new Date(2026,10,5,16,0);assert.equal(canvasVersionTime(new Date(2026,10,5,14,14).toISOString(),now),'2:14 PM');assert.equal(canvasVersionTime(new Date(2026,10,4,14,14).toISOString(),now),'Nov 4, 2:14 PM');
 assert.equal(canvasVersionByline('', 'Joe Stafki'),'Joe Stafki');assert.equal(canvasVersionByline('Moved inspection','Claude'),'Moved inspection · Claude');
});

for(const compact of [false,true])for(const renderError of ['RENDER_FAILED','RENDER_TIMEOUT','LOAD_TIMEOUT',undefined])test(`Save visibility for ${renderError??'loading'} compact=${compact}`,()=>{
 loaded({renderError,exportReady:false,sheet:compact?'menu':undefined});
 const html=render(CanvasPane,{context:{...context,compact},slot:'content'});
 if(['RENDER_FAILED','RENDER_TIMEOUT'].includes(renderError))assert.doesNotMatch(html,/Save to project files/);
 else assert.match(html,/<button[^>]*disabled=""[^>]*>Save to project files/);
});
function bordered(html,label){
 const controls=[...html.matchAll(/<(button|a)\b([^>]*)>([^<]*)<\/(?:button|a)>/g)].filter(m=>m[3]===label);
 assert.ok(controls.length,`missing ${label}`);for(const m of controls)assert.match(m[2],/rounded-md border border-rule bg-card px-3/,label);
}
test('all state-action controls have visible bordered button affordance',()=>{
 for(const error of ['AUTH_REQUIRED','DELETE_FAILED','INTERNAL_ERROR']){loaded({error});bordered(render(CanvasPane,{context,slot:'content'}),error==='AUTH_REQUIRED'?'Sign in':'Try again');}
 for(const renderError of ['RENDER_FAILED','RENDER_TIMEOUT','LOAD_TIMEOUT']){loaded({renderError});const html=render(CanvasPane,{context,slot:'content'});if(renderError==='RENDER_FAILED')bordered(html,'Ask Claude to fix it');else{bordered(html,'Show code');bordered(html,renderError==='LOAD_TIMEOUT'?'Try again':'Ask Claude to simplify it');}}
 for(const [sheet,label] of [['restore','Use this version'],['delete','Delete canvas']]){loaded({sheet});bordered(render(CanvasPane,{context,slot:'content'}),label);}
 store.clearCanvas();bordered(render(CanvasPane,{context:{...context,snapshot:{...context.snapshot,id:'empty'}},slot:'content'}),'Draw the steps for a permit');
});

test('page uses responsive routed iframe, page labels/help and HTML-only export menu',()=>{
 const data={canvas:{id:'c',kind:'page',latest_version:3},selected:version,availability:{...availability,pages:true},capabilities:{code:true,save:true,preview:true,download_formats:['html','txt']}};
 loaded({data,code:{code:'<h1>Weekly board</h1>'},exportReady:true});
 let html=render(CanvasPane,{context,slot:'content'});assert.match(html,/About this page/);assert.match(html,/sandbox="allow-scripts"/);assert.match(html,/src="\/api\/canvas\/c\/versions\/2\/preview"/);assert.doesNotMatch(html,/srcdoc|allow-same-origin|About this diagram/);
 store.patchCanvas('c',{tab:'code'});html=render(CanvasPane,{context,slot:'content'});assert.match(html,/This page can show text, tables, and drawings. Ask Claude to change it./);assert.match(html,/&lt;h1&gt;Weekly board&lt;\/h1&gt;/);
 store.patchCanvas('c',{sheet:'menu',tab:'preview'});html=render(CanvasPane,{context:{...context,compact:true},slot:'content'});assert.match(html,/Page \(HTML\)/);assert.doesNotMatch(html,/Drawing \(SVG\)|Diagram code/);
 store.updateCanvas({items:[{canvas:data.canvas,latest:version}]});assert.match(render(CanvasCard,{event,availability,onOpen(){}}),/Page/);store.clearCanvas();
});
