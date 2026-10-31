import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {substantiveSnippet, automationDetails, automationDeadline, threadNeedsMe, summaryEligible} from '../lib/inbox-rules.ts';
import {contextLayout, matchesInboxTab, tabCounts, completionPass} from '../lib/inbox-experience.ts';
import {readableEmailHtml} from '../lib/inbox-email-html.ts';

// Invented senders/text; shapes mirror wrapped requests, referents and provider receipts.
const fixtures={
 michelle:['Hello Builder,\n\nWe are looking for an estimate for popcorn removal and painting in the stair hallway. Would you be able to add that in to the remaining work?\n\nThanks,\nAlex'],
 teresa:["Hi Builder,\n\nSorry for the wait! The listing is https://listing.example.test/home\n\nThe unfinished space is 849 square feet and includes a bedroom (needs an egress window) and laundry. There is a bathroom we don’t need to do anything with.\n\nThanks,\nSam"],
 fiverr:['Your design delivery will be marked as complete after 3 days. Review and accept your order.'],
 square:['Hi Builder,\n\nPayment of $420.00 received. Thanks for your business.'],
};
test('rows retain objects and scope, discard greetings/footers, and fall back to subject',()=>{
 const ask=substantiveSnippet(fixtures.michelle,'Old invoice');assert.match(ask,/popcorn removal.*painting.*stair hallway/);assert.match(ask,/add that/);
 const scope=substantiveSnippet(fixtures.teresa,'Basement project');assert.match(scope,/849 square feet.*bedroom.*egress/);assert.doesNotMatch(scope,/bathroom|https|Sorry/);
 assert.equal(substantiveSnippet(['That is especially true when we work together.'],'Sponsorship invitation'),'Sponsorship invitation');
 assert.equal(substantiveSnippet(['Hi Builder,\n\nX________\nPlease visit https://example.test\nThanks,\nSam'],'Receipt available'),'Receipt available');
 assert.doesNotMatch(substantiveSnippet(fixtures.square,'Payment received'),/^Hi/);
});
test('relative deadlines derive from message date, including year boundaries',()=>{
 assert.equal(automationDeadline(fixtures.fiverr.join(' '),Date.parse('2026-10-31T15:00:00Z')),'Auto-completes Nov 3');
 assert.equal(automationDeadline('Order will be completed after 3 days',Date.parse('2026-12-30T15:00:00Z')),'Auto-completes Jan 2');
 assert.equal(automationDeadline('No deadline',Date.now()),undefined);
});
test('subject event semantics take priority over payment/statement words in a pitch or footer',()=>{
 assert.equal(automationDetails('agent@finance.example.test','Pre-Approved - MCA Consolidation','Reduce weekly payments','Statement of proposed terms').kind,'Marketing');
 assert.equal(automationDetails('notify@pay.example.test','Payment confirmation','$420 paid','View statement and receipt').kind,'Payment');
 assert.equal(automationDetails('statements@bank.example.test','Your eStatement is available','Payment details enclosed').kind,'Statement');
});
test('context width budget accounts for borders and never squeezes the reader',()=>{
 for(const width of [954,1100,1280]){const l=contextLayout(width);assert.equal(l.docked,true);assert.ok(l.listWidth>=240);assert.ok(l.panelWidth>=260);assert.ok(width-l.listWidth-l.panelWidth>=440);}
 assert.equal(contextLayout(954).listWidth,240);assert.equal(contextLayout(954).panelWidth,274);
 for(const width of [900,390])assert.equal(contextLayout(width).docked,false);
});
test('the needs classifier is shared by counts and rows, independent of unread',()=>{
 const threads=[{id:'a',view:'needs_reply',contactRole:'client'}, {id:'b',view:'needs_reply',newSender:true}, {id:'c',view:'needs_reply',automated:true}, {id:'d',view:'needs_reply',automated:true,attentionRequired:true}, {id:'e',view:'done',filedOther:true}];
 assert.equal(tabCounts(threads).needs,2);
 for(const t of threads)assert.equal(matchesInboxTab(t,'needs'),threadNeedsMe(t));
});
test('readable HTML preserves links and receipt label/value rows without images, scripts or quoted history',()=>{
 const html=readableEmailHtml('<style>bad</style><p>Paid <a href="https://pay.example.test/invoice">View invoice</a><a href="javascript:alert(1)">unsafe</a></p><table width="900"><tr><td>Amount</td><td>$1,060.00</td></tr><tr><td>Invoice</td><td>12345</td></tr></table><img src="https://track.example.test"><blockquote>OLD</blockquote><script>bad()</script>');
 assert.match(html,/Amount:.*\$1,060.00/);assert.match(html,/Invoice:.*12345/);assert.match(html,/href="https:\/\/pay.example.test\/invoice"/);assert.doesNotMatch(html,/javascript|<script|<img|OLD|bad|width=/);
});
test('summary appears for multiple messages or more than 120 words only',()=>{
 assert.equal(summaryEligible([{body:['word '.repeat(120)]}]),false);assert.equal(summaryEligible([{body:['word '.repeat(121)]}]),true);assert.equal(summaryEligible([{body:['Hello']},{body:['Hi']}]),true);
});
test('completion advances within the supplied split/search pass without switching scope',()=>{
 const pass=[{id:'receipt',view:'done'},{id:'pitch',view:'awaiting_them'},{id:'bank',view:'done'}];
 assert.equal(completionPass(pass,'pitch').next.id,'bank');assert.equal(completionPass(pass,'bank').next.id,'receipt');assert.deepEqual(completionPass([pass[0]],'receipt'),{next:undefined,left:0});
});

test('reminder presets resolve Central wall time through DST and reject elapsed today',async()=>{
 const {reminderDueAt}=await import('../lib/inbox-experience.ts');
 assert.equal(reminderDueAt('today',new Date('2026-10-31T15:00:00Z')),'2026-10-31T20:00:00.000Z');
 assert.equal(reminderDueAt('week',new Date('2026-10-31T15:00:00Z')),'2026-11-07T14:00:00.000Z');
 assert.throws(()=>reminderDueAt('today',new Date('2026-10-31T21:00:00Z')),/future/);
});
