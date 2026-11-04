import {test} from 'node:test';import assert from 'node:assert/strict';import {consultReadinessGaps} from '../lib/consult/readiness-gaps.ts';
import {readFileSync} from 'node:fs';import {consultScopeFactsV1Schema} from '../lib/consult/scope-facts-schema.ts';
test('shared v1 fixture drives exact readiness gap codes without financials or URLs',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/consult-scope-facts/v1.json',import.meta.url)));
 const f=consultScopeFactsV1Schema.parse(fixture.reviewed);
 assert.deepEqual(consultReadinessGaps(f,'2026-11-02').map(g=>g.kind),['flag_sub_must_look','rrp_cert_missing']);
 assert.ok(consultReadinessGaps(fixture.unreviewed).some(g=>g.kind==='consult_not_complete'));
 assert.ok(consultReadinessGaps(fixture.conflicted).some(g=>g.kind==='consult_conflict'));
 assert.deepEqual(consultReadinessGaps(fixture.none),[]);
});
