import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const root = new URL('../', import.meta.url);
const calls=[];
globalThis.__quantityCalls=calls;
const stubs = {
 'next/cache':'export const revalidatePath=()=>{};',
 '@/lib/db':'export const query=async (...a)=>{globalThis.__quantityCalls.push(a);return {rows:[]}};export const queryOne=async (...a)=>{globalThis.__quantityCalls.push(a);return {estimate_id:1}};',
 '@/lib/dal':'export const requireAccess=async()=>({id:"qa"});',
 '@/lib/commands/db':'export const runDirect=()=>{};export const userPrincipal=()=>{};export const withTransaction=()=>{};',
 '@/lib/estimating/assembly':'export const freezeOfferedPrices=()=>{};',
 '@/lib/authority/client-sends':'export const clientSendVerdict=()=>{};',
 '@/lib/cost-book':'export const getDefaultMarkup=async()=>25;',
 '@/lib/esign':'export const getProjectSignerDefaults=()=>{};',
 '@/lib/notify':'export const emit=()=>{};',
 '@/lib/ai':'export const ai={};',
 '@/lib/doc-drafts':'export const renderProjectEstimatePdf=()=>{};',
 '@/lib/documents':'export const renderInlineDocPdf=()=>{};',
 '@/lib/upload-store':'export const storeBuffer=()=>{};',
 '@/lib/estimates':'export const getScopeChangeContext=()=>{};',
};
registerHooks({resolve(s,c,next){if(stubs[s])return {url:'stub:'+s,shortCircuit:true};if(s.startsWith('@/'))return next(new URL(s.slice(2)+'.ts',root).href,c);return next(s,c)},load(u,c,next){if(u.startsWith('stub:'))return {format:'module',source:stubs[u.slice(5)],shortCircuit:true};return next(u,c)}});
const {addEstimateLine,updateEstimateLine,addTakeoffLines}=await import('../lib/actions/estimates.ts');
const form=qty=>{const f=new FormData();Object.entries({description:'ZZ QA quantity',qty,unitCost:'100',markup:'25'}).forEach(([k,v])=>f.set(k,v));return f};
test('add and edit reject negative and non-finite quantity without any writes',async()=>{
 for(const qty of ['-1','NaN','Infinity','no quantity',''])for(const fn of [addEstimateLine,updateEstimateLine]){
 calls.length=0;
 const r=await fn(1,'zz-qa',form(qty));
 assert.equal(r.ok,false,`${fn.name} ${qty}`);assert.match(r.error,/quantity/i);assert.equal(calls.length,0);
 }
});
test('valid fractional and zero quantities retain their exact value',async()=>{
 for(const qty of ['0','1.25']){calls.length=0;assert.equal((await addEstimateLine(1,'zz-qa',form(qty))).ok,true);assert.equal(calls[0][1][5],Number(qty));}
});
test('bulk takeoff refuses invalid quantities instead of saving just the valid subset',async()=>{
 calls.length=0;
 const r=await addTakeoffLines(1,'zz-qa','General',[{costItemId:1,qty:2},{costItemId:2,qty:-1}]);
 assert.equal(r.ok,false);assert.match(r.error,/quantity/i);assert.equal(calls.length,0);
});
