import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedulePresentation, invoiceState, messageParts } from '../lib/portal-presentation.ts';

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
