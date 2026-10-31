import {test} from 'node:test';import assert from 'node:assert/strict';
test('approval state distinguishes waiting, expired, denied, used and failed decisions',async()=>{
 const {approvalState,approvalOutcome}=await import('../lib/agent-approval.ts');
 const now=Date.parse('2026-10-30T12:00:00Z');
 assert.equal(approvalState({status:'requested',expiresAt:'2026-10-30T11:00:00Z',uses:0},now),'Expired');
 assert.equal(approvalState({status:'approved',expiresAt:'2026-10-31T12:00:00Z',uses:1},now),'Used');
 assert.equal(approvalState({status:'denied',expiresAt:'2026-10-31T12:00:00Z',uses:0},now),'Denied');
 assert.deepEqual(approvalOutcome({ok:false,error:'Already decided'}),{ok:false,message:'Already decided'});
 assert.deepEqual(approvalOutcome({ok:true,message:'Approved; email could not send'}),{ok:true,message:'Approved; email could not send'});
});
