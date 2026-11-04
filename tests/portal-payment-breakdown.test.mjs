import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(s,c,n) { if (s === './db') return {url:'stub:portal-db',shortCircuit:true}; return n(s,c); },
  load(u,c,n) { if (u === 'stub:portal-db') return {format:'module',source:'export const queryOne=async()=>globalThis.__portalRow;',shortCircuit:true}; return n(u,c); },
});
const { getPortalFinancials } = await import('../lib/portal-financials.ts');
for (const [name, payments, outside] of [['pre-con and outside payments',4751166,1758000],['refunds',-5000,20000],['no outside payments',12345,0]]) {
 test(name, async () => {
  globalThis.__portalRow = {total_cents:'7000000',collected_cents:String(payments+outside),opening_total_cents:'0',estimate_cents:'7000000',change_orders_cents:'0',precon_cents:'0',payments_cents:String(payments),opening_collected_cents:String(outside)};
  const data = await getPortalFinancials('fixture');
  assert.equal(data.invoicePaidCents, payments);
  assert.equal(data.outsidePaidCents, outside);
  assert.equal(data.invoicePaidCents + data.outsidePaidCents, data.paidCents);
 });
}
test('missing project',async()=>{globalThis.__portalRow=null;assert.equal(await getPortalFinancials('missing'),null);});
