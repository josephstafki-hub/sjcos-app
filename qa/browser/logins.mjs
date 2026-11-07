/** Dedicated real logins, created only through the explicit isolated QA bootstrap. */
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {qaGuard,qaPrivatePath} from '../../scripts/qa-browser-fake-controller.mjs';
import {clusterBinding} from './fixture-guards.mjs';

export const QA_LOGINS=['sjcos','sjcos_agent','sjcos_worker','sjcos_readonly','sjcos_backup','sjcos_browser'];
const ident=x=>'"'+x.replaceAll('"','""')+'"';
export async function prepareQaLogins(c){
 const dir=await qaGuard(c);
 // Check the actual server before role/ownership mutations. Never :5432.
 const server=(await c.query("SELECT session_user,current_setting('data_directory') AS directory,current_setting('port')::int AS port,(SELECT rolsuper FROM pg_roles WHERE rolname=session_user) AS superuser")).rows[0];
 if(QA_LOGINS.includes(server.session_user)||!server.superuser||server.port===5432||!server.directory||server.directory.startsWith('/home/joe/sjcos-app')||/\/main\/?$/.test(server.directory))throw Error('QA_ONLY: isolated QA bootstrap cluster required');
 await mkdir(dir,{recursive:true,mode:0o700});await qaPrivatePath(dir);
 await mkdir(dir+'/keys',{recursive:true,mode:0o700});await qaPrivatePath(dir+'/keys');
 const pinFile=dir+'/keys/cluster.json',pin=await clusterBinding(c);
 try{await qaPrivatePath(pinFile,{file:true});const old=JSON.parse(await readFile(pinFile,'utf8'));if(JSON.stringify(old)!==JSON.stringify(pin))throw Error('QA_ONLY: cluster binding changed; use a new fixture directory');}
 catch(e){if(e.code!=='ENOENT')throw e;await writeFile(pinFile,JSON.stringify(pin)+'\n',{flag:'wx',mode:0o600});}
 for(const role of QA_LOGINS){
  const file=dir+'/keys/'+role+'.password';
  try{await writeFile(file,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  await qaPrivatePath(file,{file:true});const password=(await readFile(file,'utf8')).trim();
  if(!/^[a-f0-9]{64}$/.test(password))throw Error('QA_ONLY: invalid login password');
  const exists=(await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
  await c.query(`${exists?'ALTER':'CREATE'} ROLE ${ident(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
 }
 const owner=(await c.query("SELECT pg_get_userbyid(relowner) AS name FROM pg_class WHERE oid='public.browser_tasks'::regclass")).rows[0].name;
 if(owner!=='sjcos'){
  // Only objects in this disposable QA database; never reassign shared objects
  // (REASSIGN OWNED can also change ownership of databases/tablespaces).
  await c.query('GRANT USAGE,CREATE ON SCHEMA public TO sjcos');
  const objects=(await c.query(`SELECT c.oid::regclass::text AS name,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','S','m') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=$1) AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') ORDER BY c.relkind='S'`,[owner])).rows;
  for(const obj of objects)await c.query(`ALTER ${obj.relkind==='S'?'SEQUENCE':obj.relkind==='v'?'VIEW':obj.relkind==='m'?'MATERIALIZED VIEW':'TABLE'} ${obj.name} OWNER TO sjcos`);
  const functions=(await c.query(`SELECT p.oid::regprocedure::text AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=$1) AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`,[owner])).rows;
  for(const fn of functions)await c.query(`ALTER FUNCTION ${fn.name} OWNER TO sjcos`);
  // This policy's TO role represents the website owner, chosen at migration.
  await c.query('ALTER POLICY browser_phase1_bound_thread ON ai_conversations TO sjcos');
 }
 return dir;
}
export async function qaLoginUrl(url,role,dir){
 if(!QA_LOGINS.includes(role))throw Error('QA_ONLY: unknown login');
 const file=dir+'/keys/'+role+'.password';await qaPrivatePath(file,{file:true});
 const u=new URL(url);u.username=role;u.password=(await readFile(file,'utf8')).trim();u.searchParams.delete('options');return u.href;
}
export async function verifyQaLoginUrls(urls){
 const {default:pg}=await import('pg');
 for(const [role,url] of Object.entries(urls)){
  const c=new pg.Client({connectionString:url});await c.connect();
  try{const p=(await c.query('SELECT session_user,current_user,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=session_user')).rows[0];if(p.session_user!==role||p.current_user!==role||p.rolsuper||p.rolcreaterole||p.rolcreatedb||p.rolreplication||p.rolbypassrls)throw Error('QA_ONLY: generated login identity mismatch: '+role);}
  finally{await c.end();}
 }
}
