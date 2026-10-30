import {test} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);globalThis.__viewer={role:'staff',permissions:['projects']};globalThis.__contextQueries=[];
registerHooks({resolve(s,c,n){const stubs={'server-only':'','@/lib/dal':'export const requireAccess=async()=>globalThis.__viewer;', '@/lib/db':'export const queryOne=async(sql,p)=>{globalThis.__contextQueries.push(sql);return {id:p[0],name:"Kitchen",client_name:"Joe"}};'};if(s in stubs)return {url:'data:text/javascript,'+encodeURIComponent(stubs[s]),shortCircuit:true};if(s.startsWith('@/'))return n(new URL(s.slice(2)+'.ts',root).href,c);return n(s,c);}});
test('mentioned records are reloaded under current permissions; denied invoice data is never queried',async()=>{
 const {loadPanelContext}=await import('../lib/panel-context.ts');
 const context=await loadPanelContext([{kind:'project',id:'p'},{kind:'invoice',id:'2'},{kind:'bogus',id:'x'}]);
 assert.match(context,/Kitchen/);assert.match(context,/project.*p/);assert.equal(globalThis.__contextQueries.length,1);
 assert.equal(await loadPanelContext([]),'');
});
