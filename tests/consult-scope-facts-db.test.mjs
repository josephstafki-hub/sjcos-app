import {readFileSync} from 'node:fs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {withTestDb} from './_harness/testdb.mjs';import {findingsFixture} from './_harness/consult-findings.mjs';
import {consultScopeFacts} from '../lib/consult/findings.ts';import {consultScopeFactsV1Schema} from '../lib/consult/scope-facts-schema.ts';
test('DB v1 export aggregates two rooms and four revisions; staff Complete reaches reviewed without owner action',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c),run=async(sql,args)=>(await c.query(sql,args)).rows;
  const preview=await consultScopeFacts(run,f.project,'flooring.install');assert.equal(preview.state,'unreviewed');assert.equal(preview.measurements[0].value,200);assert.equal(preview.measurements[0].instance_ids.length,2);assert.equal(preview.measurements[0].answer_revisions.length,4);
  await f.save();assert.equal((await f.close()).complete,true);
  const shared=JSON.parse(readFileSync(new URL('./fixtures/consult-scope-facts/v1.json',import.meta.url)));for(const v of Object.values(shared))assert.ok(consultScopeFactsV1Schema.safeParse(v).success);
  const facts=await consultScopeFacts(run,f.project,'flooring.install');assert.equal(facts.state,'reviewed');assert.equal(facts.source_version.review_revision,1);assert.ok(consultScopeFactsV1Schema.safeParse(facts).success);assert.ok(!JSON.stringify(facts).includes('http'));
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correction'});assert.equal((await consultScopeFacts(run,f.project,'flooring.install')).state,'unreviewed');
 },{fresh:true});
});
