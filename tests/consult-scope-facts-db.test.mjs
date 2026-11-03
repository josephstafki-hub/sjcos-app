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

test('v1 export includes every visit and maps seed permit names and live trade task status',async()=>{
 const {secondFindingsVisit}=await import('./_harness/consult-findings.mjs');
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c),run=async(sql,args)=>(await c.query(sql,args)).rows;await f.save();await f.close();
  const second=await secondFindingsVisit(c,f);
  let facts=await consultScopeFacts(run,f.project,'flooring.install');assert.equal(facts.measurements[0].value,300);assert.equal(facts.measurements[0].instance_ids.length,3);
  await c.query("UPDATE consult_close_evidence SET evidence=jsonb_set(evidence,'{trade_walks}','[{\"trade\":\"Flooring\",\"needed\":true,\"reason\":\"check\"}]') WHERE consult_id=$1",[second.id]);
  await c.query("INSERT INTO work_items(title,source_kind,source_id,status) VALUES('Walk','consult',$1,'done')",[`${second.id}:trade:Flooring`]);
  facts=await consultScopeFacts(run,f.project,'flooring.install');assert.equal(facts.trade_walks[0].status,'done');assert.ok(facts.trade_walks[0].work_item_id);
 },{fresh:true});
});

test('DB export supplies flags, assumptions, exclusions, explicit new-work origin, permits and RRP to readiness',async()=>{
 const {randomUUID}=await import('node:crypto');const {publish}=await import('../lib/consult/protocol.ts');const {consultReadinessGaps}=await import('../lib/consult/readiness-gaps.ts');
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c),run=async(sql,args)=>(await c.query(sql,args)).rows;
  const fields=[
   {key:'condition',label:'Condition',type:'text',maps_to:{scope_key:'flooring.install',kind:'observation'},flag:{when:{field:'condition',op:'answered'},issue:'Sub must inspect'}},
   {key:'supplier',label:'Supplier measure',type:'text',maps_to:{scope_key:'flooring.install',kind:'observation'}},
   {key:'risk',label:'Risk',type:'text',maps_to:{scope_key:'flooring.install',kind:'observation'}},
   {key:'addition',label:'Additional work',type:'text',maps_to:{scope_key:'flooring.install',kind:'new_work'}}
  ].map(f=>({...f,required:false,tier:'record'}));
  const definitions=[{key:'facts',fields},{key:'house',fields:[{key:'permit_city',type:'text'},{key:'permit_building_inspector',type:'text'},{key:'permit_electrical',type:'text'},{key:'year_built',type:'year'}].map(f=>({...f,label:f.key,required:false,tier:'record'}))},{key:'era',fields:[{key:'disturbs_paint',type:'yesno'},{key:'firm_cert_number',type:'text'},{key:'renovator_cert',type:'text'},{key:'renovator_expiry',type:'date'}].map(f=>({...f,label:f.key,required:false,tier:'record'}))}];
  let factsId;
  for(const d of definitions){
   const definition={...d,version:1,title:d.key,repeatable:false,say:[],shots:[],coverage:[]};
   const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module',$1,1,$2,'',$3) RETURNING id",[d.key,definition,f.owner])).rows[0].id;
   const registry=(await c.query('SELECT id FROM consult_mapping_registries WHERE version=2')).rows[0].id;await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:registry});
   await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
   const instance_id=randomUUID();if(d.key==='facts')factsId=instance_id;
   await f.send([f.op('create_instance',{},await f.revision(),{instance_id,module_key:d.key,label:d.key})]);
   const data=d.key==='facts'?{condition:'Wet floor',supplier:null,risk:null,addition:{origin:'found_condition_required',text:'Repair damaged substrate'}}:d.key==='house'?{permit_city:'City',permit_building_inspector:'Inspector',permit_electrical:'DLI',year_built:1960}:{disturbs_paint:false,firm_cert_number:'firm',renovator_cert:'renovator',renovator_expiry:'2020-01-01'};
   for(const [field_key,value] of Object.entries(data))await f.send([f.op('answer',value===null?{status:'skipped',skip_reason:field_key==='supplier'?'Sub/supplier will measure':'No access'}:{status:'answered',value},0,{instance_id,field_key})]);
  }
  await f.save({...f.evidence,flags:{[`${factsId}:condition`]:{disposition:'sub_must_look',note:'Flooring sub to inspect'}},skips:{[`${factsId}:risk`]:{reason:'No access',assumption:{text:'Assume dry',responsible_trade:'Flooring',verification_point:'Before ordering',adjustment_route:'precon_change',quantity:null,unit:null,exclusion:null}}}});
  assert.equal((await f.close()).complete,true);
  const facts=await consultScopeFacts(run,f.project,'flooring.install');assert.equal(facts.state,'reviewed');assert.equal(facts.flags[0].disposition,'sub_must_look');assert.equal(facts.assumptions[0].verification_point,'Before ordering');assert.match(facts.exclusions[0].text,/Field measure by supplier/);assert.equal(facts.new_work[0].origin,'found_condition_required');assert.equal(facts.permits.electrical_inspector,'dli');assert.equal(facts.permits.building_inspector,'Inspector');
  const codes=consultReadinessGaps(facts).map(g=>g.kind);for(const code of ['flag_sub_must_look','assumption_to_verify','rrp_cert_missing'])assert.ok(codes.includes(code),code);
 },{fresh:true});
});

test('pinned cross-module arithmetic tracks every source and refuses missing or ambiguous dimensions',async()=>{
 const {pinnedDerivations}=await import('../lib/consult/derive.ts');
 const modules=[{key:'room',fields:[{key:'length',unit:'in'},{key:'width',unit:'in'},{key:'floor_area',unit:'sf',derive:'length*width/144'}]}];
 const instances=[{id:'a',module_key:'room'},{id:'b',module_key:'room'}];
 const answers=instances.flatMap((i,n)=>['length','width'].map((field_key,k)=>({id:`${n}:${k}`,instance_id:i.id,field_key,status:'answered',value:120,server_revision:String(n*2+k+1)})));
 const templates=[{derived:[{key:'total',formula:'room.floor_area'}]}];
 const p=pinnedDerivations(modules,templates,instances,answers);assert.equal(p.derived[0].result.value,200);assert.deepEqual(p.derived[0].result.answer_revisions,[1,2,3,4]);
 assert.equal(pinnedDerivations(modules,templates,instances,answers.slice(1)).derived[0].result,null);
 assert.equal(pinnedDerivations(modules,[{derived:[{key:'bad',formula:'room.length'}]}],instances,answers).derived[0].result,null);
});
