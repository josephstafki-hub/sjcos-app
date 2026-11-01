import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptFields,useCompactReceipt} from '../lib/inbox-receipt.ts';
import {rowActionTitle,rowStatus,reminderTitle} from '../lib/inbox-review.ts';
import {contextStripText,threadTodoCue} from '../lib/inbox-experience.ts';
import {channelThreadTitle,splitCount} from '../lib/inbox-display.ts';
import {automatedActionLine,automationDetails} from '../lib/inbox-rules.ts';
import {attachInquiryContinuity} from '../lib/inbox-continuity.ts';
import {inquiryLinkKey,readInquiryLink,saveInquiryLinkReceipt} from '../lib/inbox-inquiry-recovery.ts';

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
 const withInvoice=receipt.replace('<tr><td>Status','<tr><td>Invoice amount</td><td>$600.00</td></tr><tr><td>Status');
 assert.deepEqual(receiptFields(withInvoice).slice(0,6).map(f=>f.value),fields.map(f=>f.value));
});

test('sent-but-unlinked receipts survive reload, isolate users and clear only after repair',()=>{
 const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const key=inquiryLinkKey('Builder@example.test','owner','siteform:awning');
 const receipt={inquiryId:'siteform:awning',threadId:'sent-awning',sentAt:1234};
 assert.equal(saveInquiryLinkReceipt(store,key,receipt),true);assert.deepEqual(readInquiryLink(store,key),receipt);
 assert.equal(readInquiryLink(store,inquiryLinkKey('staff@example.test','staff','siteform:awning')),null);
 saveInquiryLinkReceipt(store,key,null);assert.equal(readInquiryLink(store,key),null);
 assert.equal(saveInquiryLinkReceipt({setItem(){throw Error('full')}},key,receipt),false);
});

test('new inquiries are not contacted by old correspondence, an inbound-only link or mail to somebody else',()=>{
 const make=()=>({form:{email:'eden@example.test',createdAt:'2026-11-05T13:00:00Z'},messages:[]});
 const form={id:'siteform:awning',channel:'site_form',linkedSlug:'awning',view:'needs_reply'};
 const email={id:'previous-mail',channel:'email',subject:'A previous request'};
 const readers={[form.id]:make(),[email.id]:{messages:[{outbound:true,to:'eden@example.test',fromEmail:'owner@example.test',date:Date.parse('2026-10-01T14:00:00Z')}]}};
 attachInquiryContinuity([form,email],readers);assert.notEqual(readers[form.id].form.contacted,true);
 readers[email.id].messages.push({outbound:true,to:'someone-else@example.test',fromEmail:'eden@example.test',date:Date.parse('2026-11-06T14:00:00Z')});
 attachInquiryContinuity([form,email],readers);assert.notEqual(readers[form.id].form.contacted,true);
 readers[email.id].messages.push({outbound:true,to:'Eden <eden@example.test>',date:Date.parse('2026-11-06T15:00:00Z')});
 attachInquiryContinuity([form,email],readers);assert.equal(readers[form.id].form.contacted,true);assert.equal(form.view,'awaiting_them');
 const otherForm={...form,id:'siteform:inbound-only',view:'needs_reply',linkedSlug:'inbound-only'};
 attachInquiryContinuity([otherForm,{...email,linkedType:'lead',linkedSlug:'inbound-only'}],{[otherForm.id]:make(),[email.id]:{messages:[{fromEmail:'eden@example.test',outbound:false}]}});
 assert.equal(otherForm.view,'needs_reply');
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
  '<h1>Payment receipt</h1><p>You paid $483.27 to Juniper Crane Hire on 11/06/2026</p><table><tr><th>Current plan</th><th>Proposed plan</th><th>Savings</th></tr><tr><td>$81</td><td>$70</td><td>$11</td></tr></table>',
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
