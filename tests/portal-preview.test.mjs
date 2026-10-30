import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({
 resolve(s,c,n) { const stubs = {'next/headers':'cookies','./db':'db','./dal':'dal'}; return stubs[s] ? {url:`stub:preview-${stubs[s]}`,shortCircuit:true} : n(s,c); },
 load(u,c,n) {
  const sources={
   'stub:preview-cookies':'export const cookies=async()=>({get:()=>globalThis.__previewCookie ? {value:globalThis.__previewCookie} : undefined});',
   'stub:preview-db':'export const query=async()=>({rows:[]}); export const queryOne=async(sql,args)=>args[0]==="real-job"?{slug:"real-job"}:null;',
   'stub:preview-dal':'export const requireRole=async()=>globalThis.__previewUser;',
  };
  return sources[u] ? {format:'module',source:sources[u],shortCircuit:true} : n(u,c);
 }
});
const { portalScope } = await import('../lib/client-portal.ts');
test('owner preview uses a validated existing project, without changing client identity', async()=>{
 globalThis.__previewUser={role:'owner'};
 globalThis.__previewCookie='real-job';
 assert.deepEqual(await portalScope(),{kind:'project',slug:'real-job'});
 globalThis.__previewCookie='missing-job'; assert.equal(await portalScope(),null);
 globalThis.__previewCookie=''; assert.equal(await portalScope(),null);
});
test('client scope always ignores owner preview cookies',async()=>{
 globalThis.__previewUser={role:'client',linkSlug:'own-job'};
 globalThis.__previewCookie='real-job';
 assert.deepEqual(await portalScope(),{kind:'project',slug:'own-job'});
 globalThis.__previewUser.linkSlug='lead:own-lead';
 assert.deepEqual(await portalScope(),{kind:'lead',slug:'own-lead'});
});
