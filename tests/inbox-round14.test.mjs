import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptFields,useCompactReceipt} from '../lib/inbox-receipt.ts';
import {rowActionTitle,rowStatus,reminderTitle} from '../lib/inbox-review.ts';
import {contextStripText,threadTodoCue} from '../lib/inbox-experience.ts';
import {channelThreadTitle,splitCount} from '../lib/inbox-display.ts';
import {automatedActionLine,automationDetails} from '../lib/inbox-rules.ts';

// Invented mail only. Nested layout cells, not a copy of any mailbox payload.
const receipt=`<h1>Payment receipt</h1><p>You paid $483.27</p>
 <p>to <b>Juniper Crane Hire</b> on <br>11/06/2026</p>
 <table width="980"><tr><td>
  <table><tr><td><table><tr><td>Invoice no.</td></tr></table></td><td><table><tr><td>JC-782</td></tr></table></td></tr>
   <tr><td>Status</td><td><b>Paid</b></td></tr>
   <tr><td>Payment method</td><td><table><tr><td>Card ending in 6402</td></tr></table></td></tr>
  </table></td></tr></table>`;
test('loaded wide nested receipt has priority fields and defaults to compact after measurement',()=>{
 const fields=receiptFields(receipt);
 assert.deepEqual(fields.map(f=>f.value),['$483.27','Juniper Crane Hire','11/06/2026','JC-782','Paid','Card ending in 6402']);
 assert.equal(useCompactReceipt(fields,true,null),true);
 assert.equal(useCompactReceipt(fields,false,null),false);
 assert.equal(useCompactReceipt(fields,true,'formatted'),false);
});

test('channel headings identify the contact and empty split counts disappear in a channel lens',()=>{
 for(const channel of ['sms','client_portal','sub_portal'])assert.equal(channelThreadTitle({channel,fromName:'Eden Watts',subject:'Text message'}),'Eden Watts');
 assert.equal(channelThreadTitle({channel:'email',fromName:'Eden',subject:'Proposal'}),'Proposal');
 assert.equal(splitCount(0,true),undefined);assert.equal(splitCount(2,true),2);assert.equal(splitCount(0,false),0);
});
test('comparison and multi-record payment grids retain their columns',()=>{
 for(const html of [
  '<h1>Payment plans</h1><table width="990"><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr><tr><td>A-1</td><td>$81</td><td>Paid</td></tr><tr><td>A-2</td><td>$96</td><td>Due</td></tr></table>',
  '<h1>Payment comparison</h1><table width="990"><tr><th>Current plan</th><th>Proposed plan</th><th>Savings</th></tr><tr><td>$81</td><td>$70</td><td>$11</td></tr></table>',
  '<h1>Payment receipts</h1><table><tr><td>Amount paid</td><td>$81</td></tr><tr><td>Invoice</td><td>A-1</td></tr></table><table><tr><td>Amount paid</td><td>$96</td></tr><tr><td>Invoice</td><td>A-2</td></tr></table>',
 ])assert.deepEqual(receiptFields(html),[]);
});
test('automated subjects stay specific while action cues come from unseen request evidence',()=>{
 const order={subject:'Re: Your custom sample is ready',fromName:'Fabrication desk',automated:true,view:'needs_reply',attentionRequired:true,receivedAt:Date.parse('2026-11-06T16:00:00Z'),attentionEvidence:'Review your order. The order will be completed automatically in 4 days.'};
 assert.equal(rowActionTitle(order),'Your custom sample is ready');
 assert.equal(rowStatus(order).label,'Review order · auto-completes Nov 10');
 assert.equal(contextStripText(order),'Automated · Fabrication desk · Review order · auto-completes Nov 10');
 const request={...order,subject:'Account update needed',attentionEvidence:'Please complete the information request within 6 business days.'};
 assert.equal(rowStatus(request).label,'Complete information request · 6 business days');
 assert.doesNotMatch(contextStripText(request),/Account update needed/);
 const extracted=automationDetails('notify@unseen-store.test','Delivery ready','','Your order will be marked as complete automatically in 4 days.');
 assert.equal(automatedActionLine(extracted.attention,order.receivedAt),'Review order · auto-completes Nov 10');
});
test('internal leading uppercase markers never reach work cues or task defaults',()=>{
 const t={subject:'[TODO] [PREP ME] Check awning brackets',fromName:'Taylor',todos:[{id:'work-14',title:'[UNVERIFIED] [FOLLOW_UP] Measure bracket spacing',due_at:null}]};
 assert.equal(threadTodoCue(t),'To-do · Measure bracket spacing');
 assert.equal(reminderTitle({...t,actionTitle:'[TODO] Confirm bracket count'}),'Confirm bracket count');
 assert.equal(rowActionTitle(t),'Check awning brackets');
 assert.equal(rowActionTitle({...t,subject:'[Design] Awning options'}),'[Design] Awning options');
 assert.doesNotMatch(contextStripText({...t,todos:[{...t.todos[0],thread_linked:true}]}),/UNVERIFIED|FOLLOW_UP/);
});
