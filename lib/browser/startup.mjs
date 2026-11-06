/** Browser-only strict resolver. Deliberately never imports lib/db-login's
 * ordinary-profile owner/.env fallback. Call before registering any tools. */
import {open,constants} from 'node:fs/promises';
const fail=()=>{throw Error('BROWSER_DB_STARTUP_REFUSED');};
export const PROCESS_ROLES=Object.freeze({runner:'sjcos_agent',sjcos:'sjcos_agent',interact:'sjcos_agent',controller:'sjcos_browser',reader:'sjcos_browser',gate:'sjcos_browser'});
export async function protectedFile(file,{uid=process.getuid(),maxBytes=8192}={}) {
  let fd;try{fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const s=await fd.stat();if(!s.isFile()||![0,uid].includes(s.uid)||(s.mode&0o077)!==0||s.size>maxBytes)fail();return (await fd.readFile('utf8')).trim();}finally{await fd?.close();}
}
export async function strictDatabaseUrl(kind,{env={},credentialFile,readCredential=protectedFile}={}) {
  const role=PROCESS_ROLES[kind];if(!role)fail();
  const key=role==='sjcos_agent'?'DATABASE_URL_AGENT':'DATABASE_URL_BROWSER';
  // Explicit wrong/blank env NEVER falls through to a valid file.
  const dsn=Object.hasOwn(env,key)?env[key]:credentialFile?await readCredential(credentialFile):null;
  try{const u=new URL(dsn);if(!['postgres:','postgresql:'].includes(u.protocol)||decodeURIComponent(u.username)!==role||u.searchParams.has('options')||u.searchParams.has('user')||u.searchParams.has('password'))fail();}catch{fail();}
  return {dsn,role};
}
export async function strictStartup(kind,{connect,...options}) {
  let client;try{const {dsn,role}=await strictDatabaseUrl(kind,options);client=await connect(dsn);const r=await client.query('SELECT session_user, current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = session_user');const x=r.rows?.[0];if(r.rows.length!==1||x.session_user!==role||x.current_user!==role||x.rolsuper!==false||x.rolbypassrls!==false)fail();return client;}catch{await client?.end?.();fail();}
}
