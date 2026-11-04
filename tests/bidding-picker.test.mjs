import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const url=new URL('../components/projects/BiddingBoard.tsx',import.meta.url).href;
const source=readFileSync(new URL(url),'utf8');
let index=0;
const states=['',{kind:'subs',pkgId:1},new Map(),new Map(),null];
const tasks=[];
globalThis.__bidSaveResult={ok:true};
globalThis.__bidPicker={
 useState: initial=>{const i=index++;if(states[i]===undefined)states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},
 useTransition:()=>[false,fn=>tasks.push(fn())],
};
const noop='()=>null';
const exportsFor=(specifier)=>{
 const hit=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/gs)].find(m=>m[2]===specifier);
 return (hit?.[1].split(',').map(x=>x.trim()).filter(x=>x&&!x.startsWith('type '))??[]).map(n=>`export const ${n}=${noop};`).join('\n');
};
registerHooks({resolve(s,c,next){if(c.parentURL===url||s==='react/jsx-runtime')return {url:'bidstub:'+s,shortCircuit:true};return next(s,c)},load(u,c,next){
 if(u===url)return {format:'module',source:ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
 if(!u.startsWith('bidstub:'))return next(u,c);
 const s=u.slice(8);
 const code=s==='react'?'export const {useState,useTransition}=globalThis.__bidPicker;':s==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment=Symbol();':s==='next/navigation'?'export const useRouter=()=>({refresh(){}});':s==='@/lib/use-removed'?'export const useRemoved=()=>({removed:new Set(),hide(){},restore(){}});':s==='@/lib/run-action'?'export const runAction=async f=>f();':exportsFor(s);
 return {format:'module',source:code.replace('export const addBidInvites=()=>null','export const addBidInvites=async()=>globalThis.__bidSaveResult'),shortCircuit:true};
}});
const {BiddingBoard}=await import(url);
function find(node,name){if(!node||typeof node!=='object')return null;if(node.type?.name===name)return node;for(const child of [node.props?.children].flat(Infinity)){const r=find(child,name);if(r)return r;}return null;}
test('adding a recipient closes the picker and keeps the optimistic recipient visible',async()=>{
 index=0;
 const tree=BiddingBoard({slug:'zz-qa',view:{packages:[{id:1,trade:'Framing',invites:[],files:[]}],trades:[]},roster:[],projectFiles:[]});
 const picker=find(tree,'RecipientsModal');assert.ok(picker);
 picker.props.onAdd([{slug:'zz-sub',name:'ZZ QA Sub',trade:'Framing',email:'qa@example.com'}]);
 assert.equal(states[1],null,'picker closes immediately after submitting');
 assert.equal(states[2].get(1)[0].subName,'ZZ QA Sub');
 await Promise.all(tasks);
});

test('a failed recipient write removes its placeholder and retains the error',async()=>{
 index=0;tasks.length=0;states.splice(0,states.length,'',{kind:'subs',pkgId:1},new Map(),new Map(),null);
 globalThis.__bidSaveResult={ok:false,error:'Could not add the sub.'};
 const tree=BiddingBoard({slug:'zz-qa',view:{packages:[{id:1,trade:'Framing',invites:[],files:[]}],trades:[]},roster:[],projectFiles:[]});
 find(tree,'RecipientsModal').props.onAdd([{slug:'zz-sub',name:'ZZ QA Sub',trade:'Framing'}]);
 await Promise.all(tasks);
 assert.equal(states[1],null);assert.equal(states[2].get(1).length,0);assert.equal(states[0],'Could not add the sub.');
});
