import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftReviewSize, askExcerpt, rowActionTitle, cleanRowSummary, automationState, composerMode, olderOtherMail, completeMailBatch, reminderTitle, restoreForwardChoices, regenerateModel} from '../lib/inbox-review.ts';
import {automationDetails} from '../lib/inbox-rules.ts';
import {readableEmailHtml} from '../lib/inbox-email-html.ts';

// Invented content and addresses only; no provider/DB/model imports.
const hallway=['Hi Builder,\n\nThanks for the update. We need an estimate for painting the hallway and removing the popcorn ceiling. Could you add that to the work?\n\nRegards,\nCasey'];
const basement=['Hello Builder,\n\nThe basement is 820 square feet with a bedroom, egress window and laundry. Can you review these basement details for an estimate?\n\nThanks,\nTaylor'];
test('review sizing grows to content, floors at eight lines and signals remaining text only above cap',()=>{
 assert.deepEqual(draftReviewSize(40,1000,24),{height:192,more:false});
 assert.deepEqual(draftReviewSize(300,1000,24),{height:300,more:false});
 assert.deepEqual(draftReviewSize(900,1000,24),{height:450,more:true});
 assert.equal(draftReviewSize(900,300,24).height,135);
});
test('ask excerpt retains actual request sentences and antecedent, excludes greeting/signoff/quoted history',()=>{
 const excerpt=askExcerpt(hallway,'Old invoice');assert.match(excerpt,/painting.*hallway.*popcorn/);assert.match(excerpt,/add that/);assert.doesNotMatch(excerpt,/Hi|Thanks|Regards|Casey/);
 assert.match(askExcerpt(basement,'Plans'),/basement|egress/);
 assert.doesNotMatch(askExcerpt(['Hi Builder,\nPlease review the window quote.\n\nOn Friday someone wrote:\nPlease cancel everything.'],'Plans'),/cancel/);
});
test('action titles are general: AI headline first, then the actual ask, then the subject — nothing job- or sender-specific',()=>{
 // An AI headline from the auto-draft wins.
 assert.equal(rowActionTitle({fromName:'Michelle',subject:'Old invoice',preview:askExcerpt(hallway),actionTitle:'Price hallway painting and popcorn removal'}),'Price hallway painting and popcorn removal');
 // Without one, the row shows the sender's actual request.
 assert.match(rowActionTitle({fromName:'Michelle',subject:'Old invoice',preview:askExcerpt(hallway)}),/^Asks: .*(?:popcorn|painting)/);
 // Mail no fixture has seen: still a real ask, not a canned title.
 assert.equal(rowActionTitle({fromName:'Dana Ruiz',subject:'Deck',preview:'Could you come look at the rotten deck boards next week?'}),'Asks: Could you come look at the rotten deck boards next week?');
 assert.equal(rowActionTitle({fromName:'Lee',subject:'Re: Cabinet hinges',preview:'They arrived and look great.'}),'Cabinet hinges');
 // Generic information-request rule, no sender name baked in.
 assert.equal(rowActionTitle({fromName:'Square',subject:'Action required',preview:'Complete the information request within the next 5 days',automated:true}),'Complete information request · 5 days');
 assert.equal(rowActionTitle({fromName:'Any Bank',subject:'Account review',preview:'Please complete the information request in 10 days',automated:true}),'Complete information request · 10 days');
 // Automated mail promotes its evidenced action; the subject remains in the reader.
 assert.equal(rowActionTitle({fromName:'Fiverr',subject:'Great news: Your order is ready',automated:true,attentionEvidence:'Your order will be automatically marked complete after 3 days'}),'Review order');
 assert.equal(cleanRowSummary('Michelle: Please review the plans','Michelle'),'Please review the plans');
 assert.match(reminderTitle({fromName:'Dana Ruiz',subject:'Deck',preview:'Could you come look at the deck?'}),/^Review /);
});
test('ask excerpts use general request signals only',()=>{
 assert.match(askExcerpt(['Hi Joe,\n\nWe moved in last month. Could you quote a new fence along the back yard?\n\nThanks,\nAl'],'Fence'),/quote a new fence/);
 assert.doesNotMatch(askExcerpt(['Hi Joe,\n\nWe moved in last month. Could you quote a new fence?\n\nThanks'],'Fence'),/moved in last month/);
});
test('automation row/reader status agrees on done, current attention and owner overrides',()=>{
 assert.deepEqual(automationState({automated:true,automationKind:'Payment',view:'done',inInbox:false,attentionRequired:true}),{attention:false,label:'Payment · done'});
 assert.equal(automationState({automated:true,automationKind:'Payment',view:'needs_reply',inInbox:true,attentionRequired:true}).attention,true);
 assert.equal(automationState({automated:true,view:'needs_reply',attentionRequired:true,attentionOverride:false}).attention,false);
});
test('third party GitHub mentions and quoted deadlines do not demand Joe’s attention',()=>{
 assert.equal(automationDetails('notifications@github.com','@other mentioned you','@other please review and approve by Friday.','', 'joe@example.test').attention,undefined);
 assert.ok(automationDetails('notifications@github.com','Review requested','@joe please review and approve by Friday.','', 'joe@example.test').attention);
 assert.equal(automationDetails('notifications@github.com','@joe mentioned you','@other please review and approve by Friday.','', 'joe@example.test').attention,undefined);
 assert.ok(automationDetails('notify@squareup.com','Action required','Complete the information request within the next 5 days.').attention);
});
test('screen first suppresses drafts and composer until Reply anyway is explicitly chosen',()=>{
 assert.equal(composerMode(true,false,false),'screen');assert.equal(composerMode(true,true,false),'reply');
 assert.equal(composerMode(false,false,true),'automated');assert.equal(composerMode(false,true,true),'reply');
});
test('mark-all targets only older inbox automation in Other, records partial success and undoes only successful archives',async()=>{
 const now=new Date('2026-10-31T18:00:00Z');const old={channel:'email',automated:true,inInbox:true,view:'done',receivedAt:Date.parse('2026-10-29T12:00:00Z')};
 const rows=[{...old,id:'a'},{...old,id:'b'},{...old,id:'attention',view:'needs_reply',attentionRequired:true},{...old,id:'today',receivedAt:now.getTime()},{...old,id:'archived',inInbox:false},{...old,id:'person',automated:false}];
 assert.deepEqual(olderOtherMail(rows,now).map(t=>t.id),['a','b']);
 const archives=[],restores=[];const result=await completeMailBatch(olderOtherMail(rows,now),async id=>{archives.push(id);return {ok:id!=='b'};});
 assert.deepEqual(archives,['a','b']);assert.deepEqual(result.completed.map(t=>t.id),['a']);assert.deepEqual(result.failed.map(t=>t.id),['b']);
 await completeMailBatch(result.completed,async id=>{restores.push(id);return {ok:true};});assert.deepEqual(restores,['a']);
});
test('readable comparisons retain columns while receipts retain label/value pairs',()=>{
 const html=readableEmailHtml('<table><tr><td>Current</td><td>Proposed</td><td>Savings</td></tr><tr><td>$500</td><td>$400</td><td>$100</td></tr></table>');
 assert.match(html,/<table/);assert.match(html,/<th scope="col"[^>]*>Current/);assert.match(html,/<td[^>]*>\$400/);
 assert.match(readableEmailHtml('<table><tr><td>Amount</td><td>$100</td></tr><tr><td>Status</td><td>Paid</td></tr></table>'),/Amount:.*\$100/);
});
test('forward choices restore removed originals, retain empty selection and reject stale ids',()=>{
 const originals=[{id:'a'},{id:'b'}];assert.deepEqual(restoreForwardChoices(originals,null),originals);
 assert.deepEqual(restoreForwardChoices(originals,'[]'),[]);assert.deepEqual(restoreForwardChoices(originals,'["b","gone"]'),[{id:'b'}]);
});


test('nested layout tables never swallow surrounding copy when preserving an inner comparison',()=>{
 const html=readableEmailHtml('<table><tr><td>Before<table><tr><th>Current</th><th>Proposed</th><th>Savings</th></tr><tr><td>500</td><td>400</td><td>100</td></tr></table>After</td></tr></table>');
 assert.match(html,/Before/);assert.match(html,/After/);assert.equal((html.match(/<table/g)??[]).length,1);
});

test('regeneration retains Claude, Hermes or an explicitly selected legacy Qwen author',()=>{
 assert.deepEqual(['Claude','Hermes','Qwen',undefined].map(regenerateModel),['claude','hermes','qwen','hermes']);
});
