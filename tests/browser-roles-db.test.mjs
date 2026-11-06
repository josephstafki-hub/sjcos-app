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
