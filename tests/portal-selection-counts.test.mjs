import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const root = new URL('../', import.meta.url);
globalThis.__portalQuery = async sql => {
 if (sql.includes('FROM project_selections s')) return {rows:[
  {id:1,section_id:null,area:'Tile',status:'pending',allowance:100},
  {id:2,section_id:null,area:'Paint',status:'declined',allowance:200},
  {id:3,section_id:null,area:'Sink',status:'approved',allowance:300},
 ]};
 return {rows:[]};
};
registerHooks({
 resolve(s,c,n){if(s==='./db')return {url:'stub:db',shortCircuit:true};return n(s,c);},
 load(u,c,n){if(u==='stub:db')return {format:'module',source:'export const query=(...a)=>globalThis.__portalQuery(...a);',shortCircuit:true};return n(u,c);}
});
const {getClientSelections,getProjectSelections}=await import('../lib/selections.ts');
test('client decision count includes only pending selections; declined options wait on Joe',async()=>{
 const view=await getClientSelections('zz-qa');
 assert.equal(view.totalOpen,1);
 assert.equal(view.totalDecisions,3);
 assert.equal(view.groups[0].openCount,1);
 assert.equal(view.totalProposed,100);
});

test('owner still sees declined decisions as open work to follow up',async()=>{
 const view=await getProjectSelections('zz-qa');
 assert.equal(view.totalOpen,2);
});
