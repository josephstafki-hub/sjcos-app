import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let user=null,reads=[],fail=false;
globalThis.__contextRoute={get user(){return user},load:async input=>{reads.push(input);if(fail)throw Error('DB detail must stay private');return {person:null,job:null,schedule:null,todos:[]};}};
const stubs={
 '@/lib/dal':`export const getCurrentUser=async()=>globalThis.__contextRoute.user;export const can=(u,perm)=>u.role==='owner'||(u.role==='staff'&&u.permissions?.includes(perm));`,
 '@/lib/inbox-context':`export const loadInboxContext=input=>globalThis.__contextRoute.load(input);export const withoutMoney=c=>c.job?{...c,job:{...c.job,money:null}}:c;`,
};
registerHooks({resolve(s,c,n){if(s.includes('gmail'))throw Error('Context must not load Gmail');return s in stubs?{url:'stub:'+s,shortCircuit:true}:n(s,c)},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c)}});
const {GET}=await import('../app/api/inbox/context/route.ts');
const request=(query='threadId=email-1&email=tom%40example.test&projectSlug=closet')=>new Request('https://local.test/api/inbox/context?'+query);
test('context GET requires a signed-in owner or staff member with Inbox permission',async()=>{
 assert.equal((await GET(request())).status,401);
 for(const candidate of [{role:'client',permissions:['inbox']},{role:'staff',permissions:[]}]){user=candidate;assert.equal((await GET(request())).status,403);}
 assert.equal(reads.length,0);
});
test('context GET reuses the existing read loader with private no-store responses',async()=>{
 for(const candidate of [{role:'owner'},{role:'staff',permissions:['inbox']}]){
  user=candidate;const response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual((await response.json()).todos,[]);
 }
 assert.deepEqual(reads[0],{threadId:'email-1',email:'tom@example.test',projectSlug:'closet'});
});
test('invalid context ids never read; read failures are retryable without DB details',async()=>{
 user={role:'owner'};const count=reads.length;
 for(const query of ['',`threadId=${'x'.repeat(513)}`,'threadId=test%0A'])assert.equal((await GET(request(query))).status,400);
 assert.equal(reads.length,count);fail=true;const response=await GET(request());assert.equal(response.status,503);assert.match((await response.json()).error,/Try again/);
});

test('job money in context only reaches owners and staff with the Money area',async()=>{
 fail=false;const load=globalThis.__contextRoute.load;
 globalThis.__contextRoute.load=async()=>({person:null,job:{slug:'closet',name:'Closet',stage:'Construction',kind:'project',money:{total:970200,paid:745200,outstanding:225000}},schedule:null,todos:[]});
 try{
  for(const [candidate,shown] of [[{role:'owner'},true],[{role:'staff',permissions:['inbox','money']},true],[{role:'staff',permissions:['inbox']},false]]){
   user=candidate;const body=await (await GET(request())).json();assert.equal(Boolean(body.job.money),shown,JSON.stringify(candidate));
  }
 }finally{globalThis.__contextRoute.load=load;}
});
