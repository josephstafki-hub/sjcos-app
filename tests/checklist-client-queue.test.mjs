import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextTapState,enqueueSetItem,enqueueNotes,ackHead,onConflict,keepMine,takeSaved,rowView,notesView,markHeadSent,classifyError,stableJson,changesWord,normalizeSnapshot} from '../lib/checklist-coverage/client-queue.ts';
import {buildValue,fieldsFromValue,formatValue,isRefusal,emailCandidates} from '../lib/checklist-coverage/answers.ts';

const SID='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222', B='33333333-3333-4333-8333-333333333333';
function snap(rev=5,rows={[A]:'open',[B]:'open'},notes=''){
 return {session:{id:SID,lead_id:null,call_id:null,revision:rev,status:'open',started_at:'2026-11-02T16:00:00Z',ended_at:null,consent_status:'not_required',capture:'manual',manual_notes:notes,deletion_epoch:0},
  version:{id:'v',definition_id:'d',version:1,items:[]},
  rows:Object.entries(rows).map(([id,state],i)=>({identity:{session_id:SID,item_id:id,definition_version_id:'v',definition_item_id:'d'+i,instance_id:SID},coverage:{item_id:id,state,value:null,reason:null,revision:1,manual_lock:false,source:'manual',component_states:{},evidence:[],suggestion:null,conflict:null,updated_at:''},spec:{key:i?'budget':'work'},prior:null}))};
}
const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('one tap: Open→Covered, Covered→Open, Partly→Covered, N/A→Open',()=>{
 assert.equal(nextTapState('open'),'covered');assert.equal(nextTapState('covered'),'open');
 assert.equal(nextTapState('partial'),'covered');assert.equal(nextTapState('not_applicable'),'open');
});

test('queued edits get sequential expected revisions, overlay the view, and fold into the snapshot on ack',()=>{
 let s={snapshot:snap(),queue:[],conflict:null};
 s=enqueueSetItem(s,{item_id:A,state:'covered',value:null,reason:null},id(1),1);
 s=enqueueSetItem(s,{item_id:B,state:'partial',value:{amount_text:'fifty'},reason:null},id(2),2);
 assert.deepEqual(s.queue.map(q=>q.op.expected_revision),[5,6]);
 assert.equal(rowView(s.snapshot,s.queue,A).state,'covered');assert.equal(rowView(s.snapshot,s.queue,A).pending,true);
 assert.equal(s.snapshot.rows[0].coverage.state,'open','acknowledged state untouched until the server answers');
 s=markHeadSent(s);assert.equal(s.queue[0].sent,true);
 s=ackHead(s,{revision:'6'});
 assert.equal(s.snapshot.session.revision,6);assert.equal(s.snapshot.rows[0].coverage.state,'covered');assert.equal(s.snapshot.rows[0].coverage.manual_lock,true);
 assert.equal(s.queue.length,1);assert.equal(rowView(s.snapshot,s.queue,A).pending,false);
});

test('N/A keeps its reason, other states drop it',()=>{
 let s={snapshot:snap(),queue:[],conflict:null};
 s=enqueueSetItem(s,{item_id:A,state:'not_applicable',value:null,reason:'  rental  '},id(1),1);
 s=enqueueSetItem(s,{item_id:A,state:'open',value:null,reason:'stale'},id(2),1);
 assert.equal(s.queue[0].op.reason,'rental');assert.equal(s.queue[1].op.reason,null);
});

test('unsent notes coalesce under one id; sent notes are never rewritten',()=>{
 let s={snapshot:snap(),queue:[],conflict:null};
 s=enqueueNotes(s,'a',id(1),1);s=enqueueNotes(s,'ab',id(2),1);
 assert.equal(s.queue.length,1);assert.equal(s.queue[0].op.operation_id,id(1));assert.equal(s.queue[0].op.notes,'ab');
 s=markHeadSent(s);s=enqueueNotes(s,'abc',id(3),1);
 assert.equal(s.queue.length,2);assert.equal(s.queue[0].op.notes,'ab');assert.equal(s.queue[1].op.expected_revision,6);
 assert.equal(notesView(s.snapshot,s.queue).notes,'abc');
 assert.equal(enqueueNotes({snapshot:snap(5,{},'same'),queue:[],conflict:null},'same',id(4),1).queue.length,0);
});

test('409 on a row another device did not touch re-sends under a NEW id at the returned revision',()=>{
 let s={snapshot:snap(),queue:[],conflict:null};
 s=markHeadSent(enqueueSetItem(s,{item_id:A,state:'covered',value:null,reason:null},id(1),1));
 const current=snap(); current.session.revision='7'; current.rows[1].coverage.state='covered'; current.rows[1].coverage.revision='2';
 const r=onConflict(s,current,id(9));
 assert.equal(r.ask,false);assert.equal(r.state.queue[0].op.operation_id,id(9));assert.equal(r.state.queue[0].op.expected_revision,7);
 assert.equal(r.state.queue[0].sent,false);assert.equal(r.state.snapshot.rows[1].coverage.state,'covered');assert.equal(r.state.snapshot.rows[1].coverage.revision,2);
});

test('409 on the same row asks: keep mine gets a new id, use saved drops the edit; never silent',()=>{
 let s={snapshot:snap(),queue:[],conflict:null};
 s=enqueueSetItem(s,{item_id:A,state:'covered',value:null,reason:null},id(1),1);
 s=enqueueSetItem(s,{item_id:B,state:'covered',value:null,reason:null},id(2),1);
 const current=snap(8);current.rows[0].coverage.state='partial';
 const r=onConflict(s,current,id(9));
 assert.equal(r.ask,true);assert.equal(r.state.conflict.current.state,'partial');assert.equal(r.state.conflict.mine.op.operation_id,id(1));
 assert.equal(r.state.queue[0].op.operation_id,id(1),'nothing re-sent until Joe chooses');
 const mine=keepMine(r.state,id(10));
 assert.equal(mine.conflict,null);assert.equal(mine.queue[0].op.operation_id,id(10));assert.equal(mine.queue[0].op.expected_revision,8);assert.equal(mine.queue[0].op.state,'covered');
 const saved=takeSaved(r.state);
 assert.equal(saved.queue.length,1);assert.equal(saved.queue[0].op.item_id,B);assert.equal(rowView(saved.snapshot,saved.queue,A).state,'partial');
});

test('conflict on notes compares notes text',()=>{
 let s={snapshot:snap(5,{},'old'),queue:[],conflict:null};
 s=enqueueNotes(s,'mine',id(1),1);
 assert.equal(onConflict(s,snap(6,{},'old'),id(2)).ask,false);
 const r=onConflict(s,snap(6,{},'theirs'),id(2));assert.equal(r.ask,true);assert.equal(r.state.conflict.current.notes,'theirs');
});

test('value comparison ignores jsonb key order; raw BIGINT strings normalize; unsafe revisions refused',()=>{
 assert.equal(stableJson({b:1,a:{d:2,c:3}}),stableJson({a:{c:3,d:2},b:1}));
 const raw=snap();raw.session.revision='12';assert.equal(normalizeSnapshot(raw).session.revision,12);
 raw.session.revision=String(Number.MAX_SAFE_INTEGER)+'9';assert.throws(()=>normalizeSnapshot(raw));
});

test('error classes: CHECKLIST codes, network, hidden production errors',()=>{
 assert.deepEqual(classifyError(new Error('CHECKLIST_INVALID_ANSWER'),true),{kind:'code',code:'CHECKLIST_INVALID_ANSWER'});
 assert.deepEqual(classifyError(new TypeError('Failed to fetch'),true),{kind:'network'});
 assert.deepEqual(classifyError(new Error('anything'),false),{kind:'network'});
 assert.deepEqual(classifyError(new Error('An error occurred in the Server Components render.'),true),{kind:'server'});
 assert.equal(changesWord(1),'1 change');assert.equal(changesWord(3),'3 changes');
});

test('answer values match the server allowlist and round-trip through the sheet',()=>{
 assert.equal(buildValue('budget',{}),null,'no typed answer → no value');
 assert.deepEqual(buildValue('budget',{amount_text:' around $40–50k '}),{amount_text:'around $40–50k',response:'stated'});
 assert.deepEqual(buildValue('timeline',{text:'spring',firm:'false'}),{text:'spring',firm:false});
 assert.deepEqual(buildValue('address',{street:'4410 Elm St',city:'Edina',confirmed:'true'}),{street:'4410 Elm St',city:'Edina',confirmed:true});
 assert.deepEqual(buildValue('contact',{phone_e164:'(612) 555-0142',email_declined:'false'}),{phone_e164:'+16125550142'});
 assert.deepEqual(buildValue('who_decides',{people:'Pat, spouse\nmother-in-law'}),{people:[{name:'Pat',role:'spouse'},{name:null,role:'mother-in-law'}],sole:false});
 const v=buildValue('property',{owner:'renting',type:'condo',hoa:'yes'});
 assert.deepEqual(fieldsFromValue('property',v),{owner:'renting',type:'condo',hoa:'yes'});
 assert.equal(formatValue('property',v),'Renting · Condo · HOA');
 assert.equal(formatValue('budget',{response:'stated',amount_text:'fifty'}),'fifty');
 assert.equal(formatValue('budget',{response:'not_set'}),'No budget yet');
 assert.equal(formatValue('address','4410 Elm St, Edina'),'4410 Elm St, Edina');
});

test('refusals and N/A are never offered for the email; at most three start ticked',()=>{
 assert.equal(isRefusal('budget',{response:'declined'}),true);assert.equal(isRefusal('paying',{method:'cash'}),false);
 const rows=[['a','work','open',null,2],['b','budget','partial',{response:'declined'},4],['c','timeline','open',null,5],['d','address','not_applicable',null,3],['e','contact','open',null,1],['f','who_decides','partial',null,6],['g','found_us','covered',null,0]]
  .map(([item_id,key,state,value,priority])=>({item_id,key,state,value,priority}));
 const {rows:eligible,ticked}=emailCandidates(rows);
 assert.deepEqual(eligible.map(r=>r.item_id),['e','a','c','f']);assert.deepEqual(ticked,['e','a','c']);
});
