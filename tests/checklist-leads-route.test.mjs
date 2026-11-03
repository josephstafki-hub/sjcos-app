// GET /api/calls/checklist-leads (the checklist's lead picker): signed-out → 401,
// no Calls access → 403, and neither reaches the search; private, no-store.
// The route runs as written; `can` is the real function from lib/dal.ts; the
// session and the search are stubbed (the search's SQL and returned fields are
// covered against a real database in checklist-lead-search-db.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

const routeUrl = new URL('../app/api/calls/checklist-leads/route.ts', import.meta.url).href;
const dalSource = readFileSync(new URL('../lib/dal.ts', import.meta.url), 'utf8');
const canSource = dalSource.match(/export function can\([\s\S]*?\n}\n/)?.[0];
assert.ok(canSource, 'found can() in lib/dal.ts');

globalThis.__routeFixture = { user: null, searches: [] };
const stubs = {
  '@/lib/dal': `${ts.transpileModule(canSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText}
    export async function getCurrentUser() { return globalThis.__routeFixture.user; }`,
  '@/lib/checklist-lead-search': `export async function searchChecklistLeads(q, phone) {
      globalThis.__routeFixture.searches.push([q, phone]);
      return [{ id: 'l1', name: 'Alex Smith', scope: 'Bath', phone: null, on_call: false }];
    }`,
};
registerHooks({
  resolve(s, c, n) { return c.parentURL === routeUrl && s in stubs ? { url: `stub:route:${s}`, shortCircuit: true } : n(s, c); },
  load(u, c, n) {
    if (u === routeUrl) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(u), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    if (u.startsWith('stub:route:')) return { format: 'module', shortCircuit: true, source: stubs[u.slice('stub:route:'.length)] };
    return n(u, c);
  },
});
const { GET } = await import(routeUrl);
const f = globalThis.__routeFixture;

async function call(user, qs = '?q=Pat&phone=6125550199') {
  f.user = user; f.searches = [];
  const res = await GET(new Request(`http://local.test/api/calls/checklist-leads${qs}`));
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json(), searches: f.searches };
}

test('signed out and no-Calls users are refused before any search', async () => {
  for (const [user, status, code] of [
    [null, 401, 'SIGNED_OUT'],
    [{ role: 'staff', permissions: ['money'] }, 403, 'FORBIDDEN'],
    [{ role: 'client', permissions: [] }, 403, 'FORBIDDEN'],
    [{ role: 'sub', permissions: [] }, 403, 'FORBIDDEN'],
  ]) {
    const r = await call(user);
    assert.equal(r.status, status);
    assert.equal(r.body.code, code);
    assert.equal(r.searches.length, 0, 'no query on denial');
    assert.equal(r.cache, 'private, no-store');
  }
});

test('owner and Calls staff get the picker rows, private and uncached', async () => {
  for (const user of [{ role: 'owner', permissions: [] }, { role: 'staff', permissions: ['comms'] }]) {
    const r = await call(user);
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'private, no-store');
    assert.deepEqual(r.searches, [['Pat', '6125550199']]);
    assert.deepEqual(Object.keys(r.body.leads[0]).sort(), ['id', 'name', 'on_call', 'phone', 'scope']);
  }
  const empty = await call({ role: 'owner', permissions: [] }, '');
  assert.deepEqual(empty.searches, [['', null]], 'no text: Recent leads');
});
