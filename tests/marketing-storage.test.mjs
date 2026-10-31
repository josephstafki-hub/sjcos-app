import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const stored=[],updates=[];
globalThis.__marketingDb={
 query:async(sql,args)=>{if(sql.includes('INSERT INTO marketing_drafts'))stored.push(args);if(sql.includes('UPDATE marketing_drafts'))updates.push(args);return {rows:[{id:42}]};},
 queryOne:async(sql)=>sql.includes('FROM projects')?{id:'project',name:'Kitchen',scope:'Cabinets',city:'St Paul'}:sql.includes('count(*)')?{n:1}:null,
};
registerHooks({resolve(s,c,n){
 if(s==='next/cache'||s==='@/lib/notify'||s==='server-only')return {url:'data:text/javascript,export const revalidatePath=()=>{};export const emit=async()=>{};',shortCircuit:true};
 if(s==='@/lib/dal')return {url:'data:text/javascript,export const requireAccess=async()=>({role:"owner"});',shortCircuit:true};
 if(s==='@/lib/db')return {url:'data:text/javascript,export const query=globalThis.__marketingDb.query;export const queryOne=globalThis.__marketingDb.queryOne;',shortCircuit:true};
 if(s==='@/lib/commands/db')return {url:'data:text/javascript,export const runDirect=async()=>{throw new Error("Unexpected publication write");};export const userPrincipal=()=>{throw new Error("Unexpected publication principal");};export const withTransaction=async(fn)=>fn(async(sql,args)=>(await globalThis.__marketingDb.query(sql,args)).rows);',shortCircuit:true};
 if(s==='@/lib/closeout/marketing')return {url:'data:text/javascript,export const noteDraftEdited=async()=>{};export const getDraft=async()=>null;export const grantPublicationRights=async()=>{};export const withdrawPublicationRights=async()=>{};export const setDraftPost=async()=>({rejectedPhotoIds:[]});export const stagePublication=async()=>{};',shortCircuit:true};
 if(s==='@/lib/upload-store')return {url:'data:text/javascript,export const storeUpload=async()=>{throw new Error("Unexpected upload");};',shortCircuit:true};
 if(s==='@/lib/publisher/server')return {url:'data:text/javascript,export const retryPost=async()=>({ok:true});export const savePostingAccounts=async()=>({ok:true});export const settlePost=async()=>({ok:true});',shortCircuit:true};
 if(s==='@/lib/ai')return {url:'data:text/javascript,export const ai={ask:async()=>({answer:globalThis.__aiCopy})};',shortCircuit:true};
 if(s.startsWith('@/'))return n(new URL('../'+s.slice(2)+'.ts',import.meta.url).href,c);
 return n(s,c);
}});
const {generateDraft,autoDraftBlogOnCompletion,autoDraftSocialOnCompletion,updateDraft}=await import('../lib/actions/marketing.ts');
test('manual and both completion paths store prose rather than an AI envelope',async()=>{
 globalThis.__aiCopy=JSON.stringify({blogPost:{title:'A kitchen',content:['First paragraph.','Second paragraph.']}});
 const created = await generateDraft('kitchen','blog');
 assert.equal(created.id,42,'Website can select the exact newly generated draft');
 assert.equal(stored[0][3],'First paragraph.\n\nSecond paragraph.');
 assert.equal(stored[0][2],'A kitchen');
 await autoDraftBlogOnCompletion('kitchen');
 assert.equal(stored[1][2],'First paragraph.\n\nSecond paragraph.');
 globalThis.__aiCopy=JSON.stringify({post:'Finished a kitchen.',hashtags:['carpentry','remodel']});
 await autoDraftSocialOnCompletion('kitchen');
 assert.equal(stored[2][2],'Finished a kitchen.\n\n#carpentry #remodel');
});

test('editing repaired copy preserves an editable headline alongside the prose',async()=>{
 const r=await updateDraft(42,'Edited paragraphs.','A better kitchen');
 assert.equal(r.ok,true);assert.deepEqual(updates.at(-1),[42,'Edited paragraphs.','A better kitchen']);
});
