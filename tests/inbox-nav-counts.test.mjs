import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {threadNeedsMe,rememberNeedsCount,loadedNeedsCount} from '../lib/inbox-rules.ts';
let mailbox='owner@example.test';
globalThis.__navMailbox=()=>({email:mailbox,userId:mailbox==='owner@example.test'?'owner':'staff'});
const stubs={
 '@/lib/dal':"export const can=()=>true,getCurrentUser=async()=>({id:'owner',role:'owner'});",
 '@/lib/db':"export const query=async()=>({rows:[]});",
 '@/lib/chat':"export const getUnansweredChatCount=async()=>0;",
 '@/lib/sms':"export const getUnreadSmsCount=async()=>0;",
 '@/lib/mailbox':"export const withMailboxFor=async(u,f)=>f(),activeMailbox=globalThis.__navMailbox;",
 '@/lib/commands/db':"export const runDirect=()=>{};",
 '@/lib/unsorted-docs-core':"export const countPending=async()=>0;",
};
registerHooks({resolve(s,c,n){if(/gmail/.test(s))throw Error('Nav must not load Gmail');if(s in stubs)return {url:'stub:'+s,shortCircuit:true};if(s==='@/lib/inbox-rules')return n(new URL('../lib/inbox-rules.ts',import.meta.url).href,c);return n(s,c);},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
const {getNavCounts}=await import('../lib/actions/nav.ts');
test('sidebar reads the last normally loaded Needs me classifier count with no Gmail request',async()=>{
 const threads=[{view:'needs_reply'},{view:'needs_reply',newSender:true},{view:'needs_reply',automated:true,attentionRequired:true},{view:'done'}];
 assert.equal((await getNavCounts()).inbox,0);
 rememberNeedsCount('owner',threads.filter(t=>threadNeedsMe(t)).length);
 assert.equal((await getNavCounts()).inbox,2);
 mailbox='staff@example.test';assert.equal((await getNavCounts()).inbox,0);
 assert.equal(loadedNeedsCount('owner'),2); // keyed by the mailbox's user, so an env mailbox without a configured address still counts
});
