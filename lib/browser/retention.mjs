/** Owner-side bounded Phase 1 scrub. No Ask deletion, audit deletion, browser
 * launch, model/network payload, or ambient DSN. Cache IO is a protected journal
 * adapter with tombstone -> listener invalidation -> purge -> completion. */
export async function runBrowserRetention({transaction,cache,limit=100}){
 if(typeof transaction!=='function'||!cache||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('BROWSER_BAD_INPUT');
 for(const k of ['tombstone','invalidate','purge','complete'])if(typeof cache[k]!=='function')throw Error('BROWSER_SERVICE_UNAVAILABLE');
 const scrubbed=[];
 const result=await transaction(async c=>{
  const login=(await c.query("SELECT session_user::text AS login,current_user::text AS effective,pg_get_userbyid(relowner)::text AS owner FROM pg_class WHERE oid='public.browser_tasks'::regclass")).rows[0];
  if(!login||login.login!==login.owner||login.effective!==login.owner)throw Error('BROWSER_FORBIDDEN');
  await c.query('SELECT pg_advisory_xact_lock(1150030)');
  const pending=await c.query("SELECT t.id FROM browser_tasks t WHERE EXISTS(SELECT 1 FROM browser_read_manifests m WHERE m.task_id=t.id AND m.authorization_state='pending' AND m.expires_at<=clock_timestamp()) ORDER BY t.id LIMIT $1 FOR UPDATE",[limit]);
  for(const t of pending.rows)await c.query("UPDATE browser_read_manifests SET authorization_state='expired' WHERE task_id=$1 AND authorization_state='pending' AND expires_at<=clock_timestamp()",[t.id]);
  const {rows}=await c.query(`SELECT id FROM browser_tasks WHERE NOT EXISTS(SELECT 1 FROM browser_retention_progress p WHERE p.task_id=browser_tasks.id AND p.completed_at IS NOT NULL) AND state IN ('closed','failed') AND coalesce(closed_at,updated_at)<clock_timestamp()-interval '30 days' ORDER BY id LIMIT $1 FOR UPDATE`,[limit]);
  for(const {id}of rows){
   // Journal tombstones survive a SQL rollback/crash; invalidation is idempotent.
   // The cache adapter never follows caller paths; task IDs select known roots.
   await cache.tombstone(id);await cache.invalidate(id);await cache.purge(id);
   await c.query("UPDATE browser_read_manifests SET public_entries='{}',private_entries_ciphertext=NULL,envelope=NULL,payload_purged_at=clock_timestamp(),revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE task_id=$1 AND created_at<clock_timestamp()-interval '30 days' AND payload_purged_at IS NULL",[id]);
   await c.query("UPDATE browser_commands SET safe_result='{}' WHERE task_id=$1 AND created_at<clock_timestamp()-interval '30 days' AND state IN ('succeeded','failed','unknown') AND safe_result<>'{}'",[id]);
   await c.query("UPDATE browser_web_commands SET safe_result='{}' WHERE task_id=$1 AND created_at<clock_timestamp()-interval '30 days' AND state IN ('succeeded','failed','unknown') AND safe_result<>'{}'",[id]);
   await c.query("UPDATE browser_tasks SET confirmed_answers='[]' WHERE id=$1 AND confirmed_answers<>'[]'",[id]);
   await c.query('INSERT INTO browser_retention_progress(task_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
   scrubbed.push(id);
  }
  const claims=await c.query(`DELETE FROM browser_owner_views WHERE claim_id IN (SELECT claim_id FROM browser_owner_views WHERE expires_at<clock_timestamp()-interval '24 hours' ORDER BY expires_at LIMIT $1 FOR UPDATE)`,[limit]);
  // Expired verifier rows contain only hashes/IDs; never leave an unbounded
  // app_settings spool. No service or worker receives settings write rights.
  await c.query("DELETE FROM app_settings WHERE key IN (SELECT key FROM app_settings WHERE (key LIKE 'browser.audit_event.%' OR key LIKE 'browser.checkpoint.%') AND (value::jsonb->>'expires_at')::timestamptz<clock_timestamp()-interval '24 hours' LIMIT $1)",[limit]);
  return {tasks_scrubbed:rows.length,claims_scrubbed:claims.rowCount};
 });
 // SQL committed before journal completion; an incomplete tombstone is replayable.
 for(const id of scrubbed){await cache.complete(id);await transaction(c=>c.query('UPDATE browser_retention_progress SET completed_at=clock_timestamp() WHERE task_id=$1',[id]));}return result;
}


/** Task-ID-only protected cache journal. The caller provisions this directory;
 * no caller filename, restore, symlink traversal or arbitrary recursive rm. */
export function createBrowserCacheRetention({directory,invalidate}){
 if(typeof directory!=='string'||!directory.startsWith('/')||typeof invalidate!=='function')throw Error('BROWSER_BAD_INPUT');
 const check=async id=>{
  const {UUID}=await import('./phase1-contracts.mjs');UUID.parse(id);
  const fs=await import('node:fs/promises'),st=await fs.lstat(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('BROWSER_FORBIDDEN');return fs;
 };
 const sync=async fs=>{const d=await fs.open(directory,'r');try{await d.sync();}finally{await d.close();}};
 return {
  async tombstone(id){const fs=await check(id);let file;try{file=await fs.open(directory+'/'+id+'.tombstone','wx',0o600);await file.writeFile(JSON.stringify({v:1,task_id:id}));await file.sync();}catch(e){if(e.code!=='EEXIST')throw e;const st=await fs.lstat(directory+'/'+id+'.tombstone');if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('BROWSER_FORBIDDEN');if(await fs.readFile(directory+'/'+id+'.tombstone','utf8')!==JSON.stringify({v:1,task_id:id}))throw Error('BROWSER_FORBIDDEN');}finally{await file?.close();}await sync(fs);},
  invalidate,
  async purge(id){const fs=await check(id),target=directory+'/'+id;try{const st=await fs.lstat(target);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('BROWSER_FORBIDDEN');await fs.rm(target,{recursive:true});await sync(fs);}catch(e){if(e.code!=='ENOENT')throw e;}},
  async complete(id){const fs=await check(id);await fs.rename(directory+'/'+id+'.tombstone',directory+'/'+id+'.purged').catch(async e=>{if(e.code!=='ENOENT')throw e;await fs.lstat(directory+'/'+id+'.purged');});await sync(fs);},
 };
}
