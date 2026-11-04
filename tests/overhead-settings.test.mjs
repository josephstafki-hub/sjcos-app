import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileWithExpenses, updateSubscription, DuplicateOverheadError} from '../lib/overhead/overhead.ts';

test('subscription reconciliation gives the owner readable recovery instructions',async()=>{
 const run=async sql=>sql.includes('FROM overhead_subscriptions')?[{id:'1',name:'AI plan',vendor:'Vendor',external_ref:null}]:[];
 const result=await reconcileWithExpenses(run);
 assert.equal(result.lines.length,1);
 assert.match(result.lines[0].note,/bill|QuickBooks/);
 assert.doesNotMatch(result.lines[0].note+' '+result.caveat,/external_ref|no_external_ref/);
 assert.doesNotMatch(new DuplicateOverheadError('this subscription').message,/external_ref|started_on/);
});

test('restoring an ended subscription clears its end date through the shared write path',async()=>{
 let seen;
 const row=await updateSubscription(async(sql,args)=>{seen={sql,args};return [{id:'1',ended_on:null}];},'1',{endedOn:null});
 assert.equal(row.ended_on,null);assert.equal(seen.args[7],'');
 assert.match(seen.sql,/ended_on = CASE WHEN \$8::text = '' THEN NULL/);
});
