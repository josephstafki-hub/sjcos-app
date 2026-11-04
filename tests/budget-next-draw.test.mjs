import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const root = new URL('../', import.meta.url);
const ledger = { totalCents: 150005, collectedCents: 20000, estimateId: 42 };
globalThis.__drawQA = { view: { jobMoney: ledger }, schedule: [], calls: [] };
const stubs = {
  'server-only': 'export {};',
  '@/lib/db': 'export const query=async (sql,params)=>{globalThis.__drawQA.calls.push({sql,params});return {rows:[{total:100001,draw_schedule:globalThis.__drawQA.schedule}]};};',
  '@/lib/budget-assemble': 'export const assembleBudgetView=()=>structuredClone(globalThis.__drawQA.view);',
  '@/lib/budget-company': 'export const buildCompanyMoney=()=>{};',
  '@/lib/budget-queries': 'export const todayCentral=()=>"2026-10-30";export const findProjects=async()=>[{id:"qa-project"}];export const loadRawProjectMoney=async()=>new Map([["qa-project",{}]]);',
};
registerHooks({
  resolve(s,c,next) {
    if (Object.hasOwn(stubs,s)) return {url:'draw-stub:'+s,shortCircuit:true};
    if (s.startsWith('@/')) return next(new URL(s.slice(2)+'.ts',root).href,c);
    return next(s,c);
  },
  load(u,c,next) { return u.startsWith('draw-stub:') ? {format:'module',source:stubs[u.slice(10)],shortCircuit:true} : next(u,c); },
});
const {getProjectBudget}=await import('../lib/budget.ts');
test('next draw uses the ledger estimate, skips billed/zero milestones and rounds cents',async()=>{
  globalThis.__drawQA.schedule=[{label:'Deposit',percent:50,billed:true},{label:'Skipped',percent:0},{label:'Rough-in',percent:16.67},{label:'Final',percent:33.33}];
  const view=await getProjectBudget('zz-qa');
  assert.deepEqual(view.nextDraw,{label:'Rough-in',amountCents:16670});
  assert.deepEqual(view.jobMoney,ledger,'schedule must not replace the authoritative ledger');
  assert.deepEqual(globalThis.__drawQA.calls.at(-1).params,[42]);
});
test('a missing or fully billed draw schedule does not invent a next payment',async()=>{
  for (const schedule of [null,[],[{label:'Deposit',percent:100,billed:true}]]) {
    globalThis.__drawQA.schedule=schedule;
    assert.equal((await getProjectBudget('zz-qa')).nextDraw,null);
  }
});
