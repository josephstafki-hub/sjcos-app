import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTemplateModules} from '../lib/consult/template-merge.ts';
import {templates} from '../lib/consult/forms/seed.ts';
import {rrpFacts} from '../lib/consult/rrp.ts';
import {visitTiming} from '../lib/consult/ui/words.ts';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {getReady} from '../lib/consult/get-ready.ts';
test('bath and kitchen merge requirements, area counts and both selections',()=>{
 const merged=mergeTemplateModules(templates.filter(t=>['bath','kitchen'].includes(t.key)));
 const by=key=>merged.find(m=>m.module===key);
 assert.equal(by('panel').required,true);assert.equal(by('room').min,2);assert.equal(by('plumb_fixture').min,3);
 assert.equal(by('selections').presets.length,30);
 assert.ok(by('selections').presets.some(p=>p.decision==='Bath — Sink'));
 assert.ok(by('selections').presets.some(p=>p.decision==='Kitchen — Sink'));
 const basement=mergeTemplateModules(templates.filter(t=>t.key==='basement'),{'basement_scope.rooms_wanted':['Bath']});
 assert.equal(basement.find(m=>m.module==='selections').presets.length,21);
});
test('RRP uses disturbance, receipt and expiry facts',()=>{
 const v={'house.year_built':1950,'era.disturbs_paint':false,'era.window_door_replacement':false};
 assert.equal(rrpFacts(v,false,'2026-11-03').applies,false);
 v['era.window_door_replacement']=true;v['era.pamphlet_given']=false;v['era.firm_cert_expiry']='2026-11-02';v['era.renovator_expiry']='2027-01-01';
 assert.deepEqual(rrpFacts(v,true,'2026-11-03'),{applies:true,receipt:false,firm_current:false,renovator_current:true});
 v['era.pamphlet_given']=true;assert.equal(rrpFacts(v,false,'2026-11-03').receipt,false);
 assert.equal(rrpFacts(v,true,'2026-11-03','2028-01-01').renovator_current,false);
});
test('PIN rejects before any network or storage work',async()=>{
 let calls=0;const r=await getReady({pin:'1234',request:()=>{calls++;throw Error('called');},onCheck:()=>{}});
 assert.equal(r.code,'pin_invalid');assert.equal(calls,0);
 const c=new VisitController(null,'x');await c.getReady('1234');assert.equal(c.getState().ready.code,'pin_invalid');
});
test('controller lock, expiry and denial clear all decrypted references',async()=>{
 const c=new VisitController(null,'x');const privateState={local:{snapshot:{secret:1}},fresh:{secret:1},draft:{secret:1},boot:{secret:1},thumbs:{}};
 Object.assign(c.state,privateState);c.lock();assert.equal(c.getState().fresh,null);assert.equal(c.getState().boot,null);assert.equal(c.snapshot(),null);
 Object.assign(c.state,privateState);c.lease={expires_at:Date.now()-1};assert.equal(c.getState().local,null);
 Object.assign(c.state,privateState);globalThis.fetch=async()=>new Response('',{status:403});await c.refresh();assert.equal(c.getState().phase,'blocked');assert.equal(c.snapshot(),null);
});
test('duration sums hours and exposes split as separate data',()=>{assert.equal(visitTiming(['bath','kitchen']).duration,'3½–4 hours');assert.equal(visitTiming(['bath','kitchen']).suggestSplit,true);assert.equal(visitTiming([]).duration,'');assert.match(visitTiming(['whole']).duration,/two scheduled visits/);assert.deepEqual(visitTiming(['kitchen','flooring']).minutes,[150,150]);});

import {seedModules,derivationCases} from '../lib/consult/forms/seed.ts';
import {compileCondition} from '../lib/consult/forms/conditions.ts';
test('flags trigger on adverse facts and deep wells require ladders',()=>{
 const known=new Set(seedModules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`])));
 const fires=(module,key,values)=>compileCondition(seedModules.find(m=>m.key===module).fields.find(f=>f.key===key).flag.when,known)(values);
 assert.equal(fires('water','main_stack',{main_stack:'Cast iron',stack_cracks:false}),false);
 assert.equal(fires('water','main_stack',{main_stack:'Cast iron',stack_cracks:true}),true);
 assert.equal(fires('basement_scope','water_ever',{water_ever:false}),false);
 assert.equal(fires('garage','separation',{separation:'In place'}),false);
 assert.equal(fires('basement_scope','rim_insulated',{rim_insulated:true}),false);
 assert.equal(fires('era','pamphlet_given',{pamphlet_given:false}),true);
 assert.equal(fires('footing','footing_type',{footing_type:'Poured piers',required_depth:36}),true);
 const cases=derivationCases.find(d=>d.key==='egress.result').cases;
 const values={existing_window:true,clear_width:24,clear_height:36,clear_area:6,floor_to_sill:36,grade_class:'Below-grade',well_width:36,well_projection:36,well_area:9,well_depth:60,well_ladder:false};
 const result=()=>cases.find(c=>compileCondition(c.when,known)(values)).value;
 assert.equal(result(),'New egress needed');values.well_ladder=true;assert.equal(result(),'Meets egress');
});
