import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Exercise the actual app factory with fake pg: any construction/connect attempt
// is visible and cannot touch a socket. Fresh processes also avoid cached pools.
function probe({testing=true,url,harnessUrl,argvTest=false}={}) {
 const env={...process.env};
 for(const k of Object.keys(env))if(k.startsWith('PG')||k.startsWith('DATABASE_URL')||k==='SJC_TEST_DATABASE_URL'||k==='NODE_TEST_CONTEXT')delete env[k];
 if(testing)env.NODE_TEST_CONTEXT='child-v8';
 if(url)env.DATABASE_URL=url;
 if(harnessUrl)env.SJC_TEST_DATABASE_URL=harnessUrl;
 const code=`
 import {registerHooks} from 'node:module';
 const calls=[];
 registerHooks({resolve(s,c,n){if(s==='pg')return {url:'fake:pg',shortCircuit:true};return n(s,c)},load(u,c,n){if(u==='fake:pg')return {format:'module',source:'export class Pool {constructor(){globalThis.calls.push("pool")} connect(){globalThis.calls.push("connect")}}',shortCircuit:true};return n(u,c)}});
 globalThis.calls=calls;
 ${argvTest ? "process.argv.push('--test');" : ''}
 try {const {pool}=await import('./lib/db.ts');pool.connect();console.log(JSON.stringify({calls}));}
 catch(e){console.log(JSON.stringify({error:e.message,calls}));}
 `;
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',cwd:new URL('../',import.meta.url)});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim());
}
test('Node test context refuses missing URL before constructing pg',()=>{const r=probe();assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[])});
test('--test argv also refuses missing URL',()=>{const r=probe({testing:false,argvTest:true});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[])});
test('runtime URL is forbidden in tests',()=>{const r=probe({url:'postgresql://localhost/sjcos'});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[])});
test('explicit harness URL is allowed',()=>{assert.deepEqual(probe({url:'postgresql://localhost/sjcos_test?application_name=sjc_test_harness'}),{calls:['pool','connect']})});
test('ordinary runtime default behavior is unchanged',()=>{assert.deepEqual(probe({testing:false}),{calls:['pool','connect']})});

test('SJC_TEST_DATABASE_URL is accepted explicitly',()=>{assert.deepEqual(probe({harnessUrl:'postgresql://localhost/sjcos_test?application_name=sjc_test_harness'}),{calls:['pool','connect']})});
test('adding the harness marker to the live database name is refused',()=>{const r=probe({url:'postgresql://localhost/sjcos?application_name=sjc_test_harness'});assert.match(r.error,/TEST_DATABASE_REQUIRED/);assert.deepEqual(r.calls,[])});
