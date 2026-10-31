import {test} from 'node:test';
import assert from 'node:assert/strict';
import { automationDetails, screeningEligible } from '../lib/inbox-rules.ts';
import {contextStripText, matchesInboxTab, triageRank, completeAfterSend} from '../lib/inbox-experience.ts';

test('action-required automation surfaces evidence; routine real-mail fixtures retain useful kinds',()=>{
 for(const [from,subject,snippet,kind,attention] of [
  ['noreply@squareup.com','Action required to avoid a hold on Square transfers','','Payment','Action required'],
  ['capital@stripe.com','Your $239.36 debit','Your payment failed','Payment','payment failed'],
  ['payments@intuit.com','QuickBooks Payments','Your account is on hold','Payment','on hold'],
  ['eStatements@villagebankonline.com','Your eStatement is ready','','Statement',undefined],
  ['notifications@github.com','Re: [pingdotgg/t3code] Bug','New comment','Notification',undefined],
  ['receipts@menards.com','Your Menards receipt','','Receipt',undefined],
  ['news@fiverr.com','Save on your next project','Unsubscribe','Marketing',undefined],
  ['alerts@bank.com','Security alert','Please verify your identity','Alert','verify your identity'],
  ['billing@service.com','Payment received','Your payment is not past due','Payment',undefined],
  ['updates@service.com','COI expiring soon','','Alert','COI expiring'],
  ['updates@service.com','Estimate awaiting review','','Notification','Estimate awaiting review'],
 ]) {const d=automationDetails(from,subject,snippet);assert.equal(d.kind,kind,subject);assert.equal(d.attention,attention,subject);}
 const human={id:'human',view:'needs_reply',contactRole:'client'};
 const automatic={id:'auto',view:'needs_reply',automated:true,attentionRequired:true};
 assert.equal(matchesInboxTab(automatic,'needs'),true);assert.ok(triageRank(human)<triageRank(automatic));
 assert.equal(matchesInboxTab({...automatic,attentionOverride:false},'needs'),false);
});
test('screening is unresolved inbound only and excludes all own aliases and decided senders',()=>{
 const base={email:'new@example.test',inbound:true,done:false,known:false,staff:false,ownAddresses:['joe@example.test','alias@example.test']};
 assert.equal(screeningEligible(base),true);
 for(const patch of [{inbound:false},{done:true},{staff:true},{known:true},{decision:'other'},{email:'ALIAS@example.test'},{email:'Joe <joe@example.test>'}]) assert.equal(screeningEligible({...base,...patch}),false,JSON.stringify(patch));
});
test('context uses short identity, stage and ledger cents; narrative stays in panel',()=>{
 assert.equal(contextStripText({projectLabel:'Alcantara · Closet · Invoice narrative',contactStage:'construction'}, {job:{name:'Alcantara · Closet · Invoice narrative',stage:'Construction',money:{outstanding:204000}}}), 'Context · Alcantara · Closet · Construction · $2,040 outstanding');
 assert.equal(contextStripText({fromName:'Teresa',contactStage:'intake'}),'Context · Teresa · New inquiry');
});
test('send failure never completes; completion retry never sends again',async()=>{
 const calls=[];
 assert.equal((await completeAfterSend(async()=>{calls.push('send');return {ok:false,error:'offline'}},async()=>{calls.push('done');return {ok:true}})).sent,false);
 assert.deepEqual(calls,['send']);calls.length=0;
 const r=await completeAfterSend(async()=>{calls.push('send');return {ok:true}},async()=>{calls.push('done');return {ok:false,error:'offline'}});
 assert.equal(r.sent,true);assert.equal(r.done,false);assert.deepEqual(calls,['send','done']);
 calls.length=0;await r.retry();assert.deepEqual(calls,['done']);
});
