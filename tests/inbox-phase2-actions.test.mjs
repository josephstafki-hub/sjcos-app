import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const calls = [];
globalThis.__i2 = { calls, allowed: true };
const stubs = {
  "@/lib/dal": `export const requireAccess=async()=>{if(!globalThis.__i2.allowed)throw Error('Forbidden');return {id:'u',role:'owner'};};`,
  "@/lib/db": `export const query=async(s,p)=>(globalThis.__i2.calls.push([s,p]),{rows:[]});`,
  "@/lib/ai": `export const ai={name:'Test model',summarize:async()=>{globalThis.__i2.calls.push(['ai']);return {summary:'Tom needs plans',bullets:['one','two','three','four','five']};}};`,
  "next/cache": "export const revalidatePath=()=>{};",
  "@/lib/inbox-context":
    "export const loadInboxContext=async()=>({person:null,job:null,todos:[],schedule:null});",
};
registerHooks({
  resolve(s, c, n) {
    if (s in stubs) return { url: "stub:" + s, shortCircuit: true };
    return n(s, c);
  },
  load(u, c, n) {
    return u.startsWith("stub:")
      ? { format: "module", source: stubs[u.slice(5)], shortCircuit: true }
      : n(u, c);
  },
});
const a = await import("../lib/actions/inbox-experience.ts");
test("summary is explicit, bounded to four bullets and labelled with actual provider/time", async () => {
  assert.equal(calls.length, 0);
  const r = await a.summarizeInboxAction([
    { fromName: "Tom", body: ["Plans?"] },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.summary.bullets.length, 4);
  assert.equal(r.summary.model, "Test model");
  assert.ok(r.summary.at);
});
test("channel done stores the message cutoff, rejects email/invalid versions and requires inbox access", async () => {
  calls.length = 0;
  assert.equal((await a.markChannelDoneAction("sms:7", 1000)).ok, true);
  assert.match(calls[0][0], /INSERT INTO threads/);
  assert.ok(calls[0][1].includes("sms:7"));
  calls.length = 0;
  assert.equal((await a.markChannelDoneAction("gmail-thread", 1000)).ok, false);
  assert.equal((await a.markChannelDoneAction("sms:7", NaN)).ok, false);
  assert.equal(calls.length, 0);
  globalThis.__i2.allowed = false;
  await assert.rejects(
    () => a.markChannelDoneAction("sms:7", 1000),
    /Forbidden/,
  );
  globalThis.__i2.allowed = true;
});
