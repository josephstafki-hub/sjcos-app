import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const url=new URL('../components/inbox/InboxClient.tsx',import.meta.url).href;
const source=readFileSync(new URL(url),'utf8');
let states=[],cursor=0,pending=[],calls=[];
globalThis.__compose={
 useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
 useTransition(){return [false,fn=>pending.push(Promise.resolve(fn()))]},
 send:async input=>{calls.push(input);return {ok:false,error:'Offline — files kept'}},
};
const stubs={
 react:`const h=globalThis.__compose;export const useState=h.useState,useTransition=h.useTransition,useEffect=()=>{},useLayoutEffect=()=>{},useMemo=f=>f(),useCallback=f=>f,useRef=()=>({current:null});`,
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
registerHooks({resolve(s,c,n){if(s in stubs&&(s!=='react'||c.parentURL===url))return {url:'stub:'+s,shortCircuit:true};if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+'.ts',import.meta.url).href,c);return n(s,c);},load(u,c,n){if(u===url)return {format:'module',source:ts.transpileModule(source+'\nexport {ComposeModal};',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
const {ComposeModal}=await import(url);
const nodes=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)];
test('forward reviews blank To/Cc, includes removable originals, and a failed send keeps queued files',async()=>{
 const forward={threadId:'t',subject:'Scope',message:{id:'m',fromName:'Alex',fromEmail:'alex@example.test',to:'builder@example.test',body:['Original scope'],attachments:[{id:'a',name:'plan.pdf',size:4,type:'application/pdf'}]}};
 let tree;const render=()=>{cursor=0;tree=ComposeModal({selfEmail:'builder@example.test',forward,onClose(){}});};const find=p=>nodes(tree).find(p);
 states=[];render();assert.equal(find(n=>n.props?.['aria-label']==='To').props.value,'');assert.equal(find(n=>n.props?.['aria-label']==='Cc').props.value,'');
 assert.ok(find(n=>n.props?.['aria-label']==='Remove plan.pdf'));
 find(n=>n.props?.['aria-label']==='To').props.onChange({target:{value:'review@example.test'}});render();
 find(n=>n.props?.type==='file').props.onChange({target:{files:[new File(['photo'],'photo.png',{type:'image/png'})],value:'photo.png'}});render();
 assert.ok(find(n=>n.props?.['aria-label']==='Remove photo.png'));
 find(n=>n.props?.children==='Send email').props.onClick();await Promise.all(pending);pending=[];render();
 assert.deepEqual(calls[0].forward.attachmentIds,['a']);assert.equal(calls[0].files.get('files').name,'photo.png');assert.ok(find(n=>n.props?.['aria-label']==='Remove photo.png'));assert.ok(find(n=>n.props?.children==='Offline — files kept'));
 find(n=>n.props?.['aria-label']==='Remove plan.pdf').props.onClick();render();
 find(n=>n.props?.children==='Send email').props.onClick();await Promise.all(pending);pending=[];assert.deepEqual(calls[1].forward.attachmentIds,[]);
});
