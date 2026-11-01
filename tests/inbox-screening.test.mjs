import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const records=new Map();let mailbox='joe@example.test',allowed=true,calls=0;
globalThis.__screen={get mailbox(){return mailbox},get allowed(){return allowed},query:async(sql,p)=>{
 calls++;const key=JSON.stringify(p.slice(0,2));
 if(sql.startsWith('SELECT'))return {rows:records.has(key)?[{decision:records.get(key)}]:[]};
 if(sql.startsWith('INSERT'))records.set(key,p[2]);else records.delete(key);
 return {rows:[]};
}};
const stubs={
 '@/lib/dal':`export const requireAccess=async()=>{if(!globalThis.__screen.allowed)throw Error('Forbidden');return {id:'u'}};`,
 '@/lib/mailbox-email':`export const ensureMailboxEmail=async()=>globalThis.__screen.mailbox??'';`,
 '@/lib/mailbox':`export const withMailboxFor=async(u,f)=>f();export const activeMailbox=()=>({email:globalThis.__screen.mailbox});`,
 '@/lib/db':`export const query=(...a)=>globalThis.__screen.query(...a);`,
 'next/cache':`export const revalidatePath=()=>{};`,
};
registerHooks({resolve(s,c,n){if(s in stubs)return {url:'stub:'+s,shortCircuit:true};if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c);return n(s,c)},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c)}});
const {setInboxPreferenceAction:decide}=await import('../lib/actions/inbox-screening.ts');
test('decisions persist per mailbox, normalize addresses, and undo restores previous choice',async()=>{
 const first=await decide('sender','New <NEW@example.test>','other');assert.equal(first.ok,true);assert.equal(first.previous,null);
 const second=await decide('sender','new@example.test','linked');assert.equal(second.previous,'other');
 await decide('sender','new@example.test',second.previous);
 mailbox='staff@example.test';assert.equal((await decide('sender','new@example.test','sub')).previous,null);
 mailbox='joe@example.test';assert.equal((await decide('sender','new@example.test',null)).previous,'other');
 assert.equal((await decide('sender','new@example.test','lead')).previous,null);
 await decide('thread','t1','attention');assert.equal((await decide('thread','t1','other')).previous,'attention');
});
test('invalid choices and unauthorized access cannot write',async()=>{
 const before=calls;assert.equal((await decide('sender','bad','other')).ok,false);assert.equal((await decide('thread','t1','lead')).ok,false);assert.equal(calls,before);
 allowed=false;await assert.rejects(()=>decide('sender','new@example.test','other'),/Forbidden/);assert.equal(calls,before);
});

test('block is remembered per mailbox and undo restores the exact earlier decision',async()=>{
 allowed=true;mailbox='joe@example.test';
 await decide('sender','block@example.test','linked');
 const result=await decide('sender','BLOCK@example.test','blocked');assert.equal(result.ok,true);assert.equal(result.previous,'linked');
 mailbox='staff@example.test';assert.equal((await decide('sender','block@example.test','other')).previous,null);
 mailbox='joe@example.test';assert.equal((await decide('sender','block@example.test',result.previous)).previous,'blocked');
});
