import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
globalThis.__searchCalls=[];
globalThis.__viewer={id:'staff',role:'staff',permissions:['projects']};
registerHooks({resolve(s,c,n){
 const stub={'server-only':'','@/lib/dal':'export const requireUser=async()=>globalThis.__viewer;', '@/lib/db':'export const query=async(...a)=>{globalThis.__searchCalls.push(a);return {rows:[]}};'};
 if(s in stub)return {url:'data:text/javascript,'+encodeURIComponent(stub[s]),shortCircuit:true};
 if(s.startsWith('@/'))return n(new URL(s.slice(2)+'.ts',root).href,c);return n(s,c);
}});
test('staff search never queries denied business areas or shared panel history',async()=>{
 const {searchPanel}=await import('../lib/panel-search.ts');
 const rows=await searchPanel('projects');
 assert.ok(rows.some(r=>r.href==='/projects'));assert.ok(!rows.some(r=>r.href==='/money'));
 assert.ok(globalThis.__searchCalls.some(([q])=>q.includes('FROM projects')));
 assert.ok(!globalThis.__searchCalls.some(([q])=>/FROM (leads|invoices|vendors|subs|ai_conversations)/.test(q)));
});
test('search escapes wildcard input and bounds server requests',async()=>{
 globalThis.__searchCalls=[];globalThis.__viewer={id:'owner',role:'owner',permissions:[]};
 const {searchPanel}=await import('../lib/panel-search.ts');await searchPanel('%_');
 assert.ok(globalThis.__searchCalls.length);for(const [sql,params] of globalThis.__searchCalls){assert.match(sql,/LIMIT/);assert.ok(params.includes('%\\%\\_%'));}
});
test('portal roles receive no palette data',async()=>{
 globalThis.__searchCalls=[];globalThis.__viewer={id:'client',role:'client',permissions:[]};
 const {searchPanel}=await import('../lib/panel-search.ts');assert.deepEqual(await searchPanel('job'),[]);assert.equal(globalThis.__searchCalls.length,0);
});
