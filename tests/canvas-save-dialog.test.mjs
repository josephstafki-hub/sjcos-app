import test from 'node:test';
import assert from 'node:assert/strict';
import {removedAreas,audienceSentence,acknowledgementLabel,showRowWarnings,normalizeFilename} from '../lib/project-file-writes.mjs';
const options=Array.from({length:21},(_,i)=>({key:`a${i}`,label:`Area ${i}`}));
for(let n=0;n<=21;n++)test(`unknown context: ${n} removals, one exact acknowledgement`,()=>{
 const baseline=options.map(o=>o.key),selected=baseline.slice(n),removed=removedAreas(baseline,selected);
 assert.deepEqual(removed,baseline.slice(0,n));assert.equal(showRowWarnings(removed),n>0&&n<=3);
 const label=acknowledgementLabel(selected,removed,options,'Larson bath');
 if(n===21)assert.equal(label,'I checked this canvas. Share it with everyone who can open Larson bath files.');
 if(n>2&&n<21)assert.match(label,new RegExp(`\\+${n-2} more`));
 if(selected.length>3)assert.equal(audienceSentence('staff',selected,options,'Larson bath'),'Only Joe and staff with every ticked area can read this copy.');
});
test('safe filename and no path',()=>{assert.equal(normalizeFilename('Permit steps',2),'Permit steps (v2).html');assert.throws(()=>normalizeFilename('x',1,'../x.html'));});
test('naturally empty baseline has no removal acknowledgement',()=>assert.deepEqual(removedAreas([],[]),[]));

import {createCanvasFileCall} from '../mcp/canvas-file-call.mjs';
test('Canvas files closed transport refuses HTTP, bare stdio and HTTP ALS before forwarding',async()=>{
 let calls=0;const id='11111111-1111-4111-8111-111111111111',env={SJC_RUN_ID:id,SJC_CONVERSATION_ID:id,SJC_PRINCIPAL_USER_ID:id,SJC_RUN_PROFILE:'operator',SJC_RUN_STARTED_S:'1'};
 for(const settings of [{transportKind:'http',env},{transportKind:'stdio',env:{}},{transportKind:'stdio',env,httpActive:()=>true}]){const call=createCanvasFileCall({...settings,internalCall:async()=>{calls++;}});assert.equal((await call('read',{file_id:'x'})).ok,false);}
 assert.equal(calls,0);
 const paths=[];const call=createCanvasFileCall({transportKind:'stdio',env,internalCall:async(p,b)=>{paths.push(p);assert.equal(b.context.principal_user_id,id);return {ok:true};}});assert.equal((await call('list',{project_slug:'p'})).ok,true);assert.deepEqual(paths,['/api/internal/canvas','/api/internal/canvas-files']);
});

// Controlled React hook lifecycle, executing the actual dialog + in-flow picker
// handlers/effects with action/fetch seams. No browser, DB or server is started.
import React from 'react';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const root=new URL('../',import.meta.url);
registerHooks({resolve(s,c,n){
 if(c.parentURL==='save-react:hooks')return n(s,{...c,parentURL:import.meta.url});
 if(s==='react'&&c.parentURL?.includes('/components/panel/'))return {url:'save-react:hooks',shortCircuit:true};
 if(s==='@/lib/actions/canvas-projects')return {url:'save-action:projects',shortCircuit:true};
 if(s==='@/lib/actions/ai-chat')return {url:'save-action:jobs',shortCircuit:true};
 if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}
 return n(s,c);
},load(u,c,n){
 if(u==='save-react:hooks')return {format:'module',shortCircuit:true,source:`import * as R from 'react';export * from 'react';${['useState','useEffect','useRef','useLayoutEffect','useCallback'].map(k=>`export const ${k}=(...a)=>(globalThis.__saveHooks?.${k}??R.${k})(...a);`).join('')}`};
 if(u==='save-action:projects')return {format:'module',shortCircuit:true,source:`export const searchCanvasProjectsAction=(id,n,q)=>globalThis.__searchCanvasProjects(q);`};
 if(u==='save-action:jobs')return {format:'module',shortCircuit:true,source:`export const searchJobsAction=(q)=>globalThis.__searchCanvasProjects(q);`};
 if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
 return n(u,c);
}});
const {CanvasSaveDialog,CanvasAudienceChips}=await import('../components/panel/CanvasSaveDialog.tsx');
const {JobPicker}=await import('../components/panel/JobPicker.tsx');
import {mounted,elements,text,find,settle} from './fixtures/canvas-mount.mjs';
const saveData={canvas:{id:'c',project_slug:null},selected:{title:'Permit steps',version:2}};
const policy={owner:true,baseline_areas:options.map(o=>o.key),baseline_source:'unknown_context',policy_revision:'rev',area_options:options,project:{slug:'larson',name:'Larson bath'}};
test('unbound dialog → actual inline project picker → owner policy → acknowledgement → Save; prebound project can change',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];let closed=0;
 globalThis.__searchCanvasProjects=async()=>[{kind:'project',slug:'larson',name:'Larson bath',current:true}];
 globalThis.fetch=async(url,init={})=>{calls.push([url,init]);return {ok:true,json:async()=>url.endsWith('/acknowledgement')?{token:'ack',expires_at:Date.now()+60000}:url.endsWith('/save')?{ok:true}:policy};};
 const dialog=mounted(CanvasSaveDialog,{data:saveData,onClose(){closed++;}});let picker;
 try{
  let tree=dialog.render();dialog.effects();assert.ok(find(tree,'Pick a project ▴'));assert.ok(text(tree).includes('Choose a project.'));assert.equal(find(tree,'Save').props.disabled,true);assert.match(find(tree,'Save').props.className,/disabled:opacity-50/);
  let pickElement=elements(tree,e=>e.type===JobPicker)[0];assert.equal(pickElement.props.inline,true);assert.equal(typeof pickElement.props.search,'function');
  picker=mounted(JobPicker,pickElement.props);let pickTree=picker.render();picker.effects();await new Promise(r=>setTimeout(r,25));pickTree=picker.render();
  assert.doesNotMatch(pickTree.props.className,/absolute|top-full/);
  assert.match(elements(pickTree,e=>e.type==='input')[0].props.className,/text-\[16px\]/);
  const projectRow=find(pickTree,'Larson bath');assert.match(projectRow.props.className,/min-h-12/);projectRow.props.onClick();await settle();
  tree=dialog.render();dialog.effects();await settle();tree=dialog.render();
  assert.ok(calls.some(([url])=>url.endsWith('/save-policy?project=larson')));assert.ok(find(tree,'Larson bath ▾'));
  const radios=elements(tree,e=>e.type==='input'&&e.props.type==='radio');assert.equal(radios[0].props.checked,true);
  assert.equal(elements(tree,e=>e.type==='input'&&e.props.type==='checkbox'&&e.props.checked).length,21);
  assert.ok(text(tree).includes('Claude may have used anything in this chat, so every area is ticked.'));
  assert.match(find(tree,'Untick all').props.className,/rounded-md border border-rule bg-card px-3/);
  find(tree,'Untick all').props.onClick();tree=dialog.render();
  assert.ok(text(tree).includes('Tick the line above to save.'));assert.ok(!text(tree).includes('Staff without Area'));
  const ack=elements(tree,e=>e.type==='input'&&e.props.type==='checkbox').at(-1);await ack.props.onChange({target:{checked:true}});await settle();tree=dialog.render();
  assert.equal(find(tree,'Save').props.disabled,false);await find(tree,'Save').props.onClick();await settle();assert.equal(closed,1);
  const body=JSON.parse(calls.find(([url])=>url.endsWith('/save'))[1].body);assert.equal(body.project_slug,'larson');assert.equal(body.declassification_ack,'ack');assert.deepEqual(body.audience,{kind:'staff',required_areas:[]});
  // Change a project on the same mounted dialog; policy and acknowledgement reset.
  find(tree,'Larson bath ▾').props.onClick();tree=dialog.render();pickElement=elements(tree,e=>e.type===JobPicker)[0];pickElement.props.onPick({slug:'second',name:'Second project'});tree=dialog.render();dialog.effects();assert.equal(find(tree,'Save').props.disabled,true);await settle();dialog.render();assert.ok(calls.some(([url])=>url.endsWith('?project=second')));
  const bound=mounted(CanvasSaveDialog,{data:{...saveData,canvas:{...saveData.canvas,project_slug:'larson'}},onClose(){}});assert.equal(elements(bound.render(),e=>e.type===JobPicker).length,0);bound.close();
 }finally{dialog.close();picker?.close();globalThis.fetch=originalFetch;delete globalThis.__searchCanvasProjects;}
});
test('staff audience is readonly catalog-order chips with three names + expandable overflow and empty Staff fallback',()=>{
 const chips=mounted(CanvasAudienceChips,{names:options.slice(0,5).map(o=>o.label)});let tree=chips.render();
 assert.equal(elements(tree,e=>e.type==='span').length,3);assert.equal(tree.props.title,'Area 0, Area 1, Area 2, Area 3, Area 4');assert.equal(tree.props['aria-label'],tree.props.title);
 const more=find(tree,'+2 more');assert.match(more.props['aria-label'],/Area 4/);more.props.onClick();tree=chips.render();assert.equal(elements(tree,e=>e.type==='li').length,5);
 assert.equal(text(mounted(CanvasAudienceChips,{names:[]}).render()),'🔒 Staff');chips.close();
});

test('projectOnly hides rail folder metadata and inline typography is readable',async()=>{
 globalThis.__searchCanvasProjects=async()=>[{kind:'project',slug:'p',name:'Project name',sub:'Secondary',current:true,folderId:'foreign',folderName:'Private folder'}];
 const picker=mounted(JobPicker,{inline:true,projectOnly:true,search:globalThis.__searchCanvasProjects,onPick(){},onDone(){}});
 try{picker.render();picker.effects();await new Promise(r=>setTimeout(r,25));const tree=picker.render(),row=find(tree,'Project nameSecondary');
  assert.equal(row.props.title,'Project name');assert.doesNotMatch(text(tree),/filed|Private folder/);
  assert.match(elements(row,e=>e.type==='span'&&text(e)==='Project name')[0].props.className,/text-body/);
  assert.match(elements(row,e=>e.type==='span'&&text(e)==='Secondary')[0].props.className,/text-meta/);
  assert.match(elements(tree,e=>e.type==='div'&&text(e)==='Projects')[0].props.className,/text-meta/);
 }finally{picker.close();delete globalThis.__searchCanvasProjects;}
});
test('project search failure appears below search row with retry and no empty-result claim',async()=>{
 let calls=0;const search=async()=>++calls===1?{ok:false,code:'CHAT_OFF'}:[{kind:'project',slug:'p',name:'Recovered'}];
 const picker=mounted(JobPicker,{inline:true,projectOnly:true,search,onPick(){},onDone(){}});
 try{picker.render();picker.effects();await new Promise(r=>setTimeout(r,25));let tree=picker.render();
  assert.match(text(tree),/Couldn't load projects\./);assert.doesNotMatch(text(tree),/Chat isn't|No jobs match/);
  const row=elements(tree,e=>e.type==='input')[0];
  assert.equal(elements(tree,e=>e.props?.className?.includes('border-b')&&elements(e,x=>x===row).length&&elements(e,x=>x.props?.role==='status').length).length,0);
  const retry=find(tree,'Try again');assert.ok(retry);retry.props.onClick();picker.render();picker.effects();await new Promise(r=>setTimeout(r,25));tree=picker.render();assert.ok(find(tree,'Recovered'));assert.doesNotMatch(text(tree),/Couldn't load/);
 }finally{picker.close();}
});

// Build R3 design (R3-1): the area checklist must not collapse to a 1-row strip.
// One dialog scroller (the overlay frame), a bounded checklist group with 48px rows,
// and the Cancel/Save row pinned so Save is always on screen.
test('Save dialog layout: one scroller, full-height checklist rows, pinned Save row', async () => {
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../components/panel/CanvasSaveDialog.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /max-h-\[65dvh\][^"]*overflow-auto/);
  assert.match(src, /role="group" aria-label="Required access areas" className="[^"]*\bshrink-0\b[^"]*\boverflow-y-auto\b[^"]*"/);
  assert.match(src, /max-h-\[min\(20rem,38dvh\)\]/);
  assert.match(src, /<label className="flex min-h-12 w-full cursor-pointer items-center gap-3"><input className="size-5 shrink-0 accent-ink" type="checkbox"/);
  assert.match(src, /className="min-h-12 shrink-0 self-start[^"]*"[\s\S]{0,80}>Untick all</);
  assert.match(src, /className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-rule bg-paper py-2">\{error\?<p role="alert"/);
  // R4-1: hint + error live in the pinned footer; the acknowledgement scrolls into view once.
  assert.match(src, /const hint=!project\?'Choose a project\.':needsAck&&!ack\?'Tick the line above to save\.':null;/);
  assert.equal((src.match(/Tick the line above to save\./g)||[]).length, 1);
  assert.equal((src.match(/role="alert"/g)||[]).length, 1);
  assert.match(src, /ref=\{ackRow\} className="[^"]*\bscroll-mb-28\b/);
  // R5-1: the error takes its own full-width line above Cancel/Save, and re-reveals the row.
  assert.match(src, /<p role="alert" className="basis-full text-body text-flag">/);
  assert.match(src, /if\(error&&needsAck&&!ack\)ackRow\.current\?\.scrollIntoView\(\{block:'nearest'\}\)/);
  assert.match(src, /scrollIntoView\(\{block:'nearest'\}\)/);
  assert.match(src, /className="min-h-11 rounded-md border border-rule bg-paper px-3"[\s\S]{0,80}>Keep \{o\.label\} ticked</);
});
