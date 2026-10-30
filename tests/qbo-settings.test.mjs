import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let verified=0,writes=0;
globalThis.__qboSettings={verify:async()=>{verified++;return {realmId:'fake',companyName:'Sample company'};},write:()=>{writes++;}};
const stub=code=>({url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true});
registerHooks({resolve(s,c,n){
 if(s==='server-only')return stub('');
 if(s==='@/lib/commands/db')return stub('export const withTransaction=globalThis.__qboSettings.write;export const runDirect=()=>{};export const ownerPrincipalForPolicy=()=>{};');
 if(s==='./qbo/index')return stub('export const qboEnvironment=()=>"fake";export const getQboAdapter=()=>({companyInfo:globalThis.__qboSettings.verify});export const qboConnectionSource=()=>({});export const fileTokenStore=()=>{};export const qboConnectionFile=()=>{};export const qboOAuthConfigured=()=>false;export const qboTokenFile=()=>{};export const resetQboAdapter=()=>{};export const writeConnectionRecord=()=>{};');
 if(s==='./qbo/oauth')return stub('export const exchangeCode=()=>{};export const qboRedirectUri=()=>{};export const revokeToken=()=>{};');
 if(s==='./qbo/sync')return stub('export const ensureConnection=()=>{};export const importPostedEntities=()=>{};export const exportEach=()=>{};export const exportIssuedInvoice=()=>{};export const exportConfirmedPayment=()=>{};export const qboSummary=()=>{};export const switchOn=()=>{};');
 return n(s,c);
}});
const {refreshQboConnection}=await import('../lib/accounting/server.ts');
test('a sample QuickBooks company cannot pass a connection check',async()=>{
 const r=await refreshQboConnection();assert.equal(r.ok,false);assert.match(r.error,/Not connected/);assert.match(r.error,/account administrator/);
 assert.equal(verified,0);assert.equal(writes,0);
});
