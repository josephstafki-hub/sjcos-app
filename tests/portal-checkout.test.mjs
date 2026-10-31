import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
const lib=p=>new URL('lib/'+p+'.ts',root).href;
globalThis.__checkoutQA={prepared:0, environment:"fake", decline:"CARD_DECLINED"};
const stubs={
 'server-only':'export {};',
 'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 [lib('dal')]:`export const getCurrentUser=async()=>({role:'client',linkSlug:'zz-qa',email:'zz-qa@example.invalid'});`,
 [lib('db')]:`export const queryOne=async()=>({id:1});`,
 [lib('commands/db')]:`export const runDirect=async sql=>sql.includes('payment_provider_config')?[{connection_state:'connected',environment:'production',location_id:'old',application_id:'old',capabilities:{adapter:'production'}}]:[]; export const withTransaction=async fn=>fn(()=>[]); export const userPrincipal=()=>({kind:"user"});`,
 [lib('commands/source-events')]:'export const recordSourceEvent=async()=>{};',
 [lib('payments/square/index')]:`export const squareEnvironment=()=>globalThis.__checkoutQA.environment; export const getSquareAdapter=()=>({environment:globalThis.__checkoutQA.environment}); export const squareWebhookConfig=()=>({});`,
 [lib('payments/square/signature')]:'export const verifyWebhookSignature=()=>false; export const SQUARE_SIGNATURE_HEADER="x";',
 [lib('payments/service')]:`export const prepareAttempt=()=>{globalThis.__checkoutQA.prepared++;return {ok:true,reused:false,attempt:{id:'zz-qa',state:'created'},invoice:{number:'ZZ QA'}};}; export const chargeAttempt=()=>({kind:'declined',code:globalThis.__checkoutQA.decline,reason:'DEVELOPER diagnostic: secret internal payload'});export const applyProviderPayment=()=>{};export const markAttemptDeclined=()=>{};export const markAttemptUnknown=()=>{};export const processSquareEvent=()=>{};export const reconcilePendingAttempts=()=>{};export const executeRefund=()=>{};export const stageRefundDecision=()=>{};`,
 [lib('payments/surcharge')]:'export const loadSurchargeConfig=async()=>({});',
 [lib('dispatch/db')]:'export const dispatchIntentsNow=async()=>{};',
 [lib('notify-owner')]:'export const sendOwnerPushesNow=async()=>{};',
};
registerHooks({resolve(s,c,n){let u=s.startsWith('@/')?new URL(s.slice(2)+'.ts',root).href:s;if(s.startsWith('.')&&!s.endsWith('.ts')&&c.parentURL?.endsWith('.ts'))u=new URL(s+'.ts',c.parentURL).href;return stubs[u]!=null?{url:'stub:'+u,shortCircuit:true}:n(u,c);},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c);}});
const {checkout,portalPaymentSetup}=await import('../lib/payments/server.ts');
for(const method of ['card','ach'])test(`unconfigured ${method} checkout cannot record a simulated payment`,async()=>{
 const r=await checkout({invoiceId:1,method,nonce:'zz-qa',sourceId:'zz-qa',actor:'portal:client'});
 assert.equal(r.ok,false);assert.ok(r.status<500);assert.match(r.reason,/online payment.*available.*Joe/i);assert.equal(globalThis.__checkoutQA.prepared,0);
});
test('stale connected config does not make sandbox checkout available',async()=>assert.equal((await portalPaymentSetup()).online,false));

const {POST}=await import('../app/api/payments/square/create/route.ts');
for(const method of ['card','ach'])test(`HTTP ${method} checkout returns 409 with a plain fallback instead of a simulated charge`,async()=>{
 const r=await POST(new Request('http://localhost/api/payments/square/create',{method:'POST',body:JSON.stringify({invoiceId:1,method,sourceId:'zz-qa',nonce:'zz-qa'})}));
 assert.equal(r.status,409);assert.match((await r.json()).error,/available.*check.*Joe/);
});
test('real provider declines return plain messages, never raw diagnostics',async()=>{
 globalThis.__checkoutQA.environment='production';
 try {
  for(const code of ['INSUFFICIENT_FUNDS','CARD_EXPIRED','INVALID_ACCOUNT','CARD_DECLINED','NEW_PROVIDER_ERROR']) {
   globalThis.__checkoutQA.decline=code;
   const r=await checkout({invoiceId:1,method:'card',nonce:'zz-qa',sourceId:'zz-qa',actor:'portal:client'});
   assert.equal(r.ok,false);assert.equal(r.status,402);assert.doesNotMatch(r.reason,/DEVELOPER|payload|diagnostic|NEW_PROVIDER_ERROR/);
   assert.match(r.reason,/card|bank|payment/i);
  }
 } finally {globalThis.__checkoutQA.environment='fake';}
});
