import {test} from 'node:test';
import assert from 'node:assert/strict';
import {receiptFields, useCompactReceipt} from '../lib/inbox-receipt.ts';
import {rowActionTitle, reminderTitle} from '../lib/inbox-review.ts';
import {draftSources, swipeIntent, fileLossWarning} from '../lib/inbox-round12.ts';

// Invented mail only; no network, provider, AI or DB imports.
const receipt='<h1>Payment receipt</h1><table width="840"><tr><td><table><tr><td>Paid to</td><td>Orchard Tool Co.</td></tr><tr><td>Payment date</td><td>Oct 25, 2026</td></tr><tr><td>Amount paid</td><td>$268.40</td></tr><tr><td>Invoice no.</td><td>INV-8024</td></tr><tr><td>Status</td><td>Paid</td></tr></table></td></tr></table>';
const comparison='<table><tr><th>Plan</th><th>Monthly amount</th><th>Status</th></tr><tr><td>Basic</td><td>$40</td><td>Available</td></tr><tr><td>Plus</td><td>$65</td><td>Available</td></tr></table>';
test('overflowing single-record receipts default to complete priority label/value pairs',()=>{
 const fields=receiptFields(receipt);
 assert.deepEqual(fields.map(f=>f.value),['$268.40','Orchard Tool Co.','Oct 25, 2026','INV-8024','Paid']);
 assert.equal(useCompactReceipt(fields,true,null),true);
 assert.equal(useCompactReceipt(fields,false,null),false);
 assert.equal(useCompactReceipt(fields,true,'formatted'),false);
 assert.deepEqual(receiptFields(comparison),[]);
 assert.equal(useCompactReceipt([],true,null),false);
});
test('a horizontal one-record invoice is compact, but generic two-column prose is not',()=>{
 assert.deepEqual(receiptFields('<h2>Receipt</h2><table><tr><th>Invoice #</th><th>Amount</th><th>Status</th></tr><tr><td>R-93</td><td>$18.25</td><td>Paid</td></tr></table>').map(f=>f.value),['$18.25','R-93','Paid']);
 assert.deepEqual(receiptFields('<table><tr><td>Our story</td><td>We make beautiful doors.</td></tr></table>'),[]);
});
test('unseen model headlines carry into task defaults and automation uses evidence',()=>{
 const t={fromName:'Riley',subject:'Re: A question',actionTitle:'Include a covered bicycle shelter'};
 assert.equal(rowActionTitle(t),t.actionTitle);assert.equal(reminderTitle(t),t.actionTitle);
 assert.equal(rowActionTitle({fromName:'Order desk',subject:'An update',automated:true,automationKind:'Alert',attentionEvidence:'Review your order. It will auto-complete on November 9.'}),'An update');
 assert.equal(rowActionTitle({fromName:'Billing',subject:'Your receipt',automated:true,automationKind:'Receipt'}),'Your receipt');
});
test('sources name only the actual bounded prompt inputs, including exact messages and record',()=>{
 const messages=Array.from({length:12},(_,i)=>({id:`message-${i}`,fromName:'Riley',body:['Please review the gate.'],outbound:false}));
 const sources=draftSources('thread-1',messages,11,{kind:'lead',slug:'garden-gate',label:'Garden gate'});
 assert.equal(sources[0].messageId,'message-11');assert.equal(sources.length,8);
 assert.deepEqual(sources.at(-1),{kind:'lead',slug:'garden-gate',label:'Garden gate'});
 assert.equal(new Set(sources.filter(s=>s.kind==='message').map(s=>s.messageId)).size,7);
});
test('swipes require deliberate horizontal travel and exclude scrolls; loss warning counts files',()=>{
 assert.equal(swipeIntent(95,12),'done');assert.equal(swipeIntent(-95,10),'remind');
 assert.equal(swipeIntent(25,1),null);assert.equal(swipeIntent(90,80),null);
 assert.equal(fileLossWarning(2),'2 files will be lost. Leave this draft?');assert.equal(fileLossWarning(0),'');
});

test('a receipt with prose identity and spacer cells keeps whole amounts and reference values',()=>{
 const html='<h1>Payment confirmation</h1><p>You paid $372.18</p><p>to <b>Maple Equipment Rental</b> on<br>10/22/2026</p><table width="950"><tr><td>Invoice no.</td><td></td><td>MX-581</td></tr><tr><td>Invoice amount</td><td></td><td>$372.18</td></tr><tr><td>Total amount</td><td></td><td>$372.18</td></tr><tr><td>Status</td><td></td><td>Paid</td></tr></table>';
 const fields=receiptFields(html);assert.ok(fields.some(f=>f.value==='$372.18'));
 assert.ok(fields.some(f=>f.value==='Maple Equipment Rental'));assert.ok(fields.some(f=>f.value==='10/22/2026'));
 assert.ok(fields.some(f=>f.value==='MX-581'));assert.equal(useCompactReceipt(fields,true,null),true);
});
