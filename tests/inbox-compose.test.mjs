import {draftTransport,draftActionStub,draftComponentUrls,draftResolve} from './helpers/inbox-draft-transport.mjs';
globalThis.__draftServer=draftTransport();
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const url=new URL('../components/inbox/InboxClient.tsx',import.meta.url).href;
const source=readFileSync(new URL(url),'utf8');
let states=[],cursor=0,pending=[],calls=[],effects=[],cleanups=[];
globalThis.localStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.window={localStorage,setInterval:()=>1,clearInterval(){},addEventListener(){},removeEventListener(){},dispatchEvent(){}};
globalThis.__compose={
 useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
 useRef(initial){const i=cursor++;return states[i]??(states[i]={current:initial});},
 useEffect(fn,deps){const i=cursor++;if(!states[i]||!deps||deps.some((d,j)=>d!==states[i][j])){states[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},
 useTransition(){return [false,fn=>pending.push(Promise.resolve(fn()))]},
 send:async input=>{calls.push(input);if(globalThis.__compose.wait)await globalThis.__compose.wait;return {ok:globalThis.__compose.success??false,error:'Offline — files kept'}},
};
const stubs={
 '@/lib/actions/inbox-drafts':draftActionStub,
 react:`const h=globalThis.__compose;export const useState=h.useState,useTransition=h.useTransition,useEffect=h.useEffect,useLayoutEffect=h.useEffect,useMemo=f=>f(),useCallback=f=>f,useRef=h.useRef;`,
 'next/navigation':'export const useRouter=()=>({refresh(){}});',
 '@/components/ui':'export const Button=()=>null,EmptyState=()=>null,Segmented=()=>null,Chip=()=>null,Avatar=()=>null,VoiceButton=()=>null;',
 '@/components/ui/Toast':'export const toast=()=>{},dismissToast=()=>{};',
 '@/lib/run-action':'export const runAction=async f=>f();',
 '@/lib/actions/inbox-screening':'export const setInboxPreferenceAction=async()=>({ok:true});',
 '@/lib/actions/inbox-experience':'export const undoChannelDoneAction=async()=>({ok:true}),markChannelDoneAction=async()=>({ok:true});',
 './InboxPanels':'export const ContactCreateDialog=()=>null,SenderScreening=()=>null,ContextPanel=()=>null,LinkPicker=()=>null,MessageTaskDialog=()=>null,ShortcutHelp=()=>null,ThreadSummary=()=>null;',
};
const actionNames=source.slice(source.indexOf('  draftReplyAction,'),source.indexOf('} from "@/lib/actions/inbox"')).split(',').map(s=>s.trim()).filter(Boolean);
stubs['@/lib/actions/inbox']=actionNames.map(name=>`export const ${name}=${name==='sendNewEmailAction'?'globalThis.__compose.send':'async()=>({ok:true})'};`).join('\n');
registerHooks({resolve(s,c,n){if(s in stubs&&(s!=='react'||c.parentURL===url||draftComponentUrls.includes(c.parentURL)))return {url:'stub:'+s,shortCircuit:true};const draft=draftResolve(s,c,n);if(draft)return draft;if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+'.ts',import.meta.url).href,c);return n(s,c);},load(u,c,n){if(draftComponentUrls.includes(u))return {format:'module',source:ts.transpileModule(readFileSync(new URL(u),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};if(u===url)return {format:'module',source:ts.transpileModule(source+'\nexport {ComposeModal};',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
const {ComposeModal}=await import(url);
const nodes=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)];
test('forward reviews blank To/Cc, includes removable originals, and a failed send keeps queued files',async()=>{
 const forward={threadId:'t',subject:'Scope',message:{id:'m',fromName:'Alex',fromEmail:'alex@example.test',to:'builder@example.test',body:['Original scope'],attachments:[{id:'a',name:'plan.pdf',size:4,type:'application/pdf'}]}};
 let tree;const render=()=>{cursor=0;tree=ComposeModal({selfEmail:'builder@example.test',forward,onClose(){}});};const find=p=>nodes(tree).find(p);
 states=[];render();for(let i=0;i<5;i++){const work=effects;effects=[];work.forEach(f=>f());await Promise.resolve();render();}assert.equal(find(n=>n.props?.['aria-label']==='To').props.value,'');assert.equal(find(n=>n.props?.['aria-label']==='Cc').props.value,'');
 assert.ok(find(n=>n.props?.['aria-label']==='Remove plan.pdf'));
 find(n=>n.props?.['aria-label']==='To').props.onChange({target:{value:'review@example.test'}});render();
 find(n=>n.props?.type==='file').props.onChange({target:{files:[new File(['photo'],'photo.png',{type:'image/png'})],value:'photo.png'}});render();
 assert.ok(find(n=>n.props?.['aria-label']==='Remove photo.png'));
 find(n=>n.props?.children==='Send email').props.onClick();await Promise.all(pending);pending=[];render();
 assert.deepEqual(calls[0].forward.attachmentIds,['a']);assert.equal(calls[0].files.get('files').name,'photo.png');assert.ok(find(n=>n.props?.['aria-label']==='Remove photo.png'));assert.ok(find(n=>n.props?.children==='Offline — files kept'));
 find(n=>n.props?.['aria-label']==='Remove plan.pdf').props.onClick();render();
 find(n=>n.props?.children==='Send email').props.onClick();await Promise.all(pending);pending=[];assert.deepEqual(calls[1].forward.attachmentIds,[]);
});


test('new mail syncs recipient, Cc, subject and body; cleanup runs after success, close preserves text',async()=>{
 cleanups.forEach(f=>f?.());cleanups=[];states=[];effects=[];
 let closed=0,tree;
 const render=()=>{cursor=0;tree=ComposeModal({selfEmail:'builder@example.test',userId:'builder',onClose(){closed++}});};
 const find=p=>nodes(tree).find(p);
 const settle=async()=>{for(let i=0;i<8;i++){await Promise.all(pending);pending=[];const work=effects;effects=[];work.forEach(f=>f());await Promise.resolve();render();}};
 render();await settle();
 for(const [label,value]of [['To','client@example.test'],['Cc','review@example.test'],['Subject','Site visit'],['Message','See you Monday']]){find(n=>n.props?.['aria-label']===label).props.onChange({target:{value}});render();}
 const close=find(n=>n.props?.['aria-label']==='Close new message');close.props.onClick();await settle();assert.equal(closed,1);
 assert.equal(__draftServer.calls.filter(([type])=>type==='discarded').length,0);
 globalThis.__compose.success=true;
 const count=calls.length;find(n=>n.props?.children==='Send email').props.onClick();await settle();
 assert.equal(calls.length,count+1);assert.equal(calls.at(-1).cc,'review@example.test');
 assert.equal(__draftServer.calls.findLast(([type])=>type==='sent')[1].threadKey,'compose:new');
 assert.equal(__draftServer.rows.get('compose:new:email').status,'sent');
 cleanups.forEach(f=>f?.());cleanups=[];
});

test('forward choices restore after closing, and Saved explicitly covers text rather than device files',async()=>{
 cleanups.forEach(f=>f?.());cleanups=[];states=[];effects=[];pending=[];
 const storage=new Map(),prior=globalThis.localStorage;
 globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};window.localStorage=localStorage;
 const forward={threadId:'restore-files',subject:'Plans',message:{id:'original',fromName:'Casey',fromEmail:'casey@example.test',body:['Please review'],attachments:[{id:'plan',name:'scope.pdf',size:4,type:'application/pdf'}]}};
 let tree;const render=()=>{cursor=0;tree=ComposeModal({selfEmail:'builder@example.test',forward,onClose(){}});};
 const find=p=>nodes(tree).find(p);const flush=async()=>{for(let i=0;i<6;i++){const work=effects;effects=[];work.forEach(f=>f());await Promise.resolve();render();}};
 try{
  render();await flush();find(n=>n.props?.['aria-label']==='Remove scope.pdf').props.onClick();render();await flush();
  cleanups.forEach(f=>f?.());cleanups=[];states=[];effects=[];render();await flush();
  assert.equal(find(n=>n.props?.['aria-label']==='Remove scope.pdf'),undefined);
  find(n=>n.props?.type==='file').props.onChange({target:{files:[new File(['photo'],'site.png',{type:'image/png'})],value:''}});render();await flush();
  const footer=find(n=>n.type?.name==='DraftSyncFooter');assert.equal(footer.props.localFiles,true);
  const text=nodes(footer.type({...footer.props,saved:{...footer.props.saved,synced:{...footer.props.saved.synced,status:'saved'}}})).flatMap(n=>[n.props?.children].flat()).filter(v=>typeof v==='string').join(' ');
  assert.match(text,/Text saved · files on this device/);
 }finally{cleanups.forEach(f=>f?.());cleanups=[];localStorage=prior;window.localStorage=prior;}
});

test('unseen new/forward cannot dismiss during send, and new mail begins with empty To',async()=>{
 for(const forward of [undefined,{threadId:'gate-forward',subject:'Gate options',message:{id:'gate-message',fromName:'Avery',fromEmail:'avery@example.test',body:['Two finish options']}}]){
  cleanups.forEach(f=>f?.());cleanups=[];states=[];effects=[];pending=[];globalThis.__draftServer.rows.clear();
  let tree,closed=0,release;globalThis.__compose.success=true;globalThis.__compose.wait=new Promise(resolve=>release=resolve);
  const render=()=>{cursor=0;tree=ComposeModal({selfEmail:'builder@example.test',forward,onClose(){closed++}});};const find=p=>nodes(tree).find(p);
  const settleEffects=async()=>{for(let i=0;i<8;i++){const work=effects;effects=[];work.forEach(f=>f());await Promise.resolve();render();}};
  try{
   render();await settleEffects();assert.equal(find(n=>n.props?.['aria-label']==='To').props.value,'');
   for(const [label,value] of [['To','inspector@example.test'],['Message','Please review the gate finishes']]){find(n=>n.props?.['aria-label']===label).props.onChange({target:{value}});render();}
   find(n=>n.props?.children==='Send email').props.onClick();await settleEffects();
   find(n=>n.props?.['aria-label']==='Close new message').props.onClick();tree.props.onClick();await Promise.resolve();assert.equal(closed,0);
   release();await Promise.all(pending);pending=[];render();assert.equal(closed,1);
  }finally{release();delete globalThis.__compose.wait;cleanups.forEach(f=>f?.());cleanups=[];}
 }
});
