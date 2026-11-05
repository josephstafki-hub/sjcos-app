// Opt-in preload for existing tests on an already migrated, isolated QA DB.
// Never starts a server or loads .env. Example:
// SJC_TEST_CLUSTER_TAG=push SJC_QA_TEST_DATABASE_URL='postgresql://.../sjcos_push_clean?host=/home/joe/qa-sjcos&port=5499&application_name=sjc_test_harness' \
//   node --import ./tests/_harness/qa-push.mjs --test tests/phone-push-db.test.mjs
// The caller creates/loads the isolated DB with the ordinary harness loadSchema
// helper first. Legacy FIN_TEST_DATABASE_URL tests additionally need that variable.
import {registerHooks} from 'node:module';
const raw=process.env.SJC_QA_TEST_DATABASE_URL;
if(!raw)throw new Error('Set SJC_QA_TEST_DATABASE_URL to an isolated, migrated QA push database.');
const u=new URL(raw);
if((u.port||u.searchParams.get('port'))!=='5499'||!/^\/sjcos_push(?:_\w+)?$/.test(u.pathname)||u.searchParams.get('application_name')!=='sjc_test_harness')throw new Error('QA push tests require an isolated sjcos_push database on port 5499 with the test harness marker.');
registerHooks({load(url,ctx,next){
 const result=next(url,ctx);
 if(!url.endsWith('/tests/_harness/testdb.mjs'))return result;
 let source=String(result.source);
 const start=source.indexOf('export async function withTestDb('),end=source.indexOf('\n/** True when',start);
 if(start<0||end<0)throw new Error('QA preload needs updating for the changed test harness.');
 source=source.slice(0,start)+`export async function withTestDb(fn){
 process.env.SJC_OUTBOUND_DISABLED='1';
 const url=process.env.SJC_QA_TEST_DATABASE_URL;
 assertNotProduction(url);
 const client=new pg.Client({connectionString:url});await client.connect();
 try{return await fn(url,client);}finally{await client.end();}
 }\n`+source.slice(end);
 return {...result,source};
}});
