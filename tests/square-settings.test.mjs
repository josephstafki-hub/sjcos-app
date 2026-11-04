import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const writes=[];let verified=0;
globalThis.__squareQa={query:async(sql,args)=>{if(sql.startsWith('SELECT'))return {rows:[{location_id:'test-location'}]};writes.push([sql,args]);return {rows:[]};},adapter:{environment:'fake',verifyConnection:async()=>{verified++;return {merchantApproved:true,card:true,ach:true,refunds:true};}}};
const stub=(code)=>({url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true});
registerHooks({resolve(s,c,n){
 if(s==='next/cache')return stub('export const revalidatePath=()=>{};');
 if(s==='@/lib/dal')return stub('export const requireRole=async()=>({role:"owner"});');
 if(s==='@/lib/db')return stub('export const query=globalThis.__squareQa.query;');
 if(s==='@/lib/commands/db')return stub('export const withTransaction=()=>{};export const userPrincipal=()=>{};');
 if(s==='./square/index')return stub('export const getSquareAdapter=()=>globalThis.__squareQa.adapter;export const squareEnvironment=()=>globalThis.__squareQa.adapter.environment;');
 if(s==='./service')return stub('export const stageRefundDecision=()=>{};export const executeRefund=()=>{};');
 if(s==='./surcharge')return stub('export const parseSurchargeConfig=()=>{};export const SURCHARGE_SETTING_KEY="";');
 return n(s,c);
}});
const {testSquareConnection}=await import('../lib/payments/actions.ts');
test('Test connection refuses a simulated merchant and clears stale approval claims',async()=>{
 const result=await testSquareConnection();
 assert.equal(result.ok,false);assert.match(result.error,/Not connected — add your Square keys/);
 assert.equal(verified,0,'fake merchant verification is never treated as a connection check');
 assert.match(writes[0][0],/connection_state = 'unconfigured'/);assert.match(writes[0][0],/capabilities = '\{\}'::jsonb/);
});
