import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){if(s==='./db')return {url:'stub:review-db',shortCircuit:true};return n(s,c);},load(u,c,n){if(u==='stub:review-db')return {format:'module',source:'export const query=async()=>({rows:globalThis.__reviews});',shortCircuit:true};return n(u,c);}});
const {getPortalSignatureReviews}=await import('../lib/portal-signature-review.ts');
test('review preserves document money including zero and credits, without guessing missing amounts',async()=>{
 globalThis.__reviews=[{id:'1',template_version:'2026-09',field_values:{contract_total:0}},{id:'2',template_version:'v2',field_values:{net_change:-12345}},{id:'3',template_version:null,field_values:{}}];
 const reviews=await getPortalSignatureReviews([1,2,3]);
 assert.equal(reviews[1].amountCents,0);assert.equal(reviews[2].amountCents,-12345);assert.equal(reviews[3].amountCents,null);
 assert.equal(reviews[1].version,'2026-09');
});
test('empty scoped requests returns no review data',async()=>{assert.deepEqual(await getPortalSignatureReviews([]),{});});
