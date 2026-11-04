import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const fixtures = [
  {id:'pending',review_status:'pending',can_use_as_instruction:false},
  {id:'rule',review_status:'approved',can_use_as_instruction:true},
  {id:'example',review_status:'approved',can_use_as_instruction:false},
  {id:'rejected',review_status:'rejected',can_use_as_instruction:false},
].map(x=>({...x,summary:x.id,content:'Evidence',memory_type:'lesson',confidence:null,stale_after:null,runtime_name:null,created_at:'2026-10-30',refs:[]}));
globalThis.__memoryQuery = async sql => ({rows:fixtures.filter(x=>sql.includes("review_status = 'pending'") ? x.review_status==='pending' : sql.includes('can_use_as_instruction = true') ? x.review_status==='approved'&&x.can_use_as_instruction : sql.includes('can_use_as_instruction = false') ? x.review_status==='approved'&&!x.can_use_as_instruction : x.review_status==='rejected')});
registerHooks({resolve(s,c,n){if(s==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};if(s==='./db'&&c.parentURL?.endsWith('/memories.ts'))return {url:'data:text/javascript,export const query = globalThis.__memoryQuery;',shortCircuit:true};return n(s,c);}});
const {getMemoriesData}=await import('../lib/memories.ts');
test('every review state stays visible, including approved evidence after revoking a rule',async()=>{
 const data=await getMemoriesData();
 assert.deepEqual(data.pending.map(x=>x.id),['pending']);
 assert.deepEqual(data.instructions.map(x=>x.id),['rule']);
 assert.deepEqual(data.examples.map(x=>x.id),['example']);
 assert.deepEqual(data.history.map(x=>x.id),['rejected']);
});
