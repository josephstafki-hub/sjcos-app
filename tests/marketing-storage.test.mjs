import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const stored=[];
globalThis.__marketingDb={
 query:async(sql,args)=>{if(sql.includes('INSERT INTO marketing_drafts'))stored.push(args);return {rows:[]};},
 queryOne:async(sql)=>sql.includes('FROM projects')?{id:'project',name:'Kitchen',scope:'Cabinets',city:'St Paul'}:sql.includes('count(*)')?{n:1}:null,
};
registerHooks({resolve(s,c,n){
 if(s==='next/cache'||s==='@/lib/notify'||s==='server-only')return {url:'data:text/javascript,export const revalidatePath=()=>{};export const emit=async()=>{};',shortCircuit:true};
 if(s==='@/lib/dal')return {url:'data:text/javascript,export const requireAccess=async()=>({role:"owner"});',shortCircuit:true};
 if(s==='@/lib/db')return {url:'data:text/javascript,export const query=globalThis.__marketingDb.query;export const queryOne=globalThis.__marketingDb.queryOne;',shortCircuit:true};
 if(s==='@/lib/ai')return {url:'data:text/javascript,export const ai={ask:async()=>({answer:globalThis.__aiCopy})};',shortCircuit:true};
 if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+'.ts',import.meta.url).href,c);
 return n(s,c);
}});
const {generateDraft,autoDraftBlogOnCompletion,autoDraftSocialOnCompletion}=await import('../lib/actions/marketing.ts');
test('manual and both completion paths store prose rather than an AI envelope',async()=>{
 globalThis.__aiCopy=JSON.stringify({blogPost:{title:'A kitchen',content:['First paragraph.','Second paragraph.']}});
 await generateDraft('kitchen','blog');
 assert.equal(stored[0][3],'First paragraph.\n\nSecond paragraph.');
 assert.equal(stored[0][2],'A kitchen');
 await autoDraftBlogOnCompletion('kitchen');
 assert.equal(stored[1][2],'First paragraph.\n\nSecond paragraph.');
 globalThis.__aiCopy=JSON.stringify({post:'Finished a kitchen.',hashtags:['carpentry','remodel']});
 await autoDraftSocialOnCompletion('kitchen');
 assert.equal(stored[2][2],'Finished a kitchen.\n\n#carpentry #remodel');
});
