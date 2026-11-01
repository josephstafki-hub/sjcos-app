import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,n){return s==='./inbox-experience'?n('../lib/inbox-experience.ts',c):n(s,c)}});
const { createDraftSync } = await import('../lib/inbox-draft-sync.ts');
const { draftKey } = await import('../lib/inbox-experience.ts');
const text=body=>({body,toEmail:'client@example.test',cc:[],subject:'Plans'});
const row=(body,version=1,patch={})=>({...text(body),id:'draft',source:'human',threadKey:'thread',channel:'email',version,status:'ready',...patch});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
function fixture(patch={}) {
 const memory=new Map();let now=0;let jobs=new Map();let jobId=0;let current=null;let offline=false;const saves=[];
 const options={mailbox:'joe@example.test',userId:'joe',threadKey:'thread',channel:'email',initial:text(''),
 storage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
 schedule:(fn,ms)=>{const id=++jobId;jobs.set(id,{at:now+ms,fn});return id},cancel:id=>jobs.delete(id),
 load:async()=>{if(offline)throw Error('offline');return current?[current]:[]},
 save:async input=>{saves.push(input);if(offline)throw Error('offline');if(input.baseVersion!==(current?.version??0))return {conflict:true,current};current=row(input.body,(current?.version??0)+1);return {conflict:false,current}},...patch};
 return {options,memory,saves,get current(){return current},set current(v){current=v},set offline(v){offline=v},
 async tick(ms){now+=ms;for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn()}await new Promise(r=>setImmediate(r))},
 get jobs(){return jobs.size},create(){return createDraftSync(options)}};
}
test('800ms debounce saves the newest edit once; clean polls sync other devices',async()=>{
 const f=fixture();const sync=f.create();await sync.refresh();sync.setDraft(text('A'));await f.tick(700);assert.equal(f.saves.length,0);
 sync.setDraft(text('AB'));await f.tick(799);assert.equal(f.saves.length,0);await f.tick(1);assert.equal(f.saves.length,1);assert.equal(f.saves[0].body,'AB');assert.equal(sync.getSnapshot().status,'saved');
 f.current=row('Other device',2);await sync.refresh();assert.equal(sync.getSnapshot().draft.body,'Other device');sync.dispose();
});
test('offline fallback survives remount and retries without losing the original base version',async()=>{
 const f=fixture();let sync=f.create();await sync.refresh();sync.setDraft(text('Offline text'));f.offline=true;await f.tick(800);
 assert.equal(sync.getSnapshot().status,'local only');assert.equal(f.jobs,0);sync.dispose();
 sync=f.create();assert.equal(sync.getSnapshot().draft.body,'Offline text');await sync.refresh();assert.equal(sync.getSnapshot().status,'local only');
 f.offline=false;await sync.refresh();await f.tick(800);assert.equal(sync.getSnapshot().status,'saved');assert.equal(f.saves.at(-1).baseVersion,0);sync.dispose();
});
test('conflict preserves both texts, keepMine retries against current version, server choice discards local edits',async()=>{
 const f=fixture();f.current=row('Original');const sync=f.create();await sync.refresh();sync.setDraft(text('Mine'));f.current=row('Theirs',2);await f.tick(800);
 assert.equal(sync.getSnapshot().status,'conflict');assert.equal(sync.getSnapshot().draft.body,'Mine');assert.equal(sync.getSnapshot().conflict.current.body,'Theirs');
 sync.keepMine();await f.tick(800);assert.equal(f.saves.at(-1).baseVersion,2);assert.equal(sync.getSnapshot().status,'saved');
 sync.setDraft(text('Mine again'));f.current=row('Newest',4);await sync.refresh();assert.equal(sync.getSnapshot().status,'conflict');
 sync.resolve('server');assert.equal(sync.getSnapshot().draft.body,'Newest');assert.equal(sync.getSnapshot().version,4);assert.equal(f.jobs,0);sync.dispose();
});
test('AI suggestions never replace human text without acceptance',async()=>{
 const suggestion=row('AI text',1,{source:'ai',sourceMessageId:'m1'});const f=fixture({load:async()=>[row('Human'),suggestion]});const sync=f.create();await sync.refresh();
 assert.equal(sync.getSnapshot().draft.body,'Human');assert.equal(sync.getSnapshot().suggestion.body,'AI text');
 sync.acceptSuggestion();assert.equal(sync.getSnapshot().draft.body,'AI text');assert.equal(sync.getSnapshot().status,'saving');sync.dispose();
});
test('typing during a save is not acknowledged by the old request; saves serialize',async()=>{
 const wait=deferred();const calls=[];const f=fixture({save:async input=>{calls.push(input);if(calls.length===1)return wait.promise;return {conflict:false,current:row(input.body,2)}}});
 const sync=f.create();await sync.refresh();sync.setDraft(text('First'));await f.tick(800);sync.setDraft(text('Newer'));
 assert.equal(calls.length,1);wait.resolve({conflict:false,current:row('First',1)});await new Promise(r=>setImmediate(r));
 assert.equal(sync.getSnapshot().draft.body,'Newer');assert.equal(sync.getSnapshot().status,'saving');await f.tick(800);assert.equal(calls[1].baseVersion,1);assert.equal(calls[1].body,'Newer');assert.equal(sync.getSnapshot().status,'saved');sync.dispose();
});
test('a late load cannot undo an acknowledged save',async()=>{
 const wait=deferred();let loads=0;const f=fixture({load:async()=>++loads===1?[]:wait.promise});const sync=f.create();await sync.refresh();
 sync.setDraft(text('Mine'));const loading=sync.refresh();await f.tick(800);assert.equal(sync.getSnapshot().version,1);
 wait.resolve([]);await loading;assert.equal(sync.getSnapshot().draft.body,'Mine');assert.equal(sync.getSnapshot().version,1);sync.dispose();
});
test('sent tombstone clears saved copies and conflicts with offline edits',async()=>{
 const f=fixture();f.current=row('Saved');const sync=f.create();await sync.refresh();f.current=row('',2,{status:'sent'});await sync.refresh();
 assert.equal(sync.getSnapshot().draft.body,'');assert.equal(sync.getSnapshot().version,2);
 sync.setDraft(text('Offline new edit'));f.current=row('',3,{status:'discarded'});await sync.refresh();assert.equal(sync.getSnapshot().status,'conflict');assert.equal(sync.getSnapshot().draft.body,'Offline new edit');
 sync.resolve('server');assert.equal(sync.getSnapshot().draft.body,'');sync.dispose();
});
test('legacy owner fallback is adopted, staff local keys are isolated, unavailable storage does not break sync',async()=>{
 const f=fixture({importLegacy:true});f.memory.set(draftKey('joe@example.test','thread'),JSON.stringify({...text('Legacy'),model:'',ai:false}));
 const owner=f.create();assert.equal(owner.getSnapshot().draft.body,'Legacy');await owner.refresh();await f.tick(800);owner.dispose();
 const staff=createDraftSync({...f.options,userId:'staff',importLegacy:false});assert.equal(staff.getSnapshot().draft.body,'');staff.dispose();
 const broken=fixture({storage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}}});const sync=broken.create();await sync.refresh();sync.setDraft(text('Server saved'));await broken.tick(800);assert.equal(sync.getSnapshot().status,'saved');sync.dispose();
});
test('dispose cancels debounce, flush waits for an in-flight save, and stale completion cannot update unmounted UI',async()=>{
 const wait=deferred();let published=0;const f=fixture({save:()=>wait.promise,onChange:()=>published++});const sync=f.create();await sync.refresh();sync.setDraft(text('Text'));
 await f.tick(800);let completed=false;const flush=sync.flush().then(()=>{completed=true});await Promise.resolve();assert.equal(completed,false);
 sync.dispose();const count=published;wait.resolve({conflict:false,current:row('Text')});await flush;assert.equal(published,count);assert.equal(f.jobs,0);
 const f2=fixture();const s2=f2.create();await s2.refresh();s2.setDraft(text('Do not save'));s2.dispose();await f2.tick(800);assert.equal(f2.saves.length,0);
});

test('suggestions are keyed to the latest inbound message, never an earlier unanswered message',async()=>{
 const f=fixture({latestMessageId:'new',load:async()=>[row('Old AI',1,{source:'ai',sourceMessageId:'old'}),row('Current AI',1,{source:'ai',sourceMessageId:'new'})]});
 const sync=f.create();await sync.refresh();assert.equal(sync.getSnapshot().suggestion.body,'Current AI');assert.equal(sync.getSnapshot().draft.body,'');sync.dispose();
});
test('checked flips only after the server has answered, so an early list suggestion can show until then',async()=>{
 const f=fixture();const sync=f.create();
 assert.equal(sync.getSnapshot().checked,false,'not yet asked');
 await sync.refresh();assert.equal(sync.getSnapshot().checked,true);sync.dispose();
 const g=fixture();g.offline=true;const s2=g.create();await s2.refresh();
 assert.equal(s2.getSnapshot().checked,false,'a failed load does not count as checked');s2.dispose();
});

test('unseen accepted draft carries author, basis and exact suggestion identity across devices and conflict resolution',async()=>{
 const provenance={model:'claude',basedOn:'The terrace request and gate specification',acceptedSuggestionId:'11111111-1111-4111-8111-111111111111',humanEdited:true};
 const written=[];const f=fixture({save:async input=>{written.push(input);return {conflict:false,current:row(input.body,input.baseVersion+1,{...input,version:input.baseVersion+1})}}});
 const first=f.create();await first.refresh();first.setDraft({...text('Two gate finishes for review'),provenance});await first.flush();
 assert.deepEqual(written.at(-1)?.provenance,provenance);
 first.dispose();
 const remote=row('Two gate finishes for review',3,{model:'claude',basedOn:provenance.basedOn,acceptedSuggestionId:provenance.acceptedSuggestionId,humanEdited:true});
 const other=fixture({load:async()=>[remote]});const second=other.create();await second.refresh();
 assert.deepEqual(second.getSnapshot().draft.provenance,provenance);second.dispose();
});

test('existing device metadata upgrades into the synced package instead of losing the reviewed author',async()=>{
 const f=fixture();let sync=f.create();await sync.refresh();sync.setDraft(text('Existing gate answer'));await sync.flush();sync.dispose();
 f.memory.set(JSON.stringify(['sjc:inbox:draft-meta','joe@example.test','joe','thread','email']),JSON.stringify({ai:true,model:'Claude',basedOn:'Earlier gate request',humanEdited:true}));
 sync=f.create();assert.equal(sync.getSnapshot().draft.provenance.model,'claude');await sync.refresh();await sync.flush();
 assert.equal(f.saves.at(-1).provenance.basedOn,'Earlier gate request');sync.dispose();
});

test('navigation flush waits for pending text, and an identical concurrent save is safe to acknowledge',async()=>{
 const f=fixture();const sync=f.create();await sync.refresh();sync.setDraft(text('New railing answer'));
 assert.equal(await sync.flushForNavigation(),true);assert.equal(f.saves.at(-1).body,'New railing answer');
 sync.setDraft(text('Same words on both devices'));f.current=row('Same words on both devices',2);
 assert.equal(await sync.flushForNavigation(),true);assert.equal(sync.getSnapshot().status,'saved');sync.dispose();
});
