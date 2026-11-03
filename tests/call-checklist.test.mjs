import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COVERAGE_MARKS,validateEvidence,safeRevision} from '../lib/checklist-coverage/contract.ts';
import {validateManualOperation,checklistSummary} from '../lib/checklist-coverage/manual.ts';
const defaults=JSON.parse(readFileSync(new URL('../lib/checklist-coverage/defaults.json',import.meta.url)));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/checklist-coverage/contract-v3/late-instances.json',import.meta.url)));
test('all 13 exact rows enabled; canonical word sets',()=>{
 assert.deepEqual(defaults.map(i=>i.key),['work','budget','timeline','address','contact','who_decides','found_us','other_bids','years_staying','next_step','photos_request','property','paying']);
 assert.equal(defaults.filter(i=>i.enabled).length,13);assert.equal(defaults.filter(i=>i.optional).length,4);
 assert.deepEqual(COVERAGE_MARKS.coverage.partial,['◐','Partly']);assert.deepEqual(COVERAGE_MARKS.ready.not_yet,['○','Not yet']);
 assert.equal(defaults[10].fact_target,null);
});
test('manual tick without value allowed; N/A needs a reason; unsafe revisions refused',()=>{
 const input={session_id:crypto.randomUUID(),item_id:crypto.randomUUID(),operation_id:crypto.randomUUID(),expected_revision:0,state:'covered',value:null,reason:null};
 validateManualOperation(input);assert.throws(()=>validateManualOperation({...input,state:'not_applicable'}));
 assert.throws(()=>safeRevision(Number.MAX_SAFE_INTEGER+1));
 assert.equal(checklistSummary({rows:[{coverage:{state:'covered'}}]}).counts.covered,1);
});
test('v3 evidence bound to exact source revision, session and timing; corrected evidence invalid',()=>{
 validateEvidence(fixture.evidence,fixture.session_id,[fixture.segment]);
 assert.throws(()=>validateEvidence({...fixture.evidence,start_ms:0},fixture.session_id,[fixture.segment]));
 assert.throws(()=>validateEvidence(fixture.evidence,crypto.randomUUID(),[fixture.segment]));
 assert.throws(()=>validateEvidence(fixture.evidence,fixture.session_id,[fixture.segment,{...fixture.segment,id:crypto.randomUUID(),revision:2,supersedes_id:fixture.segment.id}]));
 assert.throws(()=>validateEvidence(fixture.evidence,fixture.session_id,[{...fixture.segment,text:'',cleared_at:new Date().toISOString()}]));
});

test('same shared v3 validator admits late repeated instances and rejects wrong pinned versions',async()=>{
 const {validateV3}=await import('../lib/checklist-coverage/contract.ts');
 const f=fixture;
 const input={contract_version:3,version:{id:f.definition_version_id,definition_key:'consult:bath',kind:'in_home_consult',version:1,contract_version:3,items:[{id:f.definition_item_id}],wrap_up_phrases:[]},session:{id:f.session_id,kind:'in_home_consult',mode:'consult',consent:'granted',started_at:'2026-11-02T16:00:00Z',capture_origin_at:'2026-11-02T16:00:00Z',revision:1,capture_epoch:0,prior:{}},items:f.late_items.map(i=>({...i,session_id:f.session_id,definition_version_id:f.definition_version_id,definition_item_id:f.definition_item_id})),coverage:[],segments:[f.segment],cursor_seq:0,evaluate_at:'section_leave',section_key:'bath',now:'2026-11-02T16:00:02Z'};
 validateV3(input);
 assert.throws(()=>validateV3({...input,items:[{...input.items[0],definition_version_id:crypto.randomUUID()}]}));
 assert.throws(()=>validateV3({...input,session:{...input.session,kind:'discovery_call'}}));
});
