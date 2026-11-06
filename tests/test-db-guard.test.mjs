import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {startCluster} from './_harness/testdb.mjs';
const good=startCluster().url;
// Expectations first: every negative must throw with ZERO pg construction or
// socket attempts, even when all PG defaults and runtime URLs are inherited.
function probe({testing=true,url,harnessUrl,argvTest=false,entry='./lib/db.ts',config,lostContext=false}={}) {
 const env={...process.env};
 for(const k of Object.keys(env))if(k.startsWith('PG')||k.startsWith('DATABASE_URL')||k==='SJC_TEST_DATABASE_URL'||k==='NODE_TEST_CONTEXT'||(!testing&&k==='SJC_TEST_CLUSTER_TAG'))delete env[k];
 if(testing&&!lostContext)env.NODE_TEST_CONTEXT='child-v8';
 Object.assign(env,{PGDATABASE:'sjcos',PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'runtime',PGOPTIONS:'-c search_path=public'});
 if(url)env.DATABASE_URL=url;
 if(harnessUrl)env.SJC_TEST_DATABASE_URL=harnessUrl;
 const code=`
 import {registerHooks} from 'node:module';
 globalThis.calls=[];process.on('exit',()=>console.error('PG_CALLS='+JSON.stringify(globalThis.calls)));
 registerHooks({resolve(s,c,n){if(s==='pg')return {url:'fake:pg',shortCircuit:true};return n(s,c)},load(u,c,n){if(u==='fake:pg')return {format:'module',source:'class Pool {constructor(){globalThis.calls.push("pool")} connect(){globalThis.calls.push("connect")} query(){globalThis.calls.push("query")} } export default {Pool,Client:Pool};',shortCircuit:true};return n(u,c)}});
 ${argvTest ? "process.argv.push('--test');" : ''}
 process.argv.push('00000000-0000-4000-8000-000000000001');
 try {const m=await import(${JSON.stringify(entry)});${config!==undefined?`new m.default.Client(${JSON.stringify(config)}).connect();`:entry==='./lib/db.ts'?'m.pool.connect();':entry==='./db/migrate.mjs'?'await m.migrate({url:process.env.DATABASE_URL});':''}console.log(JSON.stringify({calls}));}
 catch(e){console.log(JSON.stringify({error:e.message,calls}));}
 `;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',cwd:new URL('../',import.meta.url),timeout:10000});
 if(r.status!==0&&r.stderr.includes('TEST_DATABASE_REQUIRED'))return {error:r.stderr,calls:JSON.parse(r.stderr.match(/PG_CALLS=(\[[^\n]*\])/)[1])};
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split('\n').at(-1));
}
for(const [name,input] of Object.entries({missing:{},argv:{testing:false,argvTest:true},runtime:{url:'postgresql://localhost/sjcos'},emptyPath:{url:'postgresql://unused@localhost/?application_name=sjc_test_harness'},marker:{url:'postgresql://localhost/sjcos_test?application_name=sjc_test_harness'},lostContext:{lostContext:true,url:'postgresql://localhost/sjcos'}}))test(name+' refuses before pg despite PG env',()=>{const r=probe(input);assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[]);});
test('active harness URL, with hostile PG defaults, is allowed',()=>assert.deepEqual(probe({url:good}),{calls:['pool','connect']}));
test('explicit SJC_TEST_DATABASE_URL is allowed',()=>assert.deepEqual(probe({harnessUrl:good}),{calls:['pool','connect']}));
test('production behavior unchanged',()=>assert.deepEqual(probe({testing:false}),{calls:['pool','connect']}));
for(const suffix of ['&dbname=sjcos','&host=127.0.0.1','&port=5432','&options=-c%20search_path=public'])test('URL override refused '+suffix,()=>{const r=probe({url:good+suffix});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[]);});
for(const config of [{connectionString:good,host:'127.0.0.1'},{connectionString:good,database:'sjcos'},{}])test('config override refused '+JSON.stringify(config),()=>{const r=probe({entry:'./lib/guarded-pg.mjs',config});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[]);});
for(const entry of ['./scripts/invoice-collision-report.mjs','./scripts/refresh-capabilities.mjs','./scripts/run-claude-agent.mjs','./scripts/sjcos-worker.mjs','./db/migrate.mjs','./scripts/import-subs-csv.mjs'])test('actual entrypoint blocks runtime URL: '+entry,()=>{const r=probe({entry,url:'postgresql://localhost/sjcos'});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[]);});
test('complete runtime pg import census uses the shared guarded module',()=>{
 let imports=0;
 function walk(dir){for(const f of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+f.name;if(f.isDirectory())walk(p);else if(/\.(mjs|ts)$/.test(p)){
 const s=readFileSync(p,'utf8');if(p==='lib/guarded-pg.mjs')continue;
 assert.doesNotMatch(s.replace(/import\("pg"\)\./g,''),/(?:import\s+(?!type\b)[^;\n]*\bfrom\s*|import\s*\(|require\s*\()\s*['"]pg['"]/,p);
 if(s.includes('guarded-pg.mjs'))imports++;
 }}}
 for(const d of ['lib','mcp','scripts','db'])walk(d);assert.ok(imports>=70,imports);
});
