import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decisionPatches} from '../lib/consult/ui/ops.ts';
import {evidencePatches} from '../lib/consult/evidence-chunks.ts';
import {officeCloseFailure,CLOSE_ERROR_ACTIONS} from '../lib/consult/close-errors.ts';
import {officeFlagText,buildModel,emptyDraft} from '../lib/consult/ui/model.ts';
import {approvedFormContent} from '../lib/consult/forms/approved-content.ts';
import {VisitController} from '../lib/consult/ui/controller.ts';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {seedModules} from '../lib/consult/forms/seed.ts';

test('indivisible maximum trade arrays and multibyte assumptions refuse before save',()=>{
 for(const text of ['x','界']){
 const trade_walks=Array.from({length:10},(_,i)=>({trade:'Trade '+i,needed:true,reason:text.repeat(8000)}));
 assert.throws(()=>decisionPatches({}, {trade_walks}),/batch_too_large/);
 assert.throws(()=>evidencePatches(null,{trade_walks}),/evidence_too_large/);
 const skips={a:{reason:'Other',assumption:text.repeat(40000)}};
 assert.throws(()=>decisionPatches({}, {skips}),/batch_too_large/);
 assert.throws(()=>evidencePatches(null,{skips}),/evidence_too_large/);
 }
 let largest=0;
 for(const patch of evidencePatches(null,{skips:Object.fromEntries(Array.from({length:50},(_,i)=>['field'+i,{reason:'Other',note:'界'.repeat(7900)}]))})){
 largest=Math.max(largest,Buffer.byteLength(JSON.stringify({command:'evidence',input:{map_patch:true,device:'x'.repeat(36),epoch:2147483647,expected_revision:9007199254740991,baseline_hash:'x'.repeat(64),evidence:patch}})));
 }
 console.log('R12 multibyte evidence largest request bytes='+largest);assert.ok(largest<=65536);
});
test('every office code has an action, fragments use hints, counsel lines are in the section',()=>{
 for(const code of Object.keys(CLOSE_ERROR_ACTIONS))assert.notEqual(officeCloseFailure(code),officeCloseFailure('unknown'));
 assert.equal(officeFlagText('Orangeburg; Cast iron with cracks','Old or cracked drain stack — the plumber looks before we price.'),'Old or cracked drain stack — the plumber looks before we price.');
 const heading=approvedFormContent.indexOf('### Changed since approval');
 const lines=[...approvedFormContent.matchAll(/Changed after counsel’s approval/g)];
 assert.equal(lines.length,6);for(const line of lines)assert.ok(line.index>heading);
});
test('delayed report updates acknowledgement and restores it',async(t)=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({});t.after(()=>{globalThis.fetch=old;});
 const ctl=new VisitController(null,'test');
 const local={close_intent:{paused:'conflict',started_at:Date.now()-31*60000}};
 ctl.engine={read:()=>structuredClone(local),pauseClose:async(_,notified)=>{local.close_intent.notified=notified;}};
 ctl.state.closing={step:'error',code:'conflict',field:'evidence.rrp'};
 await ctl.resumeClose();assert.equal(ctl.state.closing.ownerNotified,true);assert.equal(ctl.state.closing.field,'evidence.rrp');
 ctl.state.closing=null;await ctl.resumeClose();assert.equal(ctl.state.closing.ownerNotified,true);
});
test('completed RRP deliveries reopen only outside the new 60-day window',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 for(const suffix of ['delivery','redelivery']){
 await c.query("INSERT INTO work_items(title,project_id,source_kind,source_id,status,completed_at) VALUES('Delivered',$1,'consult',$2,'done','2027-01-20T18:00Z')",[f.project,f.consult+':rrp:'+suffix]);
 }
 await c.query("UPDATE projects SET start_date='2027-03-01' WHERE id=$1",[f.project]);
 assert.equal((await c.query("SELECT count(*)::int n FROM work_items WHERE project_id=$1 AND status='done'",[f.project])).rows[0].n,2);
 await c.query("UPDATE projects SET start_date='2027-04-15' WHERE id=$1",[f.project]);
 const rows=(await c.query("SELECT status,title,(due_at AT TIME ZONE 'America/Chicago')::date::text due_day FROM work_items WHERE project_id=$1 AND source_kind='consult'",[f.project])).rows;
 assert.equal(rows.length,2);for(const row of rows){assert.equal(row.status,'queued');assert.equal(row.due_day,'2027-04-08');assert.match(row.title,/^Start moved — /);}
}));
test('radon action level is a calm advisory',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const s={consult:{id,status:'in_progress',revision:1,completion_generation:1},pins:seedModules.map(definition=>({kind:'module',definition})),instances:[{id,module_key:'house',parent_id:null}],heads:[{instance_id:id,field_key:'radon_level',status:'answered',value:4,server_revision:1}],conflicts:[]};
 const field=buildModel(s,[],[],emptyDraft()).sections.find(s=>s.module.key==='house').fields.find(f=>f.key==='radon_level');
 assert.equal(field.flags[0].kind,'advisory');assert.match(field.flags[0].issue,/Radon 4 pCi\/L/);
});
test('failed report can succeed later; abandoned reporting cannot restore the close screen',async(t)=>{
 const old=globalThis.fetch;t.after(()=>{globalThis.fetch=old;});
 const ctl=new VisitController(null,'test');
 const local={close_intent:{paused:'owner_required',started_at:Date.now()-31*60000}};
 ctl.engine={read:()=>structuredClone(local),pauseClose:async(_,notified)=>{local.close_intent.notified=notified;}};
 globalThis.fetch=async()=>{throw new Error('offline');};
 await ctl.resumeClose();clearTimeout(ctl.closeTimer);assert.ok(!local.close_intent.notified);
 globalThis.fetch=async()=>Response.json({});await ctl.resumeClose();assert.equal(ctl.state.closing.ownerNotified,true);
 local.close_intent.notified=false;
 let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
 const pending=ctl.resumeClose();delete local.close_intent;ctl.state.closing=null;finish(Response.json({}));await pending;assert.equal(ctl.state.closing,null);
});
