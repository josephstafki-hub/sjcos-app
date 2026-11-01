import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
const url=new URL('../components/inbox/InboxPanels.tsx',import.meta.url).href;
let states=[],cursor=0,pending=[],creates=[],summaries=0,contacts=[];
globalThis.__panels={
 useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}];},
 effects:[],
 useRef(){return {current:null}},useEffect(fn){globalThis.__panels.effects.push(fn)},useTransition(){return [false,fn=>pending.push(Promise.resolve(fn()))]},
 create:async fd=>{creates.push(fd);return {ok:true,id:'work-1'}},
 summarize:async()=>{summaries++;return {ok:true,summary:{headline:'Review plans',bullets:[],model:'test',at:1000}}},
 contact:async kind=>{contacts.push(kind);return {slug:'contact'}}
};
const stubs={
 react:`const h=globalThis.__panels;export const useState=h.useState,useRef=h.useRef,useEffect=h.useEffect,useTransition=h.useTransition;`,
 '@/components/ui':`export const Button=()=>null,Chip=()=>null,Segmented=()=>null,Avatar=()=>null;`,
 '@/lib/actions/inbox-screening':`export const searchInboxDirectoryAction=async()=>{if(globalThis.__panels.directoryError)throw Error('offline');return globalThis.__panels.directory??[];};`,
 '@/lib/actions/engine':`export const createWorkItem=globalThis.__panels.create;export const setWorkItemStatus=async(...args)=>{globalThis.__panels.completed??=[];globalThis.__panels.completed.push(args);return {ok:!globalThis.__panels.completeFails,error:'Could not complete'};};`,
 '@/lib/actions/leads':`export const createLeadFromInbox=async()=>globalThis.__panels.contact('lead');`,
 '@/lib/actions/subs':`export const createSubFromInbox=async()=>globalThis.__panels.contact('sub');`,
 '@/lib/actions/vendors':`export const createVendorFromInbox=async()=>globalThis.__panels.contact('vendor');`,
 '@/lib/actions/inbox-experience':`export const inboxPeopleAction=async()=>[],inboxContextAction=async()=>({todos:[]}),summarizeInboxAction=globalThis.__panels.summarize;`,
 '@/lib/run-action':`export const runAction=async f=>f();`,
};
registerHooks({resolve(s,c,n){if(s in stubs&&(s!=='react'||c.parentURL===url))return {url:'stub:'+s,shortCircuit:true};if(s==='@/lib/inbox-review')return n(new URL('../lib/inbox-review.ts',import.meta.url).href,c);if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c);if(s==='@/lib/inbox-experience')return n(new URL('../lib/inbox-experience.ts',import.meta.url).href,c);return n(s,c)},load(u,c,n){if(u===url)return {format:'module',source:ts.transpileModule(readFileSync(new URL(url),'utf8')+'\nexport {DuplicateNotice};',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c)}});
const {MessageTaskDialog,ThreadSummary,ContactCreateDialog,DuplicateNotice,SenderScreening,MiniCalendar,InboxDialog,ContextPanel}=await import(url);
const thread={id:'thread-1',channel:'email',subject:'Review tile',fromName:'Tom',fromEmail:'tom@example.test',preview:'Please review the tile'};
const reader={messages:[{id:'message-1',fromName:'Tom',fromEmail:'tom@example.test',body:['Please review the tile'],date:1000}]};
let tree;
function nodes(n){return !n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)]}
function find(predicate){return nodes(tree).find(predicate)}
function mount(component,props){globalThis.__panels.effects=[];states=[];cursor=0;tree=component(props);return ()=>{cursor=0;tree=component(props)}}
async function settle(){await Promise.all(pending);pending=[];}
test('reminder presets select without saving, then one confirmation captures source, chosen day and job',async()=>{
 creates=[];const render=mount(MessageTaskDialog,{thread,reader,remind:true,onClose(){},onCreated(){},options:{projects:[{slug:'kitchen',name:'Kitchen'}],leads:[]}});
 find(n=>n.props?.['data-preset']==='monday').props.onClick();render();assert.equal(creates.length,0);
 find(n=>n.props?.role==='combobox').props.onFocus();render();find(n=>n.props?.role==='option'&&n.props.id==='inbox-job-0').props.onClick();render();
 find(n=>typeof n.props?.children==='string'&&n.props.children.startsWith('Remind me Monday')).props.onClick();await settle();assert.equal(creates.length,1);
 assert.equal(creates[0].get('job'),'project:kitchen');assert.deepEqual(JSON.parse(creates[0].get('email')).message_id,'message-1');assert.ok(creates[0].get('due_at'));
 assert.ok(find(n=>n.type==='blockquote').props.children.includes('Please review'));
});
test('summary is above history at caller and stays on demand for two messages or a substantive single message',async()=>{
 summaries=0;mount(ThreadSummary,{reader});assert.equal(tree,null);
 const render=mount(ThreadSummary,{reader:{...reader,messages:[...reader.messages,...reader.messages]}});assert.notEqual(tree,null);assert.equal(summaries,0);
 find(n=>n.props?.children==='Summarize').props.onClick();await settle();render();assert.equal(summaries,1);
 mount(ThreadSummary,{reader:{messages:[{...reader.messages[0],body:['word '.repeat(121)]}]}});assert.notEqual(tree,null);assert.equal(summaries,1);
});
test('screening contact dialog reuses the appropriate existing create action once',async()=>{
 for(const kind of ['lead','sub','vendor']){
  let created;const render=mount(ContactCreateDialog,{thread,kind,onClose(){},onCreated:slug=>created=slug});
  assert.equal(find(n=>n.props?.type==='submit').props.disabled,true);
  globalThis.__panels.effects.splice(0).forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,200));render();
  const before=contacts.length;assert.equal(created,undefined);
  find(n=>n.type==='form').props.action(new FormData());await settle();assert.equal(contacts.length,before+1);assert.equal(contacts.at(-1),kind);assert.equal(created,'contact');
 }
});

test('duplicate notice names the matched role and offers Link instead before creating',()=>{
 let linked=0;mount(DuplicateNotice,{directory:{entries:[{name:'Tom',role:'Sub',match:'email'}],loading:false,error:''},onLink:()=>linked++});
 const parts=nodes(tree).flatMap(n=>[n.props?.children].flat(Infinity)).filter(x=>typeof x==='string').join('');
 assert.match(parts,/Possible duplicate: Tom \(Sub\)/);find(n=>n.props?.children==='Link instead').props.onClick();assert.equal(linked,1);
});
test('failed duplicate check blocks creation rather than suggesting a new record',async()=>{
 globalThis.__panels.directoryError=true;
 const render=mount(ContactCreateDialog,{thread,kind:'lead',onClose(){},onCreated(){}});
 globalThis.__panels.effects.splice(0).forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,200));render();
 assert.equal(find(n=>n.props?.type==='submit').props.disabled,true);const before=contacts.length;
 find(n=>n.type==='form').props.action(new FormData());await settle();assert.equal(contacts.length,before);
 globalThis.__panels.directoryError=false;
});

test('screener gives evidence and one recommended remembered filing action for a pitch',()=>{
 let filed=0;mount(SenderScreening,{thread:{...thread,newSender:true,screeningFacts:{knownContact:false,hasUnsubscribe:true,looksPitch:true}},onLink(){},onAdd(){},onOther:()=>filed++});
 const text=nodes(tree).flatMap(n=>[n.props?.children].flat(Infinity)).filter(x=>typeof x==='string').join(' ');
 assert.match(text,/No saved contact.*unsubscribe link.*Looks like a pitch/);
 const action=find(n=>n.props?.variant==='primary');assert.equal(action.props.children,'Always file to Other');action.props.onClick();assert.equal(filed,1);
 assert.equal(nodes(tree).filter(n=>n.props?.variant==='primary').length,1);
});


test('task controls use presets, an inline calendar and chips instead of browser date/select fields',()=>{
 const render=mount(MessageTaskDialog,{thread,reader,remind:false,onClose(){},onCreated(){},options:{projects:[],leads:[]}});
 assert.equal(find(n=>n.type==='select'||n.props?.type==='date'),undefined);
 assert.ok(find(n=>n.props?.['data-preset']==='today'));
 find(n=>n.props?.children==='Pick a date…').props.onClick();render();
 assert.ok(find(n=>typeof n.type==='function'&&n.type.name==='MiniCalendar'));
 assert.equal(find(n=>n.props?.children==='Create to-do').props.disabled,true);
 assert.ok(find(n=>n.props?.role==='combobox'));
 assert.ok(find(n=>n.props?.children==='Joe'));
});


test('inline calendar changes months and selects an ISO day without a native date input',()=>{
 let chosen='';const render=mount(MiniCalendar,{value:'2027-01-01',onChange:day=>chosen=day});
 find(n=>n.props?.['aria-label']==='Next month').props.onClick();render();
 const day=find(n=>n.props?.['aria-label']==='2027-02-03');assert.ok(day);day.props.onClick();assert.equal(chosen,'2027-02-03');
 assert.equal(find(n=>n.type==='input'),undefined);
});

test('Block and spam are same-height explicit screener controls',()=>{
 let blocked=0,spam=0;mount(SenderScreening,{thread,onLink(){},onAdd(){},onOther(){},onBlock:()=>blocked++,onSpam:()=>spam++});
 for(const label of ['Block','Report spam']){const button=find(n=>n.props?.children===label);assert.ok(button.props.className.includes('min-h-9'));button.props.onClick();}
 assert.equal(blocked,1);assert.equal(spam,1);
});
test('desktop task popover anchors without a modal backdrop, phone remains a bottom sheet',()=>{
 const anchor={getBoundingClientRect:()=>({left:180,top:100,bottom:140}),contains:()=>false};
 const props={anchor,title:'Remind me',bottom:true,onClose(){},children:'Presets'};
 globalThis.window={innerHeight:1000,innerWidth:1600,matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){}};
 globalThis.document={activeElement:null,addEventListener(){},removeEventListener(){}};
 let cleanup=[];
 try{
  let render=mount(InboxDialog,props);cleanup=__panels.effects.splice(0).map(fn=>fn());render();
  assert.equal(tree.props.onClick,undefined);assert.equal(find(n=>n.props?.role==='dialog').props['aria-modal'],undefined);
  assert.equal(find(n=>n.props?.role==='dialog').props.style.left,180);assert.equal(find(n=>n.props?.role==='dialog').props.style.top,148);
  cleanup.forEach(f=>f?.());window.matchMedia=()=>({matches:true});render=mount(InboxDialog,props);cleanup=__panels.effects.splice(0).map(fn=>fn());render();
  assert.match(tree.props.className,/items-end/);assert.equal(find(n=>n.props?.role==='dialog').props['aria-modal'],true);
 }finally{cleanup.forEach(f=>f?.());delete globalThis.window;delete globalThis.document;}
});

test('unseen make-to-do title and assignee are visible before dates, reminder previews the proposed task',()=>{
 const unfamiliar={...thread,subject:'Dock gate',actionTitle:'Confirm gate latch finish',fromName:'Avery'};
 mount(MessageTaskDialog,{thread:unfamiliar,reader,remind:false,onClose(){},onCreated(){},options:{projects:[],leads:[]}});
 const title=find(n=>n.type==='input'&&n.props.value==='Confirm gate latch finish');assert.ok(title);
 const all=nodes(tree);assert.ok(all.indexOf(title)<all.findIndex(n=>n.props?.['data-preset']==='today'));
 const details=all.filter(n=>n.type==='details');assert.equal(details.some(n=>nodes(n).includes(title)),false);
 assert.ok(all.find(n=>n.props?.children==='Joe'));
 mount(MessageTaskDialog,{thread:unfamiliar,reader,remind:true,onClose(){},onCreated(){},options:{projects:[],leads:[]}});
 assert.equal(find(n=>n.props?.title==='To-do: Confirm gate latch finish · Joe').props.className,'truncate text-body text-ink-2');
 assert.ok(find(n=>n.props?.['data-preset']==='tomorrow').props.children.match(/Tomorrow · \w{3} \w{3} \d+ · 8:00 AM/));
});

test('unseen context shows dated inline note, actionable due task and cross-channel last contact',async()=>{
 const task={id:'gate-task',title:'Confirm gate latch finish',due_at:'2020-01-02T14:00:00Z',assignees:'Avery'};
 const data={person:{name:'Avery Chen',role:'client',email:'avery@example.test'},job:{kind:'project',name:'Chen · Terrace',slug:'terrace',stage:'Construction',latestNote:'Posts checked on site',latestNoteAt:'2026-10-21',latestNoteSource:'Daily log',latestNoteHref:'/projects/terrace?tab=Daily%20log'},todos:[task],schedule:null};
 let completed;const render=mount(ContextPanel,{thread:{...thread,id:'gate-mail',fromEmail:'avery@example.test'},threads:[{...thread,id:'gate-sms',fromEmail:'avery@example.test',channel:'sms',subject:'Gate inspection',unread:true,view:'needs_reply',receivedAt:Date.parse('2026-10-22T18:00:00Z')}],initialData:data,onTaskDone:id=>completed=id,onClose(){},onSelect(){},onLink(){}});
 assert.ok(find(n=>n.props?.children==='Posts checked on site'));assert.ok(find(n=>n.props?.children==='Open source'));
 assert.ok(find(n=>n.props?.['aria-label']==='Assigned to Avery'));assert.ok(find(n=>n.props?.className?.includes('text-warn')&&[n.props.children].flat().includes('Overdue · ')));
 assert.ok(find(n=>n.props?.['aria-label']==='Unread'));assert.ok(find(n=>n.props?.['aria-label']==='sms'));
 globalThis.__panels.completeFails=true;find(n=>n.props?.['aria-label']==='Complete: Confirm gate latch finish').props.onChange();await settle();render();assert.equal(completed,undefined);assert.ok(find(n=>[n.props?.children].flat().includes('Could not complete')));
 globalThis.__panels.completeFails=false;find(n=>n.props?.['aria-label']==='Complete: Confirm gate latch finish').props.onChange();await settle();render();assert.equal(completed,'gate-task');assert.equal(find(n=>n.props?.['aria-label']==='Complete: Confirm gate latch finish'),undefined);
 assert.deepEqual(__panels.completed.at(-1),['gate-task','done']);
 mount(ContextPanel,{thread:{...thread,automated:true,fromName:'Tool Library',subject:'Reservation ready'},threads:[],initialData:{person:null,job:null,todos:[],schedule:null},onClose(){},onSelect(){},onLink(){}});
 assert.ok(find(n=>n.props?.children==='Automated sender'));assert.equal(find(n=>n.props?.children==='New contact?'),undefined);assert.equal(find(n=>n.props?.children==='No linked job or lead.'),undefined);
});
