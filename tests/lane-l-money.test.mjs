import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as money from '../lib/budget-company.ts';

test('attention groups keep invoices ahead of budget values and rank oldest invoices first', () => {
  const item = (kind, amountCents, urgencyDays = 0) => ({kind, amountCents, urgencyDays, name: 'Job', slug: 'job', text: '', href: '/'});
  const input = [item('profit_unknown', 9000000), item('invoice_overdue', 200, 30), item('invoice_overdue', 10000, 18), item('unassigned_costs', 300)];
  const groups = money.groupAttention(input);
  assert.deepEqual(groups.map(g => g.title), ['Unpaid / overdue invoices', 'Unassigned costs', 'Jobs missing a budget']);
  assert.deepEqual(groups[0].items.map(i => i.amountCents), [200, 10000]);
  assert.equal(input[0].kind, 'profit_unknown');
});

import { assembleBudgetView } from '../lib/budget-assemble.ts';
import { KITCHEN_RAW } from '../lib/budget-fixtures.ts';
test('recent partial invoices enter attention with only the remaining balance', () => {
  const raw = structuredClone(KITCHEN_RAW);
  raw.invoices = [{ number: 'PART', milestone: 'Draw', amountCents: 10000, paidCents: 2500, balanceCents: 7500, status: 'partially_paid', createdOn: '2026-10-29', sentOn: '2026-10-29', paidOn: null }];
  const view = assembleBudgetView(raw, { asOf: '2026-10-30' });
  const invoice = money.buildCompanyMoney([view]).attention.find(i => i.kind === 'invoice_unpaid');
  assert.equal(invoice.amountCents, 7500);
  assert.equal(invoice.urgencyDays, 1);
  assert.equal(money.attentionAmountLabel(invoice.kind), 'Unpaid balance');
});
