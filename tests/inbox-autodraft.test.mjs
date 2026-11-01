import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const stubs = {
  'server-only': '',
  './db': `export const query = async (sql,p=[]) => globalThis.__auto.query(sql,p);
    export const queryOne = async (sql,p) => (await query(sql,p)).rows[0] ?? null;`,
  './inbox': `export const getInboxData=async owner=>{globalThis.__auto.loads++;globalThis.__auto.owner=owner;return globalThis.__auto.data};
    export const gatherReplyContext=async()=>({knowledge:[{kind:'scope',content:'Approved closet plan'}],matchLabel:'project Closet'});
    export const draftReplyForThread=async (id,model)=>{globalThis.__auto.models.push(model);if(globalThis.__auto.fail)throw globalThis.__auto.fail;return {body:'Hermes reply',toEmail:'client@example.test',subject:'Plans',basedOn:'project Closet'}};`,
  './gmail': `export const fetchConversation=async id=>{globalThis.__auto.fetches++;if(globalThis.__auto.fail)throw globalThis.__auto.fail;return globalThis.__auto.conversation(id)};
    export const isGmailRateLimit=e=>e?.code===429;`,
  './dev-agents': `export const chatReplyClaude=async (prompt)=>{globalThis.__auto.models.push('claude');globalThis.__auto.prompts.push(prompt);return globalThis.__auto.response??'Claude reply'};`,
  './direct-send-gate': `export const directSendBlocked=async()=>globalThis.__auto.blocked;`,
  './agent-runtime/instructions': `export const loadActiveInstructionBlocks=async()=>({tone_guide:{body:'TONE: plain words, no jargon.'}});`,
  './mailbox-email': `export const ensureMailboxEmail=async()=>'joe@example.test';`,
  './mailbox': `export const mailboxFor=async owner=>({email:'JOE@example.test',refreshToken:'stub',userId:owner.id});
    export const runWithMailbox=async(mb,fn)=>{globalThis.__auto.mailbox=mb;return fn()};`,
};
registerHooks({
  resolve(s,c,n) {
    if(c.parentURL?.endsWith('/lib/inbox-autodraft.ts') && s in stubs) return {url:'stub:auto:'+s,shortCircuit:true};
    if(s==='./inbox-rules')return n('../lib/inbox-rules.ts',c);
    return n(s,c);
  },
  load(u,c,n) {return u.startsWith('stub:auto:')?{format:'module',source:stubs[u.slice(10)],shortCircuit:true}:n(u,c)},
});
const { selectAutoDraftCandidates, sweepInboxDrafts, claimAutoDraft } = await import('../lib/inbox-autodraft.ts');
const makeThread = (id, patch={})=>({id,channel:'email',view:'needs_reply',contactRole:'client',fromName:'Client',preview:'Can we review plans?',inboundLast:true,receivedAt:Number(id)||1,...patch});
const makeData=(threads)=>({threads,mailbox:{connected:true},readers:Object.fromEntries(threads.map(t=>[t.id,{messages:[{id:'m-'+t.id,outbound:false,fromEmail:'client@example.test',date:t.receivedAt}],replyTarget:{toEmail:'client@example.test'}}]))});
let clock;
beforeEach(()=>{
 clock=0;
 const claims=new Map();
 globalThis.__auto={claims,loads:0,fetches:0,models:[],prompts:[],settings:[],data:makeData([makeThread('1')]),blocked:null,human:new Set(),
   conversation:id=>({subject:'Plans',ownAddresses:['joe@example.test'],messages:[{id:'old',outbound:true,fromEmail:'joe@example.test',fromName:'Joe',body:['Previous note']},{id:'m-'+id,outbound:false,fromEmail:'client@example.test',fromName:'Client',body:['Review plans\nOn Tuesday, Joe wrote:\n> quoted'],to:['joe@example.test']}]}),
   async query(sql,p){
    const a=globalThis.__auto;
    if(/FROM app_settings/.test(sql))return {rows:a.settings};
    if(/FROM users/.test(sql))return {rows:[{id:'owner',role:'owner'}]};
    if(/SELECT id, thread_key, source_message_id, summary, version/.test(sql))return {rows:a.existing??[]};
    if(/UPDATE inbox_drafts SET summary=/.test(sql)){a.headlineWrites??=[];a.headlineWrites.push(p);assert.match(sql,/version=\$2 AND status='ready'/);return {rows:[{id:p[0]}]};}
    if(/INSERT INTO inbox_drafts/.test(sql)) {
      assert.match(sql,/NOT EXISTS[\s\S]+source='human' AND status='ready'/);
      assert.match(sql,/updated_at < now\(\)-interval '10 minutes'/);
      assert.equal(p[0],'joe@example.test');
      if(a.human.has(p[1]))return {rows:[]};
      const key=p[1]+':'+p[2];const old=claims.get(key);
      if(old && !(old.status==='failed'||old.status==='drafting' && old.at < clock-600_000))return {rows:[]};
      const row={id:key,version:(old?.version??0)+1,status:'drafting',at:clock};claims.set(key,row);return {rows:[{...row}]};
    }
    if(/UPDATE inbox_drafts/.test(sql)) {
      assert.match(sql,/version=\$2 AND status='drafting'/);
      const row=claims.get(p[0]);if(!row||row.version!==p[1]||row.status!=='drafting')return {rows:[]};
      if(/status='failed'/.test(sql)) {row.status='failed';row.error=p[2];return {rows:[]};}
      assert.match(sql,/THEN 'discarded' ELSE 'ready'/);
      row.status=a.human.has(p[9])?'discarded':'ready';row.body=p[2];row.summary=p[3];row.at=clock;return {rows:[{status:row.status}]};
    }
    throw Error('Unexpected SQL: '+sql);
   }
 };
});
test('existing classification accepts known client/lead/sub and rejects automation, screening, done, outbound-last',()=>{
 const threads=[makeThread('client'),makeThread('lead',{contactRole:'lead'}),makeThread('sub',{contactRole:'sub'}),
 makeThread('auto',{automated:true}),makeThread('new',{newSender:true}),makeThread('done',{view:'done'}),
 makeThread('out',{inboundLast:false}),makeThread('unknown',{contactRole:undefined}),makeThread('vendor',{contactRole:'vendor'}),makeThread('other',{filedOther:true}),makeThread('no-reply')];
 const data=makeData(threads);data.readers['no-reply'].replyTarget.toEmail='noreply@example.test';
 assert.deepEqual(selectAutoDraftCandidates(data).map(c=>c.thread.id),['client','lead','sub']);
 data.readers.client.messages.at(-1).outbound=true;
 assert.ok(!selectAutoDraftCandidates(data).some(c=>c.thread.id==='client'));
 data.emailPaused=true;assert.equal(selectAutoDraftCandidates(data).length,0);
});
test('default on/Claude, one conversation fetch, grounded and bounded, never sends or Qwen',async()=>{
 const result=await sweepInboxDrafts();assert.equal(result.ready,1);assert.equal(__auto.loads,1);assert.equal(__auto.fetches,1);
 assert.deepEqual(__auto.models,['claude']);assert.equal(__auto.owner.role,'owner');assert.equal(__auto.mailbox.userId,'owner');
 assert.match(__auto.prompts[0],/Approved closet plan/);assert.match(__auto.prompts[0],/Previous note/);assert.doesNotMatch(__auto.prompts[0],/> quoted/);
 assert.equal(__auto.claims.get('1:m-1').summary,'Client: Can we review plans?');
 const source=readFileSync(new URL('../lib/inbox-autodraft.ts',import.meta.url),'utf8');assert.doesNotMatch(source,/sendNewEmail|sendReply|ai\.draft|askQwen/);
});
test('setting off does no inbox or model work',async()=>{
 __auto.settings=[{key:'ai.inboxAutoDraft',value:'false'}];assert.equal((await sweepInboxDrafts()).disabled,true);assert.equal(__auto.loads,0);assert.equal(__auto.models.length,0);
});
test('Hermes is explicit and invalid model settings fall back to Claude',async()=>{
 __auto.settings=[{key:'ai.inboxDraftModel',value:'hermes'}];await sweepInboxDrafts();assert.deepEqual(__auto.models,['hermes']);assert.equal(__auto.fetches,0);
 __auto.claims.clear();__auto.settings=[{key:'ai.inboxDraftModel',value:'qwen'}];await sweepInboxDrafts();assert.deepEqual(__auto.models,['hermes','claude']);
});
test('idempotency, concurrent claims, and stale reclaim with a version fence',async()=>{
 const candidate=selectAutoDraftCandidates(__auto.data)[0];
 const [a,b]=await Promise.all([claimAutoDraft('JOE@example.test','owner',candidate,'claude'),claimAutoDraft('joe@example.test','owner',candidate,'claude')]);
 assert.equal([a,b].filter(Boolean).length,1);
 assert.equal(await claimAutoDraft('joe@example.test','owner',candidate,'claude'),null);
 clock=600_001;const reclaimed=await claimAutoDraft('joe@example.test','owner',candidate,'claude');assert.equal(reclaimed.version,2);
 const fenced=await __auto.query("UPDATE inbox_drafts SET status='failed' WHERE id=$1 AND version=$2 AND status='drafting'",[a.id,a.version,'late error']);assert.equal(fenced.rows.length,0);
 __auto.claims.clear();await sweepInboxDrafts();await sweepInboxDrafts();assert.equal(__auto.models.length,1);
});
test('cap of three, oldest first, skips human drafts and blocked lanes',async()=>{
 __auto.data=makeData([5,3,1,4,2].map(i=>makeThread(String(i))));__auto.human.add('1');
 const result=await sweepInboxDrafts();assert.equal(result.attempted,3);assert.equal(result.ready,3);
 assert.deepEqual([...__auto.claims.keys()],['2:m-2','3:m-3','4:m-4']);
 __auto.blocked='paused';__auto.claims.clear();assert.equal((await sweepInboxDrafts()).attempted,0);
});
test('Gmail rate limit records failure then stops before further conversation calls',async()=>{
 __auto.data=makeData([1,2,3].map(i=>makeThread(String(i))));__auto.fail=Object.assign(new Error('Gmail quota'),{code:429});
 await assert.rejects(sweepInboxDrafts,/Gmail quota/);assert.equal(__auto.fetches,1);assert.equal(__auto.claims.size,1);assert.equal(__auto.claims.get('1:m-1').status,'failed');
});
test('normal failure is stored; later candidates can draft; paused loader does not use stale data',async()=>{
 __auto.conversation=()=>({subject:'Changed',ownAddresses:[],messages:[]});const result=await sweepInboxDrafts();assert.equal(result.failed,1);assert.match(__auto.claims.get('1:m-1').error,/conversation changed/);
 __auto.data.emailPaused=true;await assert.rejects(sweepInboxDrafts,/paused/);assert.equal(__auto.models.length,0);
});
test('a human draft started during generation wins; dismissed/sent suggestions remain idempotent',async()=>{
 const original=__auto.query;__auto.query=async(sql,p)=>{
  if(/UPDATE inbox_drafts SET body=/.test(sql))__auto.human.add('1');
  return original(sql,p);
 };
 const result=await sweepInboxDrafts();assert.equal(result.ready,0);assert.equal(__auto.claims.get('1:m-1').status,'discarded');
 __auto.human.clear();const candidate=selectAutoDraftCandidates(__auto.data)[0];
 assert.equal(await claimAutoDraft('joe@example.test','owner',candidate,'claude'),null);
 __auto.claims.get('1:m-1').status='sent';assert.equal(await claimAutoDraft('joe@example.test','owner',candidate,'claude'),null);
});

test('Claude auto-drafts carry Joe\'s tone guide, sender-only/no-pricing rules and his sign-off', async () => {
  await sweepInboxDrafts();
  const p = globalThis.__auto.prompts[0];
  assert.ok(p, 'the sweep drafted with Claude');
  assert.match(p, /TONE: plain words/);
  assert.match(p, /Address only the sender/);
  assert.match(p, /Never volunteer prices/);
  assert.match(p, /Joe\nSJ Carpentry LLC\n612-361-6585/);
});

test('an AI draft never opens with envelope lines — the composer shows To/Subject itself', async () => {
  const { stripDraftHeaders } = await import('../lib/inbox-rules.ts');
  assert.equal(stripDraftHeaders('To: teresa@example.test\nSubject: Re: Basement project details\n\nHi Teresa,\nThanks!'), 'Hi Teresa,\nThanks!');
  assert.equal(stripDraftHeaders('Hi Teresa,\nSubject: the basement is great'), 'Hi Teresa,\nSubject: the basement is great');
});

test('Claude writes a short headline line that becomes the row action, never part of the reply body', async () => {
  const { splitHeadline } = await import('../lib/inbox-autodraft.ts');
  assert.deepEqual(splitHeadline('HEADLINE: Price hallway painting and popcorn removal\n\nHi Michelle,\nThanks!'), { headline: 'Price hallway painting and popcorn removal', body: 'Hi Michelle,\nThanks!' });
  assert.deepEqual(splitHeadline('Hi Michelle,\nThanks!'), { headline: '', body: 'Hi Michelle,\nThanks!' });
  assert.equal(splitHeadline('Headline: "Confirm deck visit"\nTo: x@y.test\n\nHi,').body, 'Hi,');
});


test('unseen older ready drafts backfill missing headlines from stored inbound, within shared three-call cap',async()=>{
 __auto.data=makeData([1,2,3,4].map(i=>makeThread(String(i),{fromName:'Rowan',preview:'Can you quote a garden gate?'})));
 for(const reader of Object.values(__auto.data.readers))reader.messages[0].body=['Could you quote a garden gate in cedar?'];
 __auto.existing=[1,2,3,4].map(i=>({id:'draft-'+i,thread_key:String(i),source_message_id:'m-'+i,version:2,summary:'Rowan: …And provide a quote'}));
 __auto.response='HEADLINE: Quote a cedar garden gate';
 const result=await sweepInboxDrafts();
 assert.equal(result.attempted,3);assert.equal(result.headlines,3);assert.equal(__auto.fetches,0);
 assert.deepEqual(__auto.models,['claude','claude','claude']);
 assert.equal(__auto.headlineWrites.length,3);assert.match(__auto.prompts[0],/garden gate in cedar/);
 assert.equal(__auto.headlineWrites[0][2],'Quote a cedar garden gate');
 assert.equal(__auto.claims.size,0,'backfill does not redraft ready bodies');
});
test('existing useful headlines are left alone, even with Hermes configured',async()=>{
 __auto.existing=[{id:'ready',thread_key:'1',source_message_id:'m-1',summary:'Confirm the fence visit',version:1}];
 __auto.settings=[{key:'ai.inboxDraftModel',value:'hermes'}];
 assert.equal((await sweepInboxDrafts()).attempted,0);assert.equal(__auto.models.length,0);assert.equal(__auto.fetches,0);
});
