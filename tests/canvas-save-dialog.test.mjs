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
 if(s==='@/lib/actions/ai-chat')return {url:'save-action:jobs',shortCircuit:true};
 if(s.startsWith('@/')||s.startsWith('.')){const u=s.startsWith('@/')?new URL(s.slice(2),root):new URL(s,c.parentURL);for(const ext of ['','.ts','.tsx'])if(existsSync(new URL(u.href+ext))&&statSync(new URL(u.href+ext)).isFile())return {url:u.href+ext,shortCircuit:true};}
 return n(s,c);
},load(u,c,n){
 if(u==='save-react:hooks')return {format:'module',shortCircuit:true,source:`import * as R from 'react';export * from 'react';${['useState','useEffect','useRef','useLayoutEffect'].map(k=>`export const ${k}=(...a)=>(globalThis.__saveHooks?.${k}??R.${k})(...a);`).join('')}`};
 if(u==='save-action:jobs')return {format:'module',shortCircuit:true,source:`export const searchJobsAction=(q)=>globalThis.__searchCanvasProjects(q);`};
 if(/\.(ts|tsx)$/.test(u))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
 return n(u,c);
}});
const {CanvasSaveDialog,CanvasAudienceChips}=await import('../components/panel/CanvasSaveDialog.tsx');
const {JobPicker}=await import('../components/panel/JobPicker.tsx');
function mounted(Component,props){
 const slots=[],pending=[];let i=0,tree;
 const state=init=>{const index=i++;if(!(index in slots))slots[index]=typeof init==='function'?init():init;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];};
 const effect=(fn,deps)=>{const [slot]=state(()=>({}));if(!slot.deps||deps.some((d,k)=>!Object.is(d,slot.deps[k]))){pending.push(()=>{slot.cleanup?.();slot.cleanup=fn();slot.deps=deps;});}};
 const hooks={useState:state,useRef:init=>state(()=>({current:init}))[0],useEffect:effect,useLayoutEffect:effect};
 return {render(){i=0;globalThis.__saveHooks=hooks;try{tree=Component(props);return tree;}finally{delete globalThis.__saveHooks;}},effects(){while(pending.length)pending.shift()();},close(){for(const slot of slots)slot?.cleanup?.();},get tree(){return tree;}};
}
function elements(tree,predicate){if(!tree||typeof tree!=='object')return [];const children=React.Children.toArray(tree.props?.children);return [...(predicate(tree)?[tree]:[]),...children.flatMap(c=>elements(c,predicate))];}
const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):React.Children.toArray(tree?.props?.children).map(text).join('');
const find=(tree,label)=>elements(tree,e=>e.type==='button'&&text(e)===label)[0];
const settle=()=>new Promise(r=>setImmediate(r));
const saveData={canvas:{id:'c',project_slug:null},selected:{title:'Permit steps',version:2}};
const policy={owner:true,baseline_areas:options.map(o=>o.key),baseline_source:'unknown_context',policy_revision:'rev',area_options:options,project:{slug:'larson',name:'Larson bath'}};
test('unbound dialog → actual inline project picker → owner policy → acknowledgement → Save; prebound project can change',async()=>{
 const originalFetch=globalThis.fetch;const calls=[];let closed=0;
 globalThis.__searchCanvasProjects=async()=>[{kind:'project',slug:'larson',name:'Larson bath',current:true}];
 globalThis.fetch=async(url,init={})=>{calls.push([url,init]);return {ok:true,json:async()=>url.endsWith('/acknowledgement')?{token:'ack',expires_at:Date.now()+60000}:url.endsWith('/save')?{ok:true}:policy};};
 const dialog=mounted(CanvasSaveDialog,{data:saveData,onClose(){closed++;}});let picker;
 try{
  let tree=dialog.render();dialog.effects();assert.ok(find(tree,'Pick a project ▾'));assert.ok(text(tree).includes('Choose a project.'));assert.equal(find(tree,'Save').props.disabled,true);assert.match(find(tree,'Save').props.className,/disabled:opacity-50/);
  let pickElement=elements(tree,e=>e.type===JobPicker)[0];assert.equal(pickElement.props.inline,true);
  picker=mounted(JobPicker,pickElement.props);let pickTree=picker.render();picker.effects();await new Promise(r=>setTimeout(r,25));pickTree=picker.render();
  assert.doesNotMatch(pickTree.props.className,/absolute|top-full/);
  assert.match(elements(pickTree,e=>e.type==='input')[0].props.className,/text-\[16px\]/);
  const projectRow=find(pickTree,'Larson bath');assert.match(projectRow.props.className,/min-h-12/);projectRow.props.onClick();await settle();
  tree=dialog.render();dialog.effects();await settle();tree=dialog.render();
  assert.ok(calls.some(([url])=>url.endsWith('/save-policy?project=larson')));assert.ok(find(tree,'Larson bath ▾'));
  const radios=elements(tree,e=>e.type==='input'&&e.props.type==='radio');assert.equal(radios[0].props.checked,true);
  assert.equal(elements(tree,e=>e.type==='input'&&e.props.type==='checkbox'&&e.props.checked).length,21);
  assert.ok(text(tree).includes('Claude may have used anything in this chat, so every area is ticked.'));
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
