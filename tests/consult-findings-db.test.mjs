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

test('durable findings claim, fencing, expired recovery and atomic retry leave one application',async()=>{
 const {enqueueConsultFindings,claimConsultFindings,executeConsultFindings}=await import('../lib/worker/consult.ts');
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();
  assert.equal((await enqueueConsultFindings(c,f.consult,2)).code,'rebase_required');
  await enqueueConsultFindings(c,f.consult,1);await enqueueConsultFindings(c,f.consult,1);
  const lost=await claimConsultFindings(c);assert.ok(lost);assert.equal(await claimConsultFindings(c),undefined);
  await c.query("UPDATE consult_findings_jobs SET lease_until=now()-interval '1 second'");
  const claimed=await claimConsultFindings(c);assert.notEqual(lost.lease_token,claimed.lease_token);
  assert.equal((await executeConsultFindings(c,lost)).code,'lease_lost');
  assert.equal((await executeConsultFindings(c,claimed)).ok,true);
  assert.equal((await executeConsultFindings(c,claimed)).code,'lease_lost');
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications')).rows[0].n,1);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_quantity_contributions')).rows[0].n,1);
  assert.equal((await enqueueConsultFindings(c,f.consult,1)).status,'done');
 },{fresh:true});
});

test('apply failures back off, rollback effects, and create exactly one repair after repeated failure',async()=>{
 const {enqueueConsultFindings,claimConsultFindings,executeConsultFindings}=await import('../lib/worker/consult.ts');
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();
  await c.query("CREATE FUNCTION fail_consult_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected_crash'; END $$");
  await c.query('CREATE TRIGGER fail_consult_test BEFORE INSERT ON consult_quantity_contributions FOR EACH ROW EXECUTE FUNCTION fail_consult_test()');
  await enqueueConsultFindings(c,f.consult,1);
  for(let n=0;n<5;n++){
   await c.query("UPDATE consult_findings_jobs SET available_at=now()");
   const job=await claimConsultFindings(c);const r=await executeConsultFindings(c,job);assert.equal(r.code,n===4?'apply_failed':'retry_scheduled');
   assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications')).rows[0].n,0);
  }
  assert.equal((await c.query("SELECT count(*)::int n FROM work_items WHERE source_id LIKE '%:repair:findings'")).rows[0].n,1);
  await c.query('DROP TRIGGER fail_consult_test ON consult_quantity_contributions');
  await enqueueConsultFindings(c,f.consult,1);assert.equal((await executeConsultFindings(c,await claimConsultFindings(c))).ok,true);
  assert.equal((await c.query("SELECT status FROM work_items WHERE source_id LIKE '%:repair:findings'")).rows[0].status,'done');
 },{fresh:true});
});

test('Complete switch enqueues atomically and Reopen obsoletes pending jobs',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await c.query("UPDATE app_settings SET value='true' WHERE key='consult_auto_apply_findings'");await f.save();await f.close();
  assert.equal((await c.query('SELECT status FROM consult_findings_jobs')).rows[0].status,'queued');
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications')).rows[0].n,0);
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correct'});
  assert.equal((await c.query('SELECT status FROM consult_findings_jobs')).rows[0].status,'obsolete');
 },{fresh:true});
});

test('several visits aggregate, cancellation retracts only its source, and reapply stays stable',async()=>{
 const {secondFindingsVisit}=await import('./_harness/consult-findings.mjs');
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();
  const second=await secondFindingsVisit(c,f);
  async function apply(id){await c.query('BEGIN');try{const r=await reconcileConsultFindings(c,f.context('apply',f.staff,id),{consult_id:id,expected_generation:1,operation_id:randomUUID()});await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
  await apply(f.consult);await apply(second.id);
  const quantity=async()=>(await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities[0].qty;
  assert.equal(await quantity(),300);await apply(f.consult);assert.equal(await quantity(),300);
  await f.run('cancel',{expected_revision:await f.revision(),reason:'Cancelled'},f.owner);
  assert.equal(await quantity(),100);
  await apply(second.id);assert.equal(await quantity(),100);
 },{fresh:true});
});

test('crash at each persisted effect resumes without twin findings, quantities, tasks or receipts',async()=>{
 const {enqueueConsultFindings,claimConsultFindings,executeConsultFindings}=await import('../lib/worker/consult.ts');
 for(const table of ['site_visit_findings','consult_quantity_contributions','scope_items','site_visit_plans','work_items','consult_finding_applications','consult_findings_jobs'])await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();await enqueueConsultFindings(c,f.consult,1);
  const plan=(await c.query("INSERT INTO site_visit_plans(project_id,revision,items) VALUES($1,1,'[]') RETURNING id",[f.project])).rows[0];
  await c.query('UPDATE consults SET site_visit_plan_id=$2,site_visit_plan_revision=1 WHERE id=$1',[f.consult,plan.id]);
  await c.query(`CREATE FUNCTION injected_consult_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_TABLE_NAME<>'consult_findings_jobs' OR NEW.status='done' THEN RAISE EXCEPTION 'crash'; END IF; RETURN NEW; END $$`);
  // Table names come only from the fixed list above.
  await c.query(`CREATE TRIGGER injected_consult_crash BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION injected_consult_crash()`);
  assert.equal((await executeConsultFindings(c,await claimConsultFindings(c))).code,'retry_scheduled',table);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications')).rows[0].n,0,table);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_quantity_contributions')).rows[0].n,0,table);
  assert.deepEqual((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities,[],table);
  await c.query(`DROP TRIGGER injected_consult_crash ON ${table}`);
  await c.query('UPDATE consult_findings_jobs SET available_at=now()');assert.equal((await executeConsultFindings(c,await claimConsultFindings(c))).ok,true,table);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_finding_applications')).rows[0].n,1,table);
  assert.equal((await c.query('SELECT count(*)::int n FROM consult_quantity_contributions')).rows[0].n,1,table);
 },{fresh:true});
});

test('correction supersedes history and removing an instance retracts just its contribution',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();
  async function apply(generation){await c.query('BEGIN');try{const r=await reconcileConsultFindings(c,f.context('apply'),{consult_id:f.consult,expected_generation:generation,operation_id:randomUUID()});await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
  await apply(1);await f.run('reopen',{expected_revision:await f.revision(),reason:'Correct dimension'});
  const base=Number((await c.query('SELECT revision FROM consult_field_heads WHERE consult_id=$1 AND instance_id=$2 AND field_key=$3',[f.consult,f.instances[0],'length'])).rows[0].revision);
  await f.send([f.op('answer',{status:'answered',value:240,unit:'in'},base,{instance_id:f.instances[0],field_key:'length'},2)]);await f.save();assert.equal((await f.close()).complete,true);await apply(2);
  assert.equal((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities[0].qty,300);
  assert.ok((await c.query('SELECT superseded_at FROM consult_quantity_contributions WHERE generation=1')).rows[0].superseded_at);
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Remove room from scope'});
  await f.send([f.op('remove_instance',{},await f.revision(),{instance_id:f.instances[0]},3)]);await f.save();assert.equal((await f.close()).complete,true);await apply(3);
  assert.equal((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities[0].qty,100);
 },{fresh:true});
});

test('Reopen after estimate send preserves the locked quantity and stages one owner decision',async()=>{
 await withTestDb(async(_url,c)=>{
  const f=await findingsFixture(c);await f.save();await f.close();
  await c.query('BEGIN');await reconcileConsultFindings(c,f.context('apply'),{consult_id:f.consult,expected_generation:1,operation_id:randomUUID()});await c.query('COMMIT');
  await c.query("INSERT INTO estimates(project_id,title,kind,status) VALUES($1,'Sent formal','formal','sent')",[f.project]);
  await f.run('reopen',{expected_revision:await f.revision(),reason:'Correct after sending'});
  assert.equal((await c.query('SELECT quantities FROM scope_items WHERE project_id=$1',[f.project])).rows[0].quantities[0].qty,200);
  assert.equal((await c.query("SELECT count(*)::int n FROM site_visit_findings WHERE consult_id=$1 AND kind='decision' AND status='needs_clarification'",[f.consult])).rows[0].n,1);
  assert.equal((await c.query("SELECT count(*)::int n FROM work_items WHERE source_kind='consult' AND source_id LIKE '%:locked-retraction:%'")).rows[0].n,1);
 },{fresh:true});
});
