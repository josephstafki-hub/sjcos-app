import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
globalThis.__copyRows=[{id:1,kind:'blog',title:'Stored title',body:'{"unrecognized":"internal data"}',status:'draft',project_slug:'source-project'}, {id:2,kind:'blog',title:'Legacy title',body:'{"blogPost":{"title":"Clean title","content":["Paragraph one.","Paragraph two."]}}',status:'draft'}];
registerHooks({resolve(s,c,n){
 if(s==='server-only')return {url:'data:text/javascript,',shortCircuit:true};
 if(s==='./db')return {url:'data:text/javascript,export const query=async(sql)=>({rows:sql.includes("FROM marketing_drafts")?globalThis.__copyRows:[]});',shortCircuit:true};
 if(s.startsWith('./')&&!s.endsWith('.ts'))return n(new URL(s+'.ts',c.parentURL).href,c);
 return n(s,c);
}});
const {getSiteComposerData}=await import('../lib/site.ts');
const {getMarketingDrafts}=await import('../lib/marketing.ts');
test('unreadable stored posts keep recovery instructions outside publishable copy in both readers',async()=>{
 for(const drafts of [(await getSiteComposerData()).posts,await getMarketingDrafts()]) {
  assert.equal(drafts[0].body,'');
  assert.equal(drafts[0].projectSlug,'source-project');
  assert.match(drafts[0].copyError,/could not be read/);
  assert.equal(drafts[1].body,'Paragraph one.\n\nParagraph two.');
  assert.equal(drafts[1].title,'Clean title');
  assert.equal(drafts[1].copyError,undefined);
 }
});
