import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const reads=[];let allowed=true;
globalThis.__directory={query:async(sql,params)=>{reads.push({sql,params});return {rows:[{slug:'tom',name:'Tom',email:'tom@builder.test',kind:'sub',role:'Sub',job:'Kitchen',match:'email'}]};},allowed:()=>allowed};
registerHooks({resolve(s,c,n){
 if(s==='./db')return {url:'fake:db',shortCircuit:true};
 if(s==='@/lib/dal')return {url:'fake:dal',shortCircuit:true};
 if(s==='@/lib/mailbox')return {url:'fake:mailbox',shortCircuit:true};
 if(s==='@/lib/mailbox-email')return {url:'fake:mailbox-email',shortCircuit:true};
 if(s==='@/lib/db')return {url:'fake:db',shortCircuit:true};
 if(s==='next/cache')return {url:'fake:cache',shortCircuit:true};
 if(s==='@/lib/inbox-directory')return n(new URL('../lib/inbox-directory.ts',import.meta.url).href,c);
 if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c);
 if(/gmail|\/db(?:\.ts)?$/.test(s))throw Error('Unexpected connector import: '+s);
 return n(s,c);
},load(u,c,n){const sources={
 'fake:db':'export const query=(...a)=>globalThis.__directory.query(...a);',
 'fake:dal':"export const requireAccess=async()=>{if(!globalThis.__directory.allowed())throw Error('Forbidden');return {role:'owner'};};",
 'fake:mailbox':'export const withMailboxFor=async(u,f)=>f(),activeMailbox=()=>({email:"joe@example.test"});',
 'fake:cache':'export const revalidatePath=()=>{};',
 'fake:mailbox-email':'export const ensureMailboxEmail=async()=>"joe@example.test";',
 };return u in sources?{format:'module',source:sources[u],shortCircuit:true}:n(u,c);}});
const {searchInboxDirectoryAction}=await import('../lib/actions/inbox-screening.ts');
test('whole directory is parameterized, prioritizes exact email then domain, and returns role/job evidence',async()=>{
 const found=await searchInboxDirectoryAction('  Tom  ','Tom <TOM@builder.test>');
 assert.equal(found[0].role,'Sub');assert.equal(found[0].job,'Kitchen');
 const {sql,params}=reads.at(-1);assert.deepEqual(params,['Tom','tom@builder.test']);
 for(const source of ['leads l','projects p','subs s','vendors v','project_subs ps'])assert.ok(sql.includes(source),source);
 assert.match(sql,/ORDER BY CASE WHEN lower\(email\)=\$2 THEN 0.*THEN 1 ELSE 2 END/s);
 assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE/);assert.match(sql,/LIMIT 40/);
});
test('unauthorized callers cannot search the directory',async()=>{
 allowed=false;const before=reads.length;await assert.rejects(()=>searchInboxDirectoryAction('Tom','tom@example.test'),/Forbidden/);assert.equal(reads.length,before);
});
