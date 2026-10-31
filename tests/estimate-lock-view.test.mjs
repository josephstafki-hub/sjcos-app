import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const root = new URL('../', import.meta.url);
const sql = [];
globalThis.__estimateRead = async (query) => {
  sql.push(query);
  return { rows: query.includes('FROM estimates e') ? [{
    id: '42', title: 'ZZ QA offered contract', kind: 'formal', rail: 'plans',
    status: 'draft', lock_state: globalThis.__lockState, subtotal: 10000,
    markup_total: 0, total: 10000, draw_schedule: null, created_at: new Date('2026-10-30'),
  }] : [] };
};
registerHooks({
  resolve(s, c, next) {
    if (s === 'server-only' || (s === './db' && c.parentURL.endsWith('/lib/estimates.ts'))) return { url: 'lock-stub:' + s, shortCircuit: true };
    if (s.startsWith('.') && !/\.[cm]?[jt]s$/.test(s) && c.parentURL?.endsWith('.ts')) return next(new URL(s + '.ts', c.parentURL).href, c);
    return next(s, c);
  },
  load(u, c, next) {
    if (u.startsWith('lock-stub:')) return { format: 'module', source: u.endsWith('server-only') ? 'export {};' : 'export const query=(...args)=>globalThis.__estimateRead(...args); export const queryOne=async()=>null;', shortCircuit: true };
    return next(u, c);
  },
});
const { getProjectEstimates } = await import('../lib/estimates.ts');
test('estimate editor receives the database lock even when only its contract is offered', async () => {
  for (const state of ['sent', 'signed', null]) {
    globalThis.__lockState = state;
    const [estimate] = await getProjectEstimates('zz-qa');
    assert.equal(estimate.lockState, state);
  }
  assert.match(sql[0], /estimate_out_to_client\(e.id\)/);
});
