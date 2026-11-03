import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultCompleteness, countingSkip, conditionMatches } from '../lib/consult/completeness.ts';
const item = {key:'room.length',tier:'price_critical',required:true,applicable:true,mapped:true,answered:true,valid:true};
function complete() { return {
 fields:[{...item}], photos:[{...item,key:'room.photo'}],modules:[{key:'room',minimum:1,live_count:1,parents_valid:true}],
 recording:{asked:true,choice:'manual',confirmed_evidence:false,documented_failure_or_stop:false},photo_permission:true,
 acknowledgement:{initials_committed:true,visitor_reason:null,handed_back:false},promised_date:'2026-11-16',
 manifests:[{device:'phone',acknowledged:true,rejected:0,missing:false}],unresolved_conflicts:0,
 rrp:{applies:true,receipt:true,firm_current:true,renovator_current:true,redelivery_required:false,redelivery_todo:false},
 flags:[{key:'flag',disposition:'sub_must_look',actor:'visitor',at:'2026-11-02T00:00:00Z',note:'Plumber must check'}],
 touched_trades:['Plumber'],trade_walks:[{trade:'Plumber',needed:true,reason:'Check before pricing',actor:'visitor',at:'2026-11-02T00:00:00Z'}],no_trades_confirmed:false,
}; }
test('all eleven checks pass for Joe and staff without review or an AI decision', () => {
 const owner=complete(),staff=complete();assert.deepEqual(consultCompleteness(owner),consultCompleteness(staff));
 assert.equal(consultCompleteness(staff).complete,true);assert.equal(consultCompleteness(staff).checks.length,11);
});
test('each close check independently blocks completion', () => {
 const mutations=[ x=>x.fields[0].answered=false,x=>x.photos[0].answered=false,x=>x.modules[0].live_count=0,
 x=>x.recording.asked=false,x=>x.acknowledgement.initials_committed=false,x=>x.promised_date='2026-02-30',
 x=>x.unresolved_conflicts=1,x=>x.rrp.renovator_current=false,x=>x.flags[0].actor=null,
 x=>{x.fields[0].answered=false;x.fields[0].skip={reason:'No access'};},x=>x.trade_walks=[] ];
 mutations.forEach((mutate,i)=>{const x=complete();mutate(x);const r=consultCompleteness(x);assert.equal(r.complete,false,`check ${i+1}`);assert.ok(r.checks[i].open.length,`check ${i+1}`);});
});
test('record skips count for everyone; return visit never counts; mapped risk needs written disposition', () => {
 assert.equal(countingSkip({...item,tier:'record',skip:{reason:'Client declined'}}),true);
 assert.equal(countingSkip({...item,skip:{reason:'Get on return visit'}}),false);
 assert.equal(countingSkip({...item,skip:{reason:'Not on this job'}}),false);
 assert.equal(countingSkip({...item,skip:{reason:'Not on this job',condition_validated:true}}),true);
 assert.equal(countingSkip({...item,skip:{reason:'No access',assumption:{text:'Exclude hidden rot',responsible_trade:'Carpenter',verification_point:'After demo',adjustment_route:'precon_change',quantity:null,unit:null,exclusion:'Hidden rot'}}}),true);
 const x=complete();x.fields.push({...item,key:'record',tier:'record',answered:false,skip:{reason:'Client declined'}});
 assert.deepEqual(consultCompleteness(x).record,{total:1,done:1,skipped:1});
});
test('permissions are separate, acknowledgement reason requires hand-back, empty manifests refuse close', () => {
 const x=complete();x.photo_permission=null;assert.equal(consultCompleteness(x).complete,false);
 x.photo_permission=false;x.acknowledgement={initials_committed:false,visitor_reason:'Declined',handed_back:false};assert.equal(consultCompleteness(x).complete,false);
 x.acknowledgement.handed_back=true;assert.equal(consultCompleteness(x).complete,true);
 x.manifests=[];assert.equal(consultCompleteness(x).complete,false);
});
test('conditions use typed operands and unknown never satisfies inequality', () => {
 assert.equal(conditionMatches({field:'year',op:'lt',value:1978},()=>1960),true);
 assert.equal(conditionMatches({field:'year',op:'ne',value:1978},()=>undefined),false);
 assert.equal(conditionMatches({field:'year',op:'lt',value:1978},()=> '1960'),false);
});
