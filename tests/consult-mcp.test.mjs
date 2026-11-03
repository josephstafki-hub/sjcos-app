import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {consultToolSchemas,registerConsultTools} from '../mcp/consult-tools.mjs';
import {withTestDb} from './_harness/testdb.mjs';import {fixture} from './_harness/consult.mjs';import {proposeConsultAnswers} from '../lib/consult/proposals.ts';
test('MCP registers once, strict schemas refuse actor/source; bridge only proposes',async()=>{
 const handlers=new Map();registerConsultTools({registerTool:(name,_meta,fn)=>{assert.ok(!handlers.has(name));handlers.set(name,fn);}},{json:x=>x,consultCall:async(name,input)=>({ok:true,data:{name,input}})});
 assert.equal(handlers.size,10);assert.equal(consultToolSchemas.record_consult_answers.safeParse({consult_id:randomUUID(),operation_id:randomUUID(),actor:randomUUID(),answers:[]}).success,false);
 assert.equal((await handlers.get('get_consult')({consult_id:randomUUID()})).ok,true);
});
test('agent proposals do not alter answers; person uses the exact proposal once',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await fixture(c);const input={consult_id:f.consult,operation_id:randomUUID(),answers:[{instance_id:f.instance,field_key:'length',base_revision:0,value:120,unit:'in',source_note:'Client supplied dimension; confirm on site'}]};
  const r=await proposeConsultAnswers(c,f.context('propose_answers'),input);assert.equal(r[0].status,'suggested');assert.deepEqual(await proposeConsultAnswers(c,f.context('propose_answers'),input),r);
  assert.equal((await c.query('SELECT * FROM consult_answers WHERE consult_id=$1',[f.consult])).rowCount,0);
  const op=f.op();const accepted=await f.run('proposal_decision',{proposal_id:r[0].proposal_id,action:'use',op});assert.equal(accepted.status,'used');
  assert.equal((await c.query('SELECT * FROM consult_answers WHERE consult_id=$1',[f.consult])).rowCount,1);
  assert.equal((await f.run('proposal_decision',{proposal_id:r[0].proposal_id,action:'use',op})).status,'used');
 },{fresh:true});
});
