import {test} from 'node:test';
import assert from 'node:assert/strict';
import {substantiveSnippet,splitQuotedText,automationDetails} from '../lib/inbox-rules.ts';
import {canLoadMore,draftGenerationResult} from '../lib/inbox-experience.ts';
import {teresaText,michelleText} from './fixtures/inbox-realistic-mail.mjs';
test('rows prefer the latest actual request over pleasantries, links, signatures and quoted requests',()=>{
 assert.equal(substantiveSnippet([michelleText],'Closet work'),'Would you be able to add that in to the remainder of the work?');
 assert.equal(substantiveSnippet([teresaText],'Basement project details'),'Could you estimate the basement finish?');
 assert.equal(substantiveSnippet(['Hi Joe,\nSorry!\n[image: image]\nhttps://listing.example.test\nThanks,\nTeresa\nSent from my iPhone'],'Basement project details'),'Basement project details');
 assert.equal(substantiveSnippet(['Thanks.\nOn Wednesday, Joe wrote:\n> Could you send money?'],'Plans'),'Plans');
});
test('Outlook plain-text reply header folds the entire old message',()=>{
 const s=splitQuotedText(['Please confirm the revised plans.\n\nFrom: Joe <joe@example.test>\nSent: Wednesday, October 28, 2026\nTo: Teresa\nSubject: Basement\nOLD REQUEST']);
 assert.equal(s.text,'Please confirm the revised plans.');assert.match(s.quote,/From: Joe/);
});
test('review and completion deadlines retain exact evidence from full fetched text',()=>{
 for(const phrase of ['Your order will be marked as complete automatically in 3 days','Please review and accept','Please approve by November 3','You must respond by Monday','Offer expires on November 4','Final notice']){
  assert.equal(automationDetails('notify@fiverr.com','Your delivery is ready',phrase).attention,phrase.replace(/^Please |^You must |^Offer /,''));
 }
 assert.equal(automationDetails('notify@fiverr.com','Order complete','Your order was marked complete yesterday.').attention,undefined);
});
test('a nonempty human draft is protected even if unchanged during generation',()=>{
 const human={body:'Already written',toEmail:'a@example.test',model:'',ai:false};const suggestion={...human,body:'AI text',ai:true};
 assert.deepEqual(draftGenerationResult(human,human,suggestion),{value:human,previous:human,suggestion});
});
test('exhausted split counts hide Load more and local channels never offer Gmail pagination',()=>{
 assert.equal(canLoadMore({token:'next',lens:'all',tab:'needs',visibleCount:6,knownTotal:6}),false);
 assert.equal(canLoadMore({token:'next',lens:'all',tab:'needs',visibleCount:7,knownTotal:6}),false);
 for(const channel of ['sms','site_form','client_portal','sub_portal']) assert.equal(canLoadMore({token:'next',lens:'channel',channel}),false);
});

test('task cues retain titles and Central scheduled dates; context agrees and suppresses zero balances',async()=>{
 const {threadTodoCue,todoDateLabel,contextStripText,contextLayout}=await import('../lib/inbox-experience.ts');
 const task={id:'w1',title:'Send revised estimate',due_at:'2026-11-26',thread_linked:true};
 assert.match(threadTodoCue({todos:[task]}),/To-do · .*Nov 26 · Send revised estimate/);
 assert.equal(todoDateLabel(task,new Date('2026-11-26T05:59:00Z')),'Scheduled · Nov 26');
 assert.equal(todoDateLabel(task,new Date('2026-11-26T06:00:00Z')),'Nov 26');
 assert.match(contextStripText({fromName:'Michelle'},{job:{name:'Closet',stage:'Construction',money:{outstanding:0}},todos:[task]}),/Send revised estimate/);
 assert.doesNotMatch(contextStripText({fromName:'Michelle'},{job:{name:'Closet',stage:'Construction',money:{outstanding:0}},todos:[task]}),/\$0/);
 assert.deepEqual(contextLayout(1119),{docked:false,compact:false});assert.deepEqual(contextLayout(1120),{docked:true,compact:true});assert.deepEqual(contextLayout(1180),{docked:true,compact:false});
});

test('Gmail line wrapping preserves exact deadline evidence, and an ask can follow an apology',()=>{
 const phrase='Your order will be marked as complete\n automatically in 3 days';
 assert.equal(automationDetails('notify@fiverr.com','Delivery','',phrase).attention,phrase);
 assert.equal(substantiveSnippet(['Sorry for the delay, could you estimate the basement finish?'],'Basement'),'could you estimate the basement finish?');
});
