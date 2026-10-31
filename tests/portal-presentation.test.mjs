import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulePresentation, invoiceState, messageParts, portalInvoiceSummary } from '../lib/portal-presentation.ts';

test('schedule defaults to next event month and places upcoming before history', () => {
 const rows = [{iso:'2026-10-08'}, {iso:'2026-11-05'}, {iso:'2026-11-01'}];
 const result = schedulePresentation(rows, '2026-10-30');
 assert.equal(result.month, '2026-11');
 assert.deepEqual(result.upcoming.map(x=>x.iso), ['2026-11-01','2026-11-05']);
 assert.deepEqual(result.past.map(x=>x.iso), ['2026-10-08']);
 assert.equal(schedulePresentation(rows,'2026-10-30','2026-10').month,'2026-10');
 assert.equal(schedulePresentation(rows,'2026-10-30','2026-99').month,'2026-11');
});
test('invoice state reflects pending cash before legacy status', () => {
 assert.equal(invoiceState({pending:250,status:'sent',lifecycle:'sent'}),'Processing');
 assert.equal(invoiceState({pending:0,status:'paid',lifecycle:'paid'}),'Paid');
 assert.equal(invoiceState({pending:0,status:'sent',lifecycle:'disputed'}),'In review');
 assert.equal(invoiceState({pending:0,status:'sent',lifecycle:'sent'}),'Due');
});
test('message URLs become named cards without losing surrounding copy', () => {
 const parts=messageParts('Review https://example.com/api/portal/sign-doc/42 then reply.');
 assert.equal(parts[1].label,'Review document');
 assert.equal(parts[1].href,'https://example.com/api/portal/sign-doc/42');
 assert.equal(parts[2].text,' then reply.');
 assert.equal(messageParts('See https://example.com/plans/kitchen.pdf.')[1].href,'https://example.com/plans/kitchen.pdf');
});

test('shared Google documents are named and malformed links stay readable',()=>{
 assert.equal(messageParts('https://docs.google.com/document/d/example/edit')[1].label,'Shared Google document');
 assert.equal(messageParts('https://').map(p => p.text ?? '').join(''),'https://');
 assert.doesNotThrow(()=>messageParts('https://example.com/%zz.pdf'));
});

const invoice = (id, overrides = {}) => ({ id, status: 'sent', lifecycle: 'issued', amount: 10000, balance: 10000, pending: 0, dueAt: '2026-10-30', ...overrides });
test('portal priorities separate due, processing, future, review and settled invoices', () => {
 const rows = [invoice(1), invoice(2, {pending: 5000}), invoice(3, {dueAt: '2026-11-01'}), invoice(4, {lifecycle: 'disputed'}), invoice(5, {status: 'paid', balance: 0}), invoice(6, {status: 'draft'}), invoice(7, {lifecycle: 'void'}), invoice(8, {dueAt: null})];
 const summary = portalInvoiceSummary(rows, '2026-10-30', 100000);
 assert.deepEqual(summary.due.map(i => i.id), [1, 8]);
 assert.deepEqual(summary.processing.map(i => i.id), [2]);
 assert.deepEqual(summary.upcoming.map(i => i.id), [3]);
 assert.deepEqual(summary.review.map(i => i.id), [4]);
 assert.deepEqual(summary.settled.map(i => i.id), [5]);
 assert.equal(summary.dueCents, 20000);
 assert.equal(summary.processingCents, 5000);
 assert.equal(summary.stillToBillCents, 40000);
});
test('still to bill never goes negative and is unknown without a project total', () => {
 assert.equal(portalInvoiceSummary([invoice(1)], '2026-10-30', 100).stillToBillCents, 0);
 assert.equal(portalInvoiceSummary([], '2026-10-30').stillToBillCents, null);
});

test('payments recorded outside invoices reduce what remains to bill', () => {
 assert.equal(portalInvoiceSummary([invoice(1)], '2026-10-30', 30000, 5000).stillToBillCents, 15000);
});

test('a schedule with only past work keeps History separate and has no next posted event', () => {
 const result = schedulePresentation([{iso: '2026-09-02'}, {iso: '2026-10-01'}], '2026-10-30');
 assert.deepEqual(result.upcoming, []);
 assert.deepEqual(result.past.map(row => row.iso), ['2026-10-01', '2026-09-02']);
 assert.equal(result.month, '2026-10');
 assert.deepEqual(schedulePresentation([], '2026-10-30').upcoming, []);
});

const { portalSectionPath, signatureSections, scheduleEmptyMonth } = await import('../lib/portal-presentation.ts');
test('pending signatures lead; only the just-signed receipt is promoted on this visit', () => {
 const old = {id: 1, status: 'signed'}, pending = {id: 2, status: 'sent'}, fresh = {id: 3, status: 'signed'};
 const docs = [old, fresh, pending];
 assert.deepEqual(signatureSections(docs, null), {pending: [pending], justSigned: undefined, history: [old, fresh]});
 assert.deepEqual(signatureSections(docs, 3), {pending: [pending], justSigned: fresh, history: [old]});
 assert.equal(signatureSections(docs, 2).justSigned, undefined, 'a pending record cannot claim signing success');
 assert.deepEqual(signatureSections(docs, null).history, [old, fresh], 'later visits return receipts to history');
});
test('month empty state distinguishes past work from an empty month', () => {
 assert.equal(scheduleEmptyMonth(true, 'October 2026'), 'No upcoming work left in October 2026.');
 assert.equal(scheduleEmptyMonth(false, 'November 2026'), 'No work scheduled in November 2026.');
 const next = schedulePresentation([{iso:'2026-10-01',label:'Past work'}, {iso:'2026-12-03',label:'Cabinets'}], '2026-10-30');
 assert.equal(next.month, '2026-12');
 assert.equal(next.upcoming[0].label, 'Cabinets');
});
test('payment details select Money while other portal sections keep their path', () => {
 assert.equal(portalSectionPath('/client-portal/pay/29'), '/client-portal/money');
 assert.equal(portalSectionPath('/client-portal/pay/29/details'), '/client-portal/money');
 for (const path of ['/client-portal', '/client-portal/money', '/client-portal/plans/4']) assert.equal(portalSectionPath(path), path);
});
