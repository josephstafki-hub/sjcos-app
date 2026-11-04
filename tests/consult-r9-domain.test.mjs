import {sameBathroom} from '../lib/consult/flags.ts';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvedFormContent} from '../lib/consult/forms/approved-content.ts';
import {CLOSING_NO_DATE_JOE,CLOSING_NO_DATE_STAFF,STAFF_CLOSING_LINE_2,STAFF_CLOSING_LINE} from '../lib/consult/forms/seed/scripts.ts';
import {PAMPHLET_UNKNOWN_YEAR_LINE} from '../lib/consult/forms/seed/shared.ts';
import {certificationWarnings} from '../lib/consult/rrp.ts';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {snapshot,publish} from '../lib/consult/protocol.ts';
test('counsel has each changed literal exactly once',()=>{for(const line of [CLOSING_NO_DATE_JOE,CLOSING_NO_DATE_STAFF,STAFF_CLOSING_LINE_2,STAFF_CLOSING_LINE,PAMPHLET_UNKNOWN_YEAR_LINE])assert.equal(approvedFormContent.split(line).length-1,1,line);});
test('finish certification warnings are optional advisories',()=>{assert.equal(certificationWarnings({'era.firm_cert_expiry':'2027-03-11','era.renovator_expiry':'2027-03-12'},'2027-04-01').length,2);assert.deepEqual(certificationWarnings({'era.firm_cert_expiry':'2027-03-11'}),[]);});
test('delivered pamphlet redelivery follows start and cancels; skipped gets none',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await c.query("UPDATE consults SET scheduled_at='2026-11-03T18:00Z' WHERE id=$1",[f.consult]);
 const definition={key:'era',version:1,title:'Era',repeatable:false,say:[],fields:[{key:'pamphlet_given',label:'Given',type:'yesno',required:true,tier:'price_critical'}],shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','era',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const era=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:era,module_key:'era',label:'Era'})]);
 await f.send([f.op('answer',{status:'answered',value:true},0,{instance_id:era,field_key:'pamphlet_given'})]);
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,'2027-03-10']);
 const rows=()=>c.query("SELECT status,(due_at AT TIME ZONE 'America/Chicago')::date::text due_day,snoozed_until=due_at snoozed FROM work_items WHERE source_id=$1",[`${f.consult}:rrp:redelivery`]);
 assert.equal((await rows()).rows[0].due_day,'2027-02-24');assert.equal((await rows()).rows[0].snoozed,true);
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,'2026-12-20']);assert.equal((await rows()).rows[0].status,'cancelled');
 await c.query("DELETE FROM work_items WHERE source_id=$1",[`${f.consult}:rrp:redelivery`]);
 await f.send([f.op('answer',{status:'skipped',skip_reason:'Client absent'},await f.revision(),{instance_id:era,field_key:'pamphlet_given'})]);
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,'2027-03-10']);assert.equal((await rows()).rows.length,0);

},{fresh:true}));
test('reopen metadata names the actor and clears after close',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();await f.close();
 await f.run('reopen',{expected_revision:await f.revision(),reason:'Add closet measurement'},f.owner);
 const s=await snapshot(c,f.context('read',f.owner),f.consult);assert.equal(s.reopened.who,'Owner');assert.equal(s.reopened.reason,'Add closet measurement');assert.ok(s.reopened.when);
 await f.close();assert.equal((await snapshot(c,f.context('read',f.owner),f.consult)).reopened,null);
},{fresh:true}));

test('toilet plans are isolated by bath and exclude unrelated fixtures',()=>{
 const bath1={id:'b1',parent_id:'r1'},bath2={id:'b2',parent_id:'r2'};
 const fixtures=[{parent_id:'r1',plan:'Keep'},{parent_id:'b2',plan:'Move'}];
 assert.deepEqual(fixtures.filter(f=>sameBathroom(bath1,f)).map(f=>f.plan),['Keep']);
 assert.deepEqual(fixtures.filter(f=>sameBathroom(bath2,f)).map(f=>f.plan),['Move']);
 assert.equal(sameBathroom({id:'b',parent_id:null},{parent_id:null}),false);
});
