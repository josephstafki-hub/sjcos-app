import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { getRedirectError } from 'next/dist/client/components/redirect.js';
import { defineAction, dispatchMobileAction } from '../lib/mobile-rpc/dispatch.ts';

// Exercise the actual dispatcher without Next's request storage or a DB.
const owner = { id: 'owner', role: 'owner', permissions: [] };
const staff = { id: 'staff', role: 'staff', permissions: [] };
const registry = { done: defineAction({ input: z.object({ id: z.uuid() }).strict(), run: async ({ id }) => ({ id }) }) };
const request = body => new Request('http://localhost/api/mobile/rpc/done', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const call = (name, body, user = owner, actions = registry) => dispatchMobileAction(request(body), name, actions, async () => user, () => ['/today']);
test('unknown action returns 404 including inherited object properties', async () => {
  for (const name of ['missing', 'toString', '__proto__']) assert.equal((await call(name, {})).status, 404);
});
test('bad schema and malformed JSON return 400', async () => {
  assert.equal((await call('done', {})).status, 400);
  assert.equal((await call('done', '{')).status, 400);
});
test('no authenticated token returns 401', async () => assert.equal((await call('done', {}, null)).status, 401));
test('staff without area returns 403', async () => assert.equal((await call('done', {}, staff)).status, 403));
test('happy path returns the action result', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const response = await call('done', { id });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result: { id } });
});
test('owner-only gate rejects staff who have Today', async () => {
  const actions = { done: defineAction({ input: z.object({}), ownerOnly: true, run: async () => null }) };
  assert.equal((await call('done', {}, { ...staff, permissions: ['today'] }, actions)).status, 403);
});
test('Next auth redirects become 403; success redirects become JSON', async () => {
  for (const path of ['/login', '/logout', '/today', '/projects/example']) {
    const actions = { done: defineAction({ input: z.object({}), run: async () => { throw getRedirectError(path, 'replace'); } }) };
    const response = await call('done', {}, owner, actions);
    assert.equal(response.status, path === '/projects/example' ? 200 : 403);
    if (response.status === 200) assert.deepEqual(await response.json(), { ok: true, redirect: path });
  }
});
test('returned action refusal becomes 400', async () => {
  const actions = { done: defineAction({ input: z.object({}), run: async () => ({ ok: false, error: 'Changed since preview.' }) }) };
  const response = await call('done', {}, owner, actions);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Changed since preview.' });
});
