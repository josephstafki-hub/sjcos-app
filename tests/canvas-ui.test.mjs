import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {hostWidths,deviceCases} from './fixtures/ask-pane-host.mjs';
const root=new URL('../',import.meta.url);
registerHooks({resolve(s,c,n){if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}return n(s,c);},load(u,c,n){if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return n(u,c);}});
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
test('source fix prompt pins title/version with fixed diagnostic, never guesses pronouns',()=>{
 assert.equal(fixCanvasPrompt(version,'RENDER_FAILED'),'Fix the "Permit steps" diagram (version 2). The error was: The diagram could not be drawn.');
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
