import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withTestDb} from './_harness/testdb.mjs';
import {fixture} from './_harness/consult.mjs';
import {publish} from '../lib/consult/protocol.ts';
import {touchedTrades} from '../lib/consult/trades.ts';
test('reconcile handles existing start, NULL preservation, and inside-window cancellation',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await c.query("UPDATE consults SET scheduled_at='2026-11-03T18:00Z' WHERE id=$1",[f.consult]);
 const definition={key:'era',version:1,title:'Era',repeatable:false,say:[],fields:[{key:'pamphlet_given',label:'Given',type:'yesno',required:true,tier:'price_critical'}],shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','era',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 const era=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:era,module_key:'era',label:'Era'})]);
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,'2027-02-01']);
 await f.send([f.op('answer',{status:'answered',value:true},0,{instance_id:era,field_key:'pamphlet_given'})]);
 await f.run('evidence',{device:f.device,epoch:1,expected_revision:await f.revision(),evidence:f.evidence});await f.close();
 const rows=()=>c.query("SELECT status,(due_at AT TIME ZONE 'America/Chicago')::date::text due_day,snoozed_until=due_at snoozed FROM work_items WHERE source_id=$1",[`${f.consult}:rrp:redelivery`]);
 assert.equal((await rows()).rows[0].due_day,'2027-01-18');assert.equal((await rows()).rows[0].snoozed,true);
 for(const [picked,due] of [['2026-11-20','2027-01-18'],['2027-01-28','2027-01-18'],['2027-01-10','2027-01-10']]){
 await c.query("UPDATE consult_close_evidence SET evidence=jsonb_set(evidence,'{rrp,redelivery_day}',to_jsonb($2::text)) WHERE consult_id=$1",[f.consult,picked]);
 await c.query('SELECT consult_reconcile_rrp($1)',[f.project]);assert.equal((await rows()).rows[0].due_day,due);
 }
 await c.query('UPDATE projects SET start_date=NULL WHERE id=$1',[f.project]);assert.ok(!['done','cancelled'].includes((await rows()).rows[0].status));
 await c.query('UPDATE projects SET start_date=$2 WHERE id=$1',[f.project,'2026-12-20']);assert.equal((await rows()).rows[0].status,'cancelled');

},{fresh:true}));

test('server trade derivation cannot omit plumbing and electrical',()=>assert.deepEqual(touchedTrades([{module_key:'plumb_fixture'},{module_key:'panel'}],false,[]),['Plumber','Electrician']));
test('stuck close reports once and clears after successful close',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();
 await f.run('report_close_failure',{reason:'conflict'});await f.run('report_close_failure',{reason:'conflict'});
 const rows=await c.query('SELECT * FROM work_items WHERE source_id=$1',[`${f.consult}:close_failure:visit`]);assert.equal(rows.rowCount,1);assert.match(rows.rows[0].title,/hasn't closed/);
 await f.close();assert.equal((await c.query('SELECT status FROM work_items WHERE id=$1',[rows.rows[0].id])).rows[0].status,'done');
},{fresh:true}));

test('SQL RRP applicability agrees with captured-fact rule',async()=>withTestDb(async(_url,c)=>{
 const {readFileSync}=await import('node:fs');const {rrpFacts}=await import('../lib/consult/rrp.ts');
 const sql=readFileSync(new URL('../db/migrations/0083_consult_rrp_reconcile.sql',import.meta.url),'utf8');
 const predicate=sql.slice(sql.indexOf(" AND (f.facts->'era.before_1978'"),sql.indexOf(' AND EXISTS(')).replace(/^ AND /,'');
 for(const facts of [{'house.year_built':1985,'era.before_1978':false,'era.disturbs_paint':true},{'house.year_built':1965,'era.before_1978':true,'era.disturbs_paint':false},{},{'era.disturbs_paint':false,'era.window_door_replacement':true}]){
 const row=(await c.query(`SELECT coalesce(${predicate},false) applies FROM (SELECT $1::jsonb facts) f`,[JSON.stringify(facts)])).rows[0];assert.equal(row.applies,rrpFacts(facts,false,'2026-11-03').applies);
 }
},{fresh:true}));


test('check 11 derives trades with empty device evidence and accepts decided walks',async()=>withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);
 for(const key of ['plumb_fixture','panel']){
 const definition={key,version:1,title:key,repeatable:false,say:[],fields:[],shots:[],coverage:[]};
 const form=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module',$1,1,$2,'',$3) RETURNING id",[key,definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:form,registry_id:f.registry});await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,form]);
 await f.send([f.op('create_instance',{},await f.revision(),{instance_id:randomUUID(),module_key:key,label:key})]);
 }
 await f.save();let result=await f.close();assert.deepEqual(result.checks.find(x=>x.check===11).open.sort(),['Electrician','Plumber']);
 await f.save({...f.evidence,trade_walks:['Plumber','Electrician'].map(trade=>({trade,needed:true,reason:'Confirm existing connections'}))});result=await f.close();assert.equal(result.complete,true);
},{fresh:true}));
