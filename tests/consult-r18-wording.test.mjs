import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedModules} from '../lib/consult/forms/seed.ts';

const era=seedModules.find(m=>m.key==='era');
const plan=era.fields.find(f=>f.key==='lead_plan');
const question=era.fields.find(f=>f.key==='lead_test_negative');

test('R18-1: the lead flag sends the visitor to Before you wrap only after the on-screen ways out, and the generic tail is not repeated', () => {
 assert.match(plan.flag.hint,/answer Yes just below if a test showed no lead\. If not, decide it in Before you wrap\.$/);
 assert.ok(plan.flag.hint.length<=180,String(plan.flag.hint.length));
 const row=readFileSync(new URL('../components/consult/field/FieldRow.tsx',import.meta.url),'utf8');
 assert.match(row,/fl\.hint\.includes\(W\.beforeYouWrap\) \? "" : ` \$\{W\.advisoryTail\}`/);
});

test('R18 domain 1: the test hint excludes home inspections and homeowner tests', () => {
 assert.match(question.hint,/licensed lead inspector’s or risk assessor’s report \(not a home inspection\)/);
 assert.match(question.hint,/A test the homeowner did doesn’t count\./);
 assert.doesNotMatch(question.hint,/store kit/);
});

test('R18 domain 2: Lead: plan says where a test done at the visit goes', () => {
 assert.equal(plan.hint,'Test kit or Lab test means we still have to test: price lead-safe work until the result is in. Tested today and no lead on every surface? Pick Not needed. Lead found? Pick Assume lead present.');
});
