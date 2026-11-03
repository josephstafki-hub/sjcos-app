import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {withTestDb} from './_harness/testdb.mjs';import {findingsFixture} from './_harness/consult-findings.mjs';
import {reconcileConsultFindings} from '../lib/consult/findings.ts';
test('complete staff visit aggregates disjoint rooms; repeat is stable; Reopen retracts only owned quantities',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);
  const apply=async()=>{await c.query('BEGIN');try{const r=await reconcileConsultFindings(c,f.context('apply'),{consult_id:f.consult,expected_generation:1,operation_id:randomUUID()});await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}};
  await assert.rejects(apply(),/consult_not_complete/);
  const plan=(await c.query(`INSERT INTO site_visit_plans(project_id,revision,items) VALUES($1,1,$2) RETURNING id`,[f.project,JSON.stringify([{id:'exact',scope_key:'flooring.install',kind:'measurement',unit:'sf',quantity_label:'Floor area',prompt:'Area',status:'open',consult_target:{instance_id:f.instances[0],field_key:'floor_area'}},{id:'unrelated',scope_key:'flooring.install',kind:'measurement',unit:'sf',prompt:'Other area',status:'open'}])])).rows[0];
  await c.query('UPDATE consults SET site_visit_plan_id=$2,site_visit_plan_revision=1 WHERE id=$1',[f.consult,plan.id]);
  await f.save();const closed=await f.close();assert.equal(closed.complete,true);
  const first=await apply();assert.equal(first.results[0].status,'applied');assert.deepEqual(await apply(),first);
  const quantities=(await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities;assert.equal(quantities[0].qty,200);
  const items=(await c.query('SELECT items FROM site_visit_plans WHERE id=$1',[plan.id])).rows[0].items;assert.equal(items[0].status,'answered');assert.equal(items[1].status,'open');
  await c.query(`UPDATE scope_items SET quantities=quantities||'[ {"label":"Other source","qty":4,"unit":"ea","source":"owner"} ]' WHERE project_id=$1`,[f.project]);
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correct room size'});
  assert.equal((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities.length,1);
  assert.equal((await c.query('SELECT items FROM site_visit_plans WHERE id=$1',[plan.id])).rows[0].items[0].status,'open');
  assert.ok((await c.query('SELECT retracted_at FROM site_visit_findings WHERE consult_id=$1',[f.consult])).rows[0].retracted_at);
 },{fresh:true});
});

test('sent formal estimates keep reconciliation as proposals and preserve their scope quantity',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();assert.equal((await f.close()).complete,true);
  await c.query("INSERT INTO estimates(project_id,title,kind,status) VALUES($1,'Sent formal','formal','sent')",[f.project]);
  await c.query('BEGIN');const result=await reconcileConsultFindings(c,f.context('apply'),{consult_id:f.consult,expected_generation:1,operation_id:randomUUID()});await c.query('COMMIT');
  assert.equal(result.results[0].reason,'estimate_locked');assert.deepEqual((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities,[]);
 },{fresh:true});
});
