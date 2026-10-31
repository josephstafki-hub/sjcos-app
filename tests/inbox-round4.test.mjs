import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stageLabel, splitQuotedText, substantiveSnippet, conversationDraftContext, channelCommitLabel} from '../lib/inbox-rules.ts';
import {orderedInboxThreads, rowDay, canLoadMore, tabCounts, matchesInboxTab, contextStripText, draftGenerationResult, completionQueue, attentionTaskTitle} from '../lib/inbox-experience.ts';
test('date groups occur once, with stable priority inside each group',()=>{
 const now=new Date('2026-10-31T17:00:00Z');
 const row=(id,date,automated=false)=>({id,receivedAt:Date.parse(date+"T17:00:00Z"),view:'needs_reply',automated,attentionRequired:automated,contactRole:'client'});
 const result=orderedInboxThreads([row('old','2026-10-28'),row('square','2026-10-30',true),row('today','2026-10-31'),row('human','2026-10-30')],now);
 assert.deepEqual(result.map(t=>t.id),['today','human','square','old']);
 assert.deepEqual(result.map(t=>rowDay(t,now)),['Today','Yesterday','Yesterday','Earlier']);
});
test('pagination only exposes a token belonging to the current source',()=>{
 assert.equal(canLoadMore({token:'x',lens:'channel',channel:'sms'}),false);
 assert.equal(canLoadMore({token:'x',lens:'project'}),false);
 assert.equal(canLoadMore({token:'x',lens:'system',remoteReady:false}),false);
 assert.equal(canLoadMore({token:'x',lens:'system',remoteReady:true}),true);
 assert.equal(canLoadMore({token:'x',lens:'all',tab:'needs',visibleCount:6,knownTotal:6}),false);
 assert.equal(canLoadMore({token:'x',lens:'all',tab:'needs',visibleCount:6}),true);
 assert.equal(canLoadMore({lens:'all'}),false);
});
test('attention automation counts in Needs me only, ordinary automation remains Other',()=>{
 const action={id:'square',automated:true,attentionRequired:true,view:'needs_reply'};
 assert.equal(matchesInboxTab(action,'other'),false);
 assert.deepEqual(tabCounts([action,{id:'receipt',automated:true,view:'done'}]),{needs:1,other:1,clients:0,leads:0,subs:0,new:0});
});
test('plain stage + compact strip never use a status note as the stage',()=>{
 assert.equal(stageLabel('pre_construction'),'Pre-construction');
 assert.equal(stageLabel('construction'),'Construction');
 assert.equal(contextStripText({fromName:'Michelle'}, {job:{name:'Alcantara · Closet',stage:'construction',money:{outstanding:225000}},todos:[{}]}),'Context · Alcantara · Closet · Construction · $2,250 outstanding · 1 open to-do');
});
test('multiline attribution folds with quote even when inside a paragraph',()=>{
 const body=['Hi Joe,\n\nPlease confirm the visit.\nOn Wednesday, October 28, 2026,\nJoseph <joe@example.test> wrote:\n> Earlier request'];
 const split=splitQuotedText(body);assert.match(split.text,/Please confirm/);assert.doesNotMatch(split.text,/On Wednesday|Earlier request/);assert.match(split.quote,/On Wednesday/);
 assert.equal(substantiveSnippet(body),'Please confirm the visit.');
 assert.equal(substantiveSnippet(['Hi Joe, Can you send photos?']),'Can you send photos?');
});
test('AI generation protects edits and retains previous draft',()=>{
 const snapshot={body:'My draft',toEmail:'a@test.com',ai:false,model:''};
 const suggestion={...snapshot,body:'Suggestion',ai:true};
 assert.deepEqual(draftGenerationResult(snapshot,snapshot,suggestion),{value:suggestion,previous:snapshot,suggestion:null});
 const edited={...snapshot,body:'Changed while waiting'};
 assert.deepEqual(draftGenerationResult(snapshot,edited,suggestion),{value:edited,previous:snapshot,suggestion});
});
test('draft context is bounded, includes both directions and strips quotes',()=>{
 const history=Array.from({length:10},(_,i)=>({fromName:i%2?'Joe':'Client',outbound:i%2===1,body:[`Message ${i}\nOn Tuesday, someone wrote:\n> secret quoted text ${'x'.repeat(5000)}`]}));
 const c=conversationDraftContext(history,8);
 assert.equal(c.count,6);assert.match(c.text,/Message 2/);assert.match(c.text,/Joe/);assert.doesNotMatch(c.text,/Message 0|secret quoted/);assert.ok(c.text.length<=12000);
});
test('Done chooses eligible next and counts remaining with no completed draft ghost',()=>{
 const rows=['a','b','c'].map(id=>({id,view:'needs_reply',contactRole:'client'}));
 const q=completionQueue(rows,'b',new Set(['b']));assert.equal(q.next.id,'c');assert.equal(q.left,2);
 assert.equal(attentionTaskTitle({fromName:'Square',subject:'Action required to avoid a hold'}),'Square: Action required to avoid a hold');
});
test('commit labels name the actual destination',()=>{
 assert.equal(channelCommitLabel('sub_portal'),'Post to sub portal');assert.equal(channelCommitLabel('client_portal'),'Post to client portal');assert.equal(channelCommitLabel('sms'),'Send text');assert.equal(channelCommitLabel('site_form'),'Send email');
});
