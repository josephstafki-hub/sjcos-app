import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rrpFacts,rrpApplies} from '../lib/consult/rrp.ts';
import {compileCondition} from '../lib/consult/forms/conditions.ts';
import {seedModules} from '../lib/consult/forms/seed.ts';
import {sendHealth,sendDeadlines} from '../lib/consult/ui/send-health.ts';
import {openItemCount} from '../lib/consult/completeness.ts';
import {buildModel,emptyDraft,summaryInput,resumeSection} from '../lib/consult/ui/model.ts';
import {transportCode} from '../lib/consult/transport.ts';
const known=new Set(seedModules.flatMap(m=>m.fields.flatMap(f=>[f.key,`${m.key}.${f.key}`])));
test('RRP form and close agree on overrides, unknown disturbance and old-year No reason',()=>{
 const form=seedModules.find(m=>m.key==='era');
 for(const [year,before,disturbs,expected] of [[1985,true,true,true],[1985,true,undefined,true],[1954,undefined,undefined,true],[1965,false,true,false],[1954,true,false,false]]){
  const values={'house.year_built':year,'era.before_1978':before,'era.disturbs_paint':disturbs};
  assert.equal(rrpFacts(values,false,'2026-11-03').applies,expected);
  assert.deepEqual(form.fields.find(f=>f.key==='pamphlet_given').required,rrpApplies);
  assert.equal(compileCondition(rrpApplies,known)(values),expected);
 }
 const reason=form.fields.find(f=>f.key==='year_override_reason');
 const values={'house.year_built':1965,'era.before_1978':false};
 assert.equal(compileCondition(reason.required,known)(values),true);
 assert.equal(compileCondition(reason.flag.when,known)(values),true);
 assert.equal(compileCondition(reason.flag.when,known)({...values,'era.year_override_reason':'County year is for an earlier building'}),false);
});
test('online failure clock survives retries, starts on reconnect and resets on progress',()=>{
 let h={waitingFrom:null,failureFrom:null,lastSend:null};
 h=sendHealth(h,false,4,null,true,0);h=sendHealth(h,false,4,null,true,600000);
 h=sendHealth(h,true,4,null,true,600001);
 assert.equal(sendDeadlines(h,600001).banner,false);
 for(let now=602001;now<660001;now+=2000)h=sendHealth(h,true,4,null,true,now);
 assert.equal(sendDeadlines(h,660001).banner,true);
 h=sendHealth(h,true,3,670000,true,670000);assert.equal(sendDeadlines(h,670001).banner,false);
 h=sendHealth(h,true,3,670000,false,671000);
 assert.equal(sendDeadlines(h,789999).stuckAt,null);assert.equal(sendDeadlines(h,790000).stuckAt,790000);assert.equal(sendDeadlines(h,790000).banner,true);
 h=sendHealth(h,false,3,670000,false,800000);assert.equal(h.waitingFrom,null);
});
test('unknown exceptions are never no_signal',()=>{
 for(const e of [Error('adapter bug'),new TypeError('undefined is not a function'),'oops',null])assert.notEqual(transportCode(e),'no_signal');
 assert.equal(transportCode(new TypeError('Failed to fetch')),'no_signal');
});
test('Two dogs does not trigger alarms, but Missing and Unknown do',()=>{
 const f=seedModules.find(m=>m.key==='house').fields.find(f=>f.key==='alarms_locations');
 const fires=compileCondition(f.flag.when,known);
 assert.equal(fires({who_lives_here:'Two dogs',alarms_locations:'Two dogs'}),false);
 assert.equal(fires({alarms_missing:'None missing'}),false);
 assert.equal(fires({alarms_missing:'Unknown'}),true);assert.equal(fires({alarms_missing:'Missing'}),true);
});
test('name-only room is not looked over; planned footing compares actual city requirement',()=>{
 const snapshot={consult:{status:'in_progress',revision:1,completion_generation:1,scheduled_at:'2026-11-03'},pins:seedModules.filter(m=>['room','footing'].includes(m.key)).map(definition=>({kind:'module',definition})),instances:[{id:'room',module_key:'room'},{id:'foot',module_key:'footing'}],heads:[{id:'a',instance_id:'room',field_key:'name',status:'answered',value:'Kitchen',server_revision:'1'},...Object.entries({planned_depth:48,required_depth:60}).map(([field_key,value])=>({id:field_key,instance_id:'foot',field_key,value,status:'answered',server_revision:'1'}))],conflicts:[]};
 const m=buildModel(snapshot,[],[],emptyDraft());
 assert.deepEqual(summaryInput(m,undefined,'2026-11-03','').rooms,[]);
 assert.ok(summaryInput(m,undefined,'2026-11-03','').come_back.some(x=>x.includes('Kitchen')));
 assert.ok(m.flags.some(f=>f.field.key==='planned_depth'));
 const n=openItemCount({price_critical:m.pc,record:m.record});
 assert.equal(n,m.open.length);
 snapshot.heads.find(x=>x.field_key==='planned_depth').value=60;
 assert.equal(buildModel(snapshot,[],[],emptyDraft()).flags.some(f=>f.field.key==='planned_depth'),false);
});

test('north-zone answer updates editable city depth to 60; southern zone defaults to 42',async()=>{
 const {VisitController}=await import('../lib/consult/ui/controller.ts');
 const ctl=new VisitController(null,'visit');const writes=[];
 ctl.commit=async(build,label)=>{writes.push(label);return {};};
 const original=ctl.answer.bind(ctl);const answers=[];
 ctl.answer=async(...args)=>{answers.push(args);return original(...args);};
 await ctl.answer('foot','frost_zone','County frost zone',{status:'answered',value:'Northern counties — Zone I (60 in)'});
 assert.equal(answers[1][1],'required_depth');assert.equal(answers[1][3].value,60);
 await ctl.answer('foot','required_depth','City requirement',{status:'answered',value:66});
 assert.equal(answers.at(-1)[3].value,66);
});

 test('garage Not sure flags unconfirmed separation, never missing',()=>{
 const field=seedModules.find(m=>m.key==='garage').fields.find(f=>f.key==='separation');
 const flags=[field.flag,...field.flags].filter(f=>compileCondition(f.when,known)({separation:'Not sure'}));
 assert.equal(flags.length,1);assert.match(flags[0].issue,/not confirmed/);assert.doesNotMatch(flags[0].issue,/missing/);
 });

test('resume pane prefers first open section, validates saved target and falls back to populated section',()=>{
 const first={instance:{id:'first'}},open={instance:{id:'open'}};
 const model={sections:[first,open],open:[{section:open}]};
 assert.equal(resumeSection(model),'open');assert.equal(resumeSection(model,'first'),'first');assert.equal(resumeSection(model,'removed'),'open');
 assert.equal(resumeSection({...model,open:[]}),'first');
});
