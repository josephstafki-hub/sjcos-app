import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleBudgetView} from '../lib/budget-assemble.ts';
import {KITCHEN_RAW} from '../lib/budget-fixtures.ts';
const invoice=(status,extra={})=>({number:'ZZ QA INV',milestone:'Draw',amountCents:10000,status,createdOn:'2026-10-01',sentOn:null,paidOn:null,...extra});
const build=invoices=>{const raw=structuredClone(KITCHEN_RAW);raw.invoices=invoices;raw.project.billingSource='invoices';raw.project.openingBilledCents=0;raw.project.openingCollectedCents=0;return assembleBudgetView(raw,{asOf:'2026-10-30'});};
test('partially paid invoices remain open in the company and project money summaries',()=>{
 const view=build([invoice('partially_paid',{paidCents:2500,balanceCents:7500})]);
 assert.equal(view.billing.unpaidInvoicesCents,7500);
 assert.equal(view.billing.billedCents,10000);
 assert.equal(view.clientInvoices[0].status,'sent');
 assert.match(view.clientInvoices[0].statusLabel,/75\.00.*open/);
});
test('Undo leaves an issued invoice open; voided invoices never count as billed',()=>{
 const view=build([invoice('issued',{paidCents:0,balanceCents:10000}),invoice('void')]);
 assert.equal(view.billing.unpaidInvoicesCents,10000);
 assert.equal(view.billing.billedCents,10000);
 assert.equal(view.clientInvoices.length,1);
 assert.equal(view.clientInvoices[0].status,'sent');
 assert.match(view.clientInvoices[0].statusLabel,/^Issued$/);
});
