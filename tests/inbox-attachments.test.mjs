import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
let user={role:'owner',permissions:[]},reads=0,scope=0;
globalThis.__attachments={get user(){return user},scope:async(fn)=>{scope++;return fn()},read:async(...args)=>{reads++;assert.deepEqual(args,['t1','m1','a1']);return {bytes:Buffer.from('image'),name:'plan.png',type:'image/png'}}};
const stubs={
 '@/lib/dal':`export const getCurrentUser=async()=>globalThis.__attachments.user;export const can=(u,p)=>u?.role==='owner'||u?.role==='staff'&&u.permissions.includes(p);`,
 '@/lib/mailbox':`export const withMailboxFor=async(u,fn)=>globalThis.__attachments.scope(fn);`,
 '@/lib/gmail':`export const fetchInboxAttachment=(...a)=>globalThis.__attachments.read(...a);`,
};
registerHooks({resolve(s,c,n){return s in stubs?{url:'stub:'+s,shortCircuit:true}:n(s,c)},load(u,c,n){return u.startsWith('stub:')?{format:'module',source:stubs[u.slice(5)],shortCircuit:true}:n(u,c)}});
const {GET}=await import('../app/api/inbox/attachment/route.ts');
const request=(query='thread=t1&message=m1&attachment=a1')=>new Request('https://local.test/api/inbox/attachment?'+query);
test('only owner/staff with inbox access can fetch; missing input does not fetch',async()=>{
 for(const candidate of [null,{role:'client',permissions:['inbox']},{role:'staff',permissions:[]}]){user=candidate;assert.equal((await GET(request())).status,403);}
 assert.equal(reads,0);user={role:'owner',permissions:[]};assert.equal((await GET(request('thread=t1'))).status,400);assert.equal(reads,0);
});
test('click retrieval runs in signed-in mailbox with private, safe inline/download response',async()=>{
 for(const candidate of [{role:'owner',permissions:[]},{role:'staff',permissions:['inbox']}]){
  user=candidate;const r=await GET(request());assert.equal(r.status,200);assert.equal(await r.text(),'image');assert.match(r.headers.get('content-disposition'),/^inline/);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 }
 assert.equal(scope,2);assert.equal(reads,2);
 const r=await GET(request('thread=t1&message=m1&attachment=a1&download=1'));assert.match(r.headers.get('content-disposition'),/^attachment/);
});
