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

test('staff-crafted lead portal send is denied before its action runs', async () => {
  let invoked=false;
  const actions={post:defineAction({area:'leads',ownerOnly:true,input:z.object({body:z.string()}),run:async()=>{invoked=true;}})};
  const response=await call('post',{body:'Hello'},{...staff,permissions:['leads','projects']},actions);
  assert.equal(response.status,403);assert.equal(invoked,false);
});
test('lead create navigation result survives the dispatcher',async()=>{
 const actions={create:defineAction({area:'leads',input:z.object({name:z.string(),phone:z.string().optional(),email:z.string().optional(),address:z.string().optional()}).strict(),run:async()=>({slug:'new-lead',redirect:'/leads/new-lead'})})};
 const response=await call('create',{name:'Client',phone:'555',email:'client@example.com',address:'Main St'},owner,actions);
 assert.deepEqual(await response.json(),{ok:true,result:{slug:'new-lead',redirect:'/leads/new-lead'}});
});

test('durable safety request retries run once, report pending and replay completion',async()=>{
 const {safetyOperation}=await import('../lib/mobile-rpc/safety-operation.ts');
 const {randomUUID,createHash}=await import('node:crypto');
 const {rm}=await import('node:fs/promises');
 const id=randomUUID(),user='mobile-test';let calls=0,finish;
 const barrier=new Promise(resolve=>{finish=resolve;});
 const run=async()=>{calls++;await barrier;return {ok:true};};
 const file=`drafts/mobile-safety-operations/${createHash('sha256').update(`${user}:${id}`).digest('hex')}.json`;
 try {
  // Wait until the first operation has entered its callback, after journaling.
  let entered;const ready=new Promise(resolve=>{entered=resolve;});
  const first=safetyOperation(user,id,{slug:'test'},async()=>{entered();return run();});
  await ready;
  assert.equal((await safetyOperation(user,id,{slug:'test'},run)).status,'pending');
  finish();const result=await first;
  assert.equal(result.status,'completed');
  assert.deepEqual(await safetyOperation(user,id,{slug:'test'},run),result);
  await assert.rejects(safetyOperation(user,id,{slug:'different'},run),/different report details/);
  assert.equal(calls,1);
 } finally {finish();await rm(file,{force:true});}
});
