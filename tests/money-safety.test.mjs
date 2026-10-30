import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import pg from 'pg';

// Fixed, isolated QA target. Never reads DATABASE_URL or starts another cluster.
const client = new pg.Client({ connectionString: 'postgresql://sjcos:qa@localhost:5499/sjcos' });
const run = async (sql, params) => (await client.query(sql, params)).rows;
const root = new URL('../', import.meta.url);
const lib = p => new URL(`lib/${p}.ts`, root).href;
const user = { id: 'c03946ca-cfbb-4e21-83de-a277b6334045', role: 'owner', name: 'ZZ QA owner', permissions: [] };
const principal = { kind: 'user', userId: user.id, role: 'owner', name: user.name, permissions: [] };
globalThis.__moneyQA = {
  query: async (sql, params) => client.query(sql, params),
  queryOne: async (sql, params) => (await globalThis.__moneyQA.query(sql, params)).rows[0] ?? null,
  withTransaction: async fn => {
    await client.query('SAVEPOINT money_op');
    try { const r = await fn(run); await client.query('RELEASE SAVEPOINT money_op'); return r; }
    catch (e) { await client.query('ROLLBACK TO SAVEPOINT money_op'); throw e; }
  },
};
const forward = (...names) => names.map(n => `export const ${n} = (...a) => globalThis.__moneyQA.${n}(...a);`).join('\n');
const stubs = {
  'server-only': 'export {};',
  'next/cache': 'export const revalidatePath = () => {};',
  [lib('db')]: forward('query', 'queryOne'),
  [lib('commands/db')]: forward('withTransaction') + '\nexport const userPrincipal = () => (' + JSON.stringify(principal) + ');',
  [lib('dal')]: `export const requireAccess = async () => (${JSON.stringify(user)});`,
  [lib('ai')]: 'export const ai = {};',
  [lib('notify')]: 'export const emit = async () => {};',
  [lib('send-ops')]: 'export const sendInvoiceOp = async () => { throw new Error("No sends in QA tests"); };',
  [lib('documents')]: 'export const renderInlineDocPdf = async () => null; export const drawAmount = () => 0; export const gatherDocData = async () => ({}); export const getCompanyDocInfo = async () => ({});',
};
registerHooks({
  resolve(s, c, next) {
    let url = s.startsWith('@/') ? new URL(`${s.slice(2)}.ts`, root).href : s;
    if (/^\.\.?\//.test(s) && !/\.[cm]?[jt]s$/.test(s) && c.parentURL?.endsWith('.ts')) url = new URL(`${s}.ts`, c.parentURL).href;
    return Object.hasOwn(stubs, url) ? { url: `stub:${url}`, shortCircuit: true } : next(url, c);
  },
  load(url, c, next) { return url.startsWith('stub:') ? { format: 'module', source: stubs[url.slice(5)], shortCircuit: true } : next(url, c); },
});
const money = await import('../lib/actions/money.ts');
const billing = await import('../lib/billing/core.ts');
const { resolveEstimateLineFields } = await import('../lib/doc-templates/fill.ts');
const { registerBillingTools } = await import('../mcp/billing-tools.mjs');

before(async () => client.connect());
after(async () => client.end());
beforeEach(async () => client.query('BEGIN'));
afterEach(async () => client.query('ROLLBACK'));
async function draft() {
  assert.equal((await money.createInvoice('larson-remodel', { milestone: 'ZZ QA money safety', mode: 'blank' })).ok, true);
  const [i] = await run("SELECT id::int FROM invoices WHERE milestone = 'ZZ QA money safety' ORDER BY id DESC LIMIT 1");
  return i.id;
}
function toolsFor(register) {
  const tools = new Map();
  const query = async (sql, params) => {
    if (sql === 'BEGIN') return client.query('SAVEPOINT mcp_op');
    if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT mcp_op');
    if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT mcp_op');
    return client.query(sql, params);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  register({ registerTool: (n,s,f) => tools.set(n,{s,f}) }, { rows: run, json: x => x, pool, strippedDollarError: () => null, slugToId: async (_,slug) => (await run('SELECT id FROM projects WHERE slug=$1',[slug]))[0]?.id, currentPrincipal: async () => ({ userId: user.id, role: 'owner', active: true }) });
  return tools;
}

test('invoice credits persist exactly as previewed through the UI action', async () => {
  const id = await draft();
  const r = await money.updateInvoice(id, { milestone: 'ZZ QA credit', lines: [{ label:'Charge',amount:150050 },{label:'Credit',amount:-20000}] });
  assert.equal(r.ok,true);
  const [inv] = await run('SELECT amount,line_items FROM invoices WHERE id=$1',[id]);
  assert.equal(inv.amount,130050);
  assert.equal(inv.line_items[1].amount,-20000);
});
test('invalid invoice amounts are refused without replacing the saved lines', async () => {
  const id = await draft();
  for (const amount of [NaN, Infinity, 'oops', -100]) {
    assert.equal((await money.updateInvoice(id,{milestone:'ZZ QA bad',lines:[{label:'Bad',amount}]})).ok,false);
  }
  assert.equal((await run('SELECT amount FROM invoices WHERE id=$1',[id]))[0].amount,0);
});
test('PDF subtotal equals the sum of the displayed client prices, including markup and credits',async () => {
  const fields = await resolveEstimateLineFields(32);
  const sum = fields.line_items_table.rows.reduce((s,r) => s + Math.round(Number(r[3].replace(/[$,]/g,''))*100),0);
  assert.equal(fields.subtotal,sum);
  assert.equal(fields.total,sum);
});
test('partial payment on a draft uses the ledger; undo is audited, idempotent and restores project collected',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA payment',lines:[{label:'Charge',amount:10000}]});
  const [before] = await run("SELECT collected_cents FROM projects WHERE slug='larson-remodel'");
  assert.equal((await money.recordManualPayment(id,{amountCents:2500,method:'check',receivedAt:'2026-10-30',note:'ZZ QA deposit'})).ok,true);
  const b = await billing.invoiceBalance(run,id); assert.equal(b.balanceCents,7500);
  const [p] = await run("SELECT id::int FROM invoice_payments WHERE invoice_id=$1 AND kind='payment'",[id]);
  assert.equal(Number((await run("SELECT collected_cents FROM projects WHERE slug='larson-remodel'"))[0].collected_cents),Number(before.collected_cents)+2500);
  assert.equal((await money.reverseManualPayment(id,p.id,'ZZ QA mistaken entry')).ok,true);
  assert.equal((await money.reverseManualPayment(id,p.id,'ZZ QA retry')).ok,true);
  assert.equal((await billing.invoiceBalance(run,id)).balanceCents,10000);
  assert.equal(Number((await run("SELECT collected_cents FROM projects WHERE slug='larson-remodel'"))[0].collected_cents),Number(before.collected_cents));
  const reversals = await run("SELECT * FROM invoice_payments WHERE invoice_id=$1 AND kind='return'",[id]);
  assert.equal(reversals.length,1); assert.match(reversals[0].note,/mistaken/);
});
test('MCP draft supports credits and manual payments support partial entry and reversal',async () => {
  const tools = toolsFor(registerBillingTools);
  const create = tools.get('create_invoice_draft');
  assert.equal(create.s.inputSchema.lines.safeParse([{label:'Charge',amount_cents:10000},{label:'Credit',amount_cents:-2000}]).success,true);
  const r = await create.f({project_slug:'larson-remodel',kind:'other',key:'zz-qa-money-safety',milestone:'ZZ QA MCP credit',lines:[{label:'Charge',amount_cents:10000},{label:'Credit',amount_cents:-2000}]});
  assert.equal(r.ok,true); assert.equal(r.amount_cents,8000);
  const paid = await tools.get('record_manual_payment').f({invoice_id:r.invoice_id,amount_cents:2500,method:'check'});
  assert.ok(paid.payment,JSON.stringify(paid));
  const reversed = await tools.get('reverse_manual_payment').f({invoice_id:r.invoice_id,payment_id:paid.payment.id,reason:'ZZ QA mistake'});
  assert.ok(reversed.payment,JSON.stringify(reversed));
  assert.equal((await billing.invoiceBalance(run,r.invoice_id)).balanceCents,8000);
});

test('invoice Paid summary subtracts undone manual payments',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA summary',lines:[{label:'Charge',amount:10000}]});
  const { getProjectMoney } = await import('../lib/money.ts');
  const before = await getProjectMoney('larson-remodel');
  assert.equal((await money.recordManualPayment(id,{amountCents:2500})).ok,true);
  const [p] = await run("SELECT id::int FROM invoice_payments WHERE invoice_id=$1 AND kind='payment'",[id]);
  await money.reverseManualPayment(id,p.id,'ZZ QA correction');
  assert.equal((await getProjectMoney('larson-remodel')).paidTotal,before.paidTotal);
});

test('payment entry validates amounts, blocks overpayment and pending cash, and records a full settlement',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA limits',lines:[{label:'Charge',amount:10000}]});
  for (const amountCents of [0,-1,1.5,NaN,Infinity,10001]) {
    assert.equal((await money.recordManualPayment(id,{amountCents})).ok,false);
  }
  assert.equal((await run('SELECT status FROM invoices WHERE id=$1',[id]))[0].status,'draft');
  assert.equal((await money.markInvoicePaid(id,{method:'cash'})).ok,true);
  assert.equal((await billing.invoiceBalance(run,id)).balanceCents,0);
  const [p] = await run("SELECT id::int FROM invoice_payments WHERE invoice_id=$1 AND kind='payment'",[id]);
  assert.equal((await money.reverseManualPayment(id,p.id,'')).ok,false);
  assert.equal((await money.reverseManualPayment(id,p.id,'ZZ QA correction')).ok,true);
  await billing.recordInvoicePayment(run,{invoiceId:id,kind:'payment',amountCents:2000,method:'ach',provider:'square',providerRef:`ZZ-QA-pending-${id}`,status:'pending',principal});
  assert.equal((await money.recordManualPayment(id,{amountCents:1000})).ok,false);
});
test('undo refuses online payments and payments from another invoice',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA online',lines:[{label:'Charge',amount:10000}]});
  await money.recordManualPayment(id,{amountCents:1000});
  const online = await billing.recordInvoicePayment(run,{invoiceId:id,kind:'payment',amountCents:2000,method:'card',provider:'square',providerRef:`ZZ-QA-online-${id}`,principal});
  assert.equal((await money.reverseManualPayment(id,online.payment.id,'ZZ QA wrong path')).ok,false);
  const otherId = await draft();
  assert.equal((await money.reverseManualPayment(otherId,online.payment.id,'ZZ QA wrong invoice')).ok,false);
  assert.equal((await billing.invoiceBalance(run,id)).balanceCents,7000);
});
test('MCP manual reference retry does not record the payment twice',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA retry',lines:[{label:'Charge',amount:10000}]});
  const tools = toolsFor(registerBillingTools);
  const args = {invoice_id:id,amount_cents:10000,method:'check',reference:`ZZ-QA-ref-${id}`};
  const first = await tools.get('record_manual_payment').f(args);
  const second = await tools.get('record_manual_payment').f(args);
  assert.equal(first.payment.id,second.payment.id);
  assert.equal(second.created,false);
  assert.equal((await billing.invoiceBalance(run,id)).balanceCents,0);
});

test('estimate PDF has no phantom contingency adjustment or instructional scope placeholder',async () => {
  const { estimateDocTemplate } = await import('../lib/doc-templates/estimate-doc.ts');
  const sections = estimateDocTemplate.build({ subtotal:137498,total:137498,contingency:50000 });
  const totals = sections.find(s => s.kind==='info_grid' && s.rows.some(r => r.label==='Estimated Subtotal'));
  assert.equal(totals.rows.length,2,'only line subtotal and total; contingency must be priced as an estimate line');
  assert.doesNotMatch(JSON.stringify(sections),/Brief description of the project scope/);
  assert.equal(estimateDocTemplate.titleFor?.({estimate_kind:'precon_change'}),'Pre-construction Change Estimate');
});

test('MCP exposes payment ids and reversal history so old manual entries have a way out',async () => {
  const id = await draft();
  await money.updateInvoice(id,{milestone:'ZZ QA history',lines:[{label:'Charge',amount:10000}]});
  await money.recordManualPayment(id,{amountCents:2500,method:'cash'});
  const tools = toolsFor(registerBillingTools);
  const history = await tools.get('invoice_payment_history').f({invoice_id:id});
  assert.equal(history.payments.length,1);
  await money.reverseManualPayment(id,history.payments[0].id,'ZZ QA recorded twice');
  const after = await tools.get('invoice_payment_history').f({invoice_id:id});
  assert.deepEqual(after.payments.map(p=>p.kind),['payment','return']);
  const events = await run("SELECT * FROM invoice_events WHERE invoice_id=$1 AND kind='return_settled'",[id]);
  assert.equal(events.length,1);
  assert.match(events[0].actor,/owner/);
});
