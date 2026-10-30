import {test} from 'node:test';import assert from 'node:assert/strict';
test('only confirmed effects count as changes; correlations and input-only activity stay qualified',async()=>{
 const {effectEvidence,visibleChangeFields,workSummary}=await import('../lib/agent-review.ts');
 assert.equal(effectEvidence({source:'hermes-inferred',action:'touched',detail:{}}),'Inferred activity');
 assert.equal(effectEvidence({source:'claude',action:'updated',detail:{}}),'Reported activity');
 assert.equal(effectEvidence({source:'claude',action:'updated',detail:{confirmed:true}}),'Confirmed change');
 assert.deepEqual(visibleChangeFields({before:{status:'draft',access_token:'secret'},after:{status:'sent',access_token:'secret2'}}),[{field:'status',before:'draft',after:'sent'}]);
 assert.equal(workSummary(18,4,12),'Worked for 18s · 4 tools');assert.equal(workSummary(8,null,3),'Worked for 8s · 3 steps');
});
