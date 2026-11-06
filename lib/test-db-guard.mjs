import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';

/** Also retain the interlock in detached children which lose NODE_TEST_CONTEXT. */
export function isNodeTest() {
  return !!(process.env.NODE_TEST_CONTEXT || process.env.SJC_TEST_CLUSTER_TAG || process.env.SJC_TEST_DATABASE_URL) || process.argv.includes('--test') || process.execArgv.includes('--test');
}
function refuse(){throw Error('TEST_DATABASE_REQUIRED: require an explicit URL on the active tests/_harness/testdb.mjs socket cluster; runtime and PG environment fallback are forbidden.');}
export function assertTestDatabaseUrl(connectionString) {
 if(!isNodeTest())return;
 try {
  const u=new URL(connectionString), db=decodeURIComponent(u.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(u.protocol)||!db||db==='sjcos'||!/^([a-z][a-z0-9_]*|postgres)$/.test(db)||u.hash)refuse();
  const entries=[...u.searchParams];
  if(new Set(entries.map(([k])=>k)).size!==entries.length||entries.some(([k])=>!['host','port','application_name','options'].includes(k)))refuse();
  const host=u.searchParams.get('host'),port=u.searchParams.get('port');
  if(u.hostname!=='localhost'||u.port||u.searchParams.get('application_name')!=='sjc_test_harness'||!host||!port)refuse();
  // Membership in the harness state, not an application_name supplied by a test,
  // establishes the cluster identity. Require its actual running socket/port.
  const state=JSON.parse(readFileSync(path.join(tmpdir(),`sjc-testdb-${process.env.USER??'user'}${process.env.SJC_TEST_CLUSTER_TAG?'-'+process.env.SJC_TEST_CLUSTER_TAG:''}.json`),'utf8'));
  if(host!==state.dir||port!==String(state.port)||!host.startsWith(path.join(tmpdir(),'sjc-pgtest-'))||statSync(host).uid!==process.getuid())refuse();
  const pid=readFileSync(path.join(host,'data/postmaster.pid'),'utf8').split('\n');
  if(pid[3]!==port||pid[4]!==host||!statSync(path.join(host,'.s.PGSQL.'+port)).isSocket())refuse();
  // Only the harness's narrow-role test option is allowed, never connection GUCs.
  const options=u.searchParams.get('options');
  if(options&&!/^-c role=[a-z][a-z0-9_]*$/.test(options))refuse();
 }catch{refuse();}
}
export function assertTestDatabaseConfig(config){
 if(!isNodeTest())return;
 const c=typeof config==='string'?{connectionString:config}:config;
 assertTestDatabaseUrl(c?.connectionString);
 // A URL is the sole connection authority; reject config/environment overrides.
 if(Object.keys(c).some(k=>!['connectionString','max','min','idleTimeoutMillis','connectionTimeoutMillis','allowExitOnIdle','maxUses','maxLifetimeSeconds'].includes(k)))refuse();
}
/** Standalone env/file builders must select this before consulting runtime files. */
export function testDatabaseUrl(env=process.env,key='DATABASE_URL'){
 if(!isNodeTest())return undefined;
 const url=env[key]??env.DATABASE_URL??env.SJC_TEST_DATABASE_URL;
 assertTestDatabaseUrl(url);return url;
}
