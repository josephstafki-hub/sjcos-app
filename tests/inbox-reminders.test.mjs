import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let prior,created,calls=[],allowed=true;
globalThis.__reminder={query:async(sql,p)=>{calls.push([sql,p]);return {rows:sql.startsWith('SELECT')?(prior?[prior]:[]):[{id:'task-88'}]};},create:async form=>{calls.push(['create',form]);return created;},access:()=>{if(!allowed)throw Error('Forbidden');}};
const stubs={
 '@/lib/dal':'export const requireAccess=async()=>globalThis.__reminder.access();',
 '@/lib/db':'export const query=(sql,p)=>globalThis.__reminder.query(sql,p);',
 '@/lib/actions/engine':'export const createWorkItem=form=>globalThis.__reminder.create(form);',
 'next/cache':'export const revalidatePath=()=>{};',
};
registerHooks({resolve(s,c,n){return s in stubs?{url:'reminder:'+s,shortCircuit:true}:n(s,c)},load(u,c,n){return u.startsWith('reminder:')?{format:'module',source:stubs[u.slice(9)],shortCircuit:true}:n(u,c)}});
const {quickInboxReminder,undoInboxReminder}=await import('../lib/actions/inbox-reminders.ts');
const form=()=>{const f=new FormData();f.set('title','Choose a gate finish');f.set('due_at','2026-11-02T14:00:00Z');f.set('email',JSON.stringify({message_id:'gate-84',thread_id:'thread-73'}));return f;};
test('quick reminder reuses message identity and returns a cancel receipt only for a new task',async()=>{
 calls=[];prior=null;created={ok:true,id:'task-88'};
 const f=form(),r=await quickInboxReminder(f);assert.equal(f.get('reminder'),'true');
 assert.deepEqual(calls[0][1],['gate-84']);assert.equal(r.undo.previous,null);
 await undoInboxReminder(r.undo);assert.match(calls.at(-1)[0],/status='cancelled'/);assert.match(calls.at(-1)[0],/due_at=\$2/);
});
test('rescheduling an existing task restores its former due/snooze instead of cancelling it',async()=>{
 calls=[];prior={id:'task-88',due_at:'2026-11-04T14:00:00Z',snoozed_until:'2026-11-04T06:00:00Z'};created={ok:true,id:'task-88',existing:true};
 const r=await quickInboxReminder(form());assert.deepEqual(r.undo.previous,{due_at:prior.due_at,snoozed_until:prior.snoozed_until});
 await undoInboxReminder(r.undo);assert.doesNotMatch(calls.at(-1)[0],/SET status='cancelled'/);assert.deepEqual(calls.at(-1)[1].slice(2),[prior.due_at,prior.snoozed_until]);
});
test('unknown concurrent prior schedule gets no destructive undo; permissions hold',async()=>{
 prior=null;created={ok:true,id:'task-88',existing:true};assert.equal((await quickInboxReminder(form())).undo,null);
 calls=[];allowed=false;await assert.rejects(()=>quickInboxReminder(form()),/Forbidden/);await assert.rejects(()=>undoInboxReminder({id:'task-88',dueAt:'2026-11-02T14:00:00Z',previous:null}),/Forbidden/);assert.equal(calls.length,0);allowed=true;
});
