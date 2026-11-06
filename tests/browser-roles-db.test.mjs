import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestDb,withSessionIdentity} from './_harness/testdb.mjs';
const tables=['web_sessions','browser_tasks','browser_task_runs','browser_commands','browser_viewers','browser_web_commands','browser_maintenance_jobs','browser_read_manifests','browser_read_uses','browser_owner_views','browser_audit','browser_audit_heads','browser_audit_checkpoints'];
for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly'])test(`0100 private relations have no privileges for actual ${role}`,async()=>withTestDb(async(url)=>{
 await withSessionIdentity(url,role,async(c)=>{
  assert.deepEqual((await c.query('SELECT session_user,current_user')).rows[0],{session_user:role,current_user:role});
  for(const table of tables)for(const op of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await c.query('SELECT has_table_privilege(current_user,$1,$2) AS ok',[table,op])).rows[0].ok,false,`${table} ${op}`);
  for(const fn of ['guard_ask_run_identity','guard_browser_core_write','guard_browser_audit_truncate','fence_browser_web_session','revoke_user_web_sessions'])assert.equal((await c.query(`SELECT has_function_privilege(current_user,$1,'EXECUTE') AS ok`,[`${fn}()`])).rows[0].ok,false,`${fn} executable`);
  for(const table of tables)await assert.rejects(c.query(`SELECT * FROM ${table}`),e=>e.code==='42501');
 });
},{fresh:role==='sjcos_agent'}));

// Phase 0b expectations: actual logins (not SET ROLE), hostile GUCs, every
// sensitive relation, and direct private-function invocation fail closed.
import {fixture,hash} from './browser-schema-fixtures.mjs';
import pg from 'pg';
const privateTables=['browser_logins','browser_login_access','browser_profiles','browser_vault_counters','browser_handoffs','browser_handoff_attempts','browser_handoff_outcomes','browser_actions','browser_artifacts','browser_handoff_effects','browser_handoff_reconciliations','browser_action_reviews','browser_action_executions','browser_audit_outbox','browser_notification_deliveries','browser_file_links','browser_release_catalog'];
const functions=[['browser_schema_login_metadata(uuid)',`SELECT * FROM browser_schema_login_metadata(NULL)`],['check_browser_handoff_schema()',`SELECT check_browser_handoff_schema()`],['browser_schema_no_truncate()',`SELECT browser_schema_no_truncate()`],['fence_browser_action_authority_schema()',`SELECT fence_browser_action_authority_schema()`],['browser_schema_website()',`SELECT browser_schema_website()`],['browser_schema_person(uuid,uuid,boolean)',`SELECT browser_schema_person(NULL,NULL,true)`],['browser_schema_origin(text)',`SELECT browser_schema_origin('https://portal.example')`],['browser_schema_envelope(jsonb)',`SELECT browser_schema_envelope('{}')`],['browser_schema_reserve_wrap(text,text)',`SELECT * FROM browser_schema_reserve_wrap('login','v1')`],...['guard_browser_vault_schema','fence_browser_vault_schema','guard_browser_action_schema','record_browser_action_schema','fence_browser_action_schema','guard_browser_chain_schema','guard_browser_file_schema'].map(f=>[f+'()',`SELECT ${f}()`])];
for(const role of ['sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_browser'])test(`Phase 0b SQL attacks denied for actual ${role}`,()=>withTestDb(async(url,db)=>{
 await fixture(url,db,async({c,people,task,newAction})=>{
  const a=await newAction();
  const file='zz-browser-'+crypto.randomUUID();await c.query(`INSERT INTO files(id,name,browser_source_task_id,browser_private,browser_cipher_envelope) VALUES($1,$2,$3,true,$4)`,[file,'Private browser file '+crypto.randomUUID()+'.pdf',task.id,{version:1,purpose:'saved_file',bindings:{},ciphertext:'AQID',nonce:Buffer.alloc(12).toString('base64'),tag:Buffer.alloc(16).toString('base64'),wrapped_key:Buffer.alloc(32).toString('base64'),wrap_nonce:Buffer.alloc(12).toString('base64'),wrap_tag:Buffer.alloc(16).toString('base64'),key_id:'v1',wrap_revision:1}]);
  const attack=async narrow=>{
   assert.deepEqual((await narrow.query('SELECT session_user,current_user')).rows[0],{session_user:role,current_user:role});
   await narrow.query(`SELECT set_config('app.user_id',$1,false),set_config('app.role','owner',false)`,[people.owner.id]);
   for(const table of privateTables){for(const op of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await narrow.query('SELECT has_table_privilege(current_user,$1,$2) AS ok',[table,op])).rows[0].ok,false,`${table} ${op}`);await assert.rejects(narrow.query(`SELECT * FROM ${table}`),e=>e.code==='42501');}
   for(const [signature,sql] of functions){assert.equal((await narrow.query(`SELECT has_function_privilege(current_user,$1,'EXECUTE') AS ok`,[signature])).rows[0].ok,false);await assert.rejects(narrow.query(sql),e=>e.code==='42501');}
   for(const [sql,args] of [
    ['UPDATE browser_tasks SET initiator_user_id=$2,required_areas=ARRAY[\'ai\'] WHERE id=$1',[task.id,people.owner.id]],
    ["UPDATE browser_actions SET state='approved',approved_by_user_id=$2 WHERE id=$1",[a.id,people.owner.id]],
    ["UPDATE browser_actions SET state='executing',token_consumed_at=now() WHERE id=$1",[a.id]],
    ["INSERT INTO browser_login_access(login_id,user_id,granted_by_user_id,granted_by_session_id) VALUES($1,$2,$2,$1)",[crypto.randomUUID(),people.staff.id]],
    ['UPDATE files SET browser_private=false,browser_cipher_envelope=NULL WHERE id=$1',[file]],
   ]){try{const result=await narrow.query(sql,args);assert.equal(result.rowCount,0,'RLS must hide the private file');}catch(e){assert.equal(e.code,'42501');}}
   if(role!=='sjcos_browser')assert.equal((await narrow.query('SELECT id FROM files WHERE id=$1',[file])).rowCount,0);
  };
  if(role==='sjcos_browser'){
   // Bootstrap/generator integration belongs to runtime slice. Create a closed
   // identity here only to prove absence of direct privileges/function bypass.
   await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sjcos_browser') THEN CREATE ROLE sjcos_browser NOLOGIN; END IF; END $$`);
   await db.query('GRANT USAGE ON SCHEMA public TO sjcos_browser');
   const narrow=new pg.Client({connectionString:url});await narrow.connect();try{await narrow.query('SET SESSION AUTHORIZATION sjcos_browser');await attack(narrow);}finally{await narrow.query('RESET SESSION AUTHORIZATION');await narrow.end();}
  }else await withSessionIdentity(url,role,attack);
 });
}));
