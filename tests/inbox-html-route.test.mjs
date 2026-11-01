import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';

// Real cache/renderer, fake SDK + authentication/mailbox scope. No live IO.
let user=null,calls=0,fail=false,connected=true;
const scope=new AsyncLocalStorage();
const payload={messages:[{id:'msg-71',payload:{mimeType:'text/html',body:{data:Buffer.from('<p>Inspection report #71</p><script>bad()</script>').toString('base64url')}}}]};
globalThis.__htmlRoute={get user(){return user},get mailbox(){return scope.getStore()},withMailboxFor:(u,fn)=>scope.run({userId:u.id,email:u.email,refreshToken:connected?`fake-${u.id}`:null},fn),
 api:{users:{threads:{get:async()=>{calls++;if(fail)throw Error('PRIVATE ERROR');return {data:payload};}},messages:{attachments:{get:async()=>{throw Error('Unexpected attachment');}}}}}};
process.env.GMAIL_CLIENT_ID='test';process.env.GMAIL_CLIENT_SECRET='test';
const stubs={
 'server-only':'',
 'googleapis':'export const google={auth:{OAuth2:class{setCredentials(){}}},gmail:()=>globalThis.__htmlRoute.api};',
 '@/lib/dal':`export const getCurrentUser=async()=>globalThis.__htmlRoute.user;export const can=(u,p)=>u.role==='owner'||u.role==='staff'&&u.permissions.includes(p);`,
 '@/lib/mailbox':`export const withMailboxFor=(u,fn)=>globalThis.__htmlRoute.withMailboxFor(u,fn);`,
 './mailbox':`export const activeMailbox=()=>globalThis.__htmlRoute.mailbox;`,
};
registerHooks({resolve(s,c,n){
 if(s in stubs)return {url:'html-stub:'+s,shortCircuit:true};
 if(s==='@/lib/gmail')return n(new URL('../lib/gmail.ts',import.meta.url).href,c);
 if(s==='@/lib/inbox-email-content')return n(new URL('../lib/inbox-email-content.ts',import.meta.url).href,c);
 if(s.startsWith('./')&&c.parentURL?.endsWith('.ts')&&!s.endsWith('.ts'))return n(s+'.ts',c);
 throwIfLive(s);return n(s,c);
},load(u,c,n){return u.startsWith('html-stub:')?{format:'module',source:stubs[u.slice(10)],shortCircuit:true}:n(u,c);}});
function throwIfLive(s){if(/(?:^|\/)(?:db|dal|mailbox)$/.test(s))throw Error('Unstubbed live dependency '+s);}
const {GET}=await import('../app/api/inbox/html/route.ts');
const {fetchMessageHtml}=await import('../lib/gmail.ts');
const request=(q='thread=thread-71&message=msg-71')=>new Request('https://local.test/api/inbox/html?'+q);
const owner={id:'owner',role:'owner',email:'owner@example.test'};
test('HTML GET rejects unauthenticated, portal and unpermitted staff reads before mailbox access',async()=>{
 for(const [candidate,status] of [[null,401],[{role:'client',permissions:['inbox']},403],[{role:'staff',permissions:[]},403]]){
  user=candidate;const response=await GET(request());assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 }
 assert.equal(calls,0);
});
test('HTML GET validates both ids without reading any mailbox',async()=>{
 user=owner;
 for(const q of ['', 'thread=thread-71','thread=bad%0A&message=msg-71','thread=thread-71&message=../no',`thread=${'a'.repeat(513)}&message=msg-71`])assert.equal((await GET(request(q))).status,400);
 assert.equal(calls,0);
});
test('HTML GET shares the existing payload and rendered HTML caches with action reads, scoped to the viewer',async()=>{
 user=owner;
 const cached=await globalThis.__htmlRoute.withMailboxFor(user,()=>fetchMessageHtml('thread-71','msg-71'));
 assert.match(cached,/Inspection report #71/);assert.doesNotMatch(cached,/<script/);assert.equal(calls,1);
 for(let i=0;i<2;i++){
  const response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{status:'formatted',html:cached});
 }
 assert.equal(calls,1,'GET reuses the actual Gmail detail cache');
 user={id:'staff',role:'staff',permissions:['inbox'],email:'staff@example.test'};
 assert.equal((await GET(request())).status,200);assert.equal(calls,2,'another mailbox cannot hit owner cache');
});
test('HTML GET has honest disconnected, failed and text-only outcomes without private error detail',async()=>{
 user=owner;connected=false;let response=await GET(request());assert.equal(response.status,503);assert.equal((await response.json()).status,'failed');assert.equal(calls,2);
 connected=true;fail=true;response=await GET(request('thread=failed&message=msg-71'));assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/PRIVATE/);
 fail=false;payload.messages[0].payload={mimeType:'text/plain',body:{data:Buffer.from('Plain notice').toString('base64url')}};
 response=await GET(request('thread=text-only&message=msg-71'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'text-only',html:''});
});
