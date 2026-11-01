import { test } from "node:test";
import assert from "node:assert/strict";
const { withReadGate,coalesceInboxRead } = await import("../lib/inbox-read-gate.ts");

test("no more than two reads run at once per mailbox; others queue and all finish", async () => {
  let running = 0, peak = 0;
  const job = () => withReadGate("html:joe", async () => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--; return "ok";
  });
  const results = await Promise.all(Array.from({ length: 7 }, job));
  assert.equal(peak, 2);
  assert.deepEqual(results, Array(7).fill("ok"));
});

test('identical in-flight HTML reads coalesce; one departing reader cannot cancel another',async()=>{
 let reads=0,release;const one=new AbortController(),two=new AbortController();
 const work=async()=>{reads++;await new Promise(resolve=>release=resolve);return '<p>Awning sample</p>';};
 const first=coalesceInboxRead('awning-message',work,one.signal);
 const second=coalesceInboxRead('awning-message',work,two.signal);
 await Promise.resolve();assert.equal(reads,1);
 one.abort();await assert.rejects(first,{name:'AbortError'});release();assert.equal(await second,'<p>Awning sample</p>');
 assert.equal(await coalesceInboxRead('awning-message',async()=>{reads++;return 'fresh'}),'fresh');assert.equal(reads,2);
});

test('returning to a message reuses a provider read that had already started when the last viewer left',async()=>{
 let reads=0,release;const controller=new AbortController();
 const work=async()=>{reads++;await new Promise(resolve=>release=resolve);return 'already loading';};
 const first=coalesceInboxRead('returning-awning',work,controller.signal);
 await Promise.resolve();controller.abort();await assert.rejects(first,{name:'AbortError'});
 const returning=coalesceInboxRead('returning-awning',work);assert.equal(reads,1);
 release();assert.equal(await returning,'already loading');assert.equal(reads,1);
});
test('a superseded queued read is skipped before it can reach the Gmail callback',async()=>{
 let release,staleReads=0;const departed=new AbortController();
 const current=withReadGate('one-slot',()=>new Promise(resolve=>release=resolve),1);
 const stale=coalesceInboxRead('stale-awning',signal=>withReadGate('one-slot',async()=>{staleReads++;return 'stale'},1,signal),departed.signal);
 await Promise.resolve();departed.abort();await assert.rejects(stale,{name:'AbortError'});
 release('current');await current;await Promise.resolve();assert.equal(staleReads,0);
 assert.equal(await withReadGate('one-slot',async()=>'next',1),'next');
});

test('cancelling a just-awakened waiter passes the free slot to the next queued reader',async()=>{
 let release;const controller=new AbortController();
 const current=withReadGate('handoff',()=>new Promise(resolve=>release=resolve),1);
 const departed=withReadGate('handoff',async()=>{throw Error('stale callback ran')},1,controller.signal);
 const next=withReadGate('handoff',async()=>'next reader',1);
 release('done');await Promise.resolve();controller.abort();
 await current;await assert.rejects(departed,{name:'AbortError'});assert.equal(await next,'next reader');
});
test("separate mailboxes don't wait on each other, and a failure frees its slot", async () => {
  let peak = 0, running = 0;
  const run = key => withReadGate(key, async () => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; });
  await Promise.all([run("a"), run("a"), run("b"), run("b")]);
  assert.equal(peak, 4);
  await assert.rejects(withReadGate("c", async () => { throw new Error("quota"); }), /quota/);
  assert.equal(await withReadGate("c", async () => "next", 1), "next");
});
