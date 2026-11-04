import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const queries = [];
globalThis.__contextRun = async (sql, params) => {
  queries.push([sql, params]);
  if (/FROM projects p/.test(sql))
    return [
      {
        slug: "kitchen",
        name: "Kitchen",
        stage: "construction",
        latest_note: "INV-003 sent for $4,359.56, awaiting payment.",
        total_cents: "10000000",
        collected_cents: "2500000",
        lead_slug: "tom",
        person_name: "Tom",
        email: "tom@example.test",
        phone: "6125551234",
      },
    ];
  if (/FROM leads/.test(sql))
    return [
      {
        slug: "tom",
        name: "Tom",
        email: "tom@example.test",
        phone: "6125551234",
        stage: "rough_estimate",
        role: "lead",
      },
    ];
  if (/FROM schedule_blocks/.test(sql))
    return [{ label: "Tile install", day: "2026-11-02", time: "08:00" }];
  if (/FROM work_items/.test(sql))
    return [{ id: "w1", title: "Confirm tile", due_at: "2026-11-02" }];
  return [];
};
registerHooks({
  resolve(s, c, n) {
    if(s === "./inbox-rules") return n("./inbox-rules.ts",c);
    if (s === "./db") return { url: "stub:db", shortCircuit: true };
    return n(s, c);
  },
  load(u, c, n) {
    return u === "stub:db"
      ? {
          format: "module",
          source:
            "export const query=async(s,p)=>({rows:await globalThis.__contextRun(s,p)});",
          shortCircuit: true,
        }
      : n(u, c);
  },
});
const { loadInboxContext } = await import("../lib/inbox-context.ts");
test("context reads ledger cents, contact, stage, next schedule and open work without Gmail or money writes", async () => {
  const c = await loadInboxContext({
    threadId: "t1",
    email: "tom@example.test",
    projectSlug: "kitchen",
  });
  assert.equal(c.person.name, "Tom");
  assert.equal(c.person.role, "client");
  assert.deepEqual(c.job.money, {
    total: 10000000,
    paid: 2500000,
    outstanding: 7500000,
  });
  assert.equal(c.job.stage, "Construction");
  assert.equal(c.job.latestNote,"INV-003 sent for $4,359.56, awaiting payment.");
  assert.ok(!queries.some(([sql])=>/COALESCE\(p.stage_label/.test(sql)));
  assert.equal(c.schedule.label, "Tile install");
  assert.equal(c.todos[0].title, "Confirm tile");
  assert.ok(queries.every(([sql]) => !/INSERT|UPDATE|DELETE|gmail/i.test(sql)));
  assert.match(
    queries.find(([sql]) => /FROM work_items/.test(sql))[0],
    /NOT IN \('done', 'cancelled'\)/,
  );
});
test("unknown sender returns explicit unknown context, never fabricated zeros", async () => {
  const old = globalThis.__contextRun;
  globalThis.__contextRun = async () => [];
  const c = await loadInboxContext({
    threadId: "t1",
    email: "new@example.test",
  });
  assert.equal(c.person, null);
  assert.equal(c.job, null);
  assert.equal(c.schedule, null);
  assert.deepEqual(c.todos, []);
  globalThis.__contextRun = old;
});

test('unseen context sources a dated real note and last settled payment without substituting a stage label',async()=>{
 const old=globalThis.__contextRun;
 globalThis.__contextRun=async(sql,params)=>{
  queries.push([sql,params]);
  if(/FROM projects p/.test(sql))return [{slug:'terrace',name:'Chen · Terrace',stage:'construction',latest_note:'Railing posts checked on site',latest_note_at:'2026-10-21',last_paid_at:'2026-10-20T18:00:00Z',total_cents:'200000',collected_cents:'50000',person_name:'Avery Chen',email:'avery@example.test'}];
  return [];
 };
 try{
  const c=await loadInboxContext({threadId:'gate-mail',projectSlug:'terrace'});
  assert.equal(c.job.latestNote,'Railing posts checked on site');assert.equal(c.job.latestNoteAt,'2026-10-21');assert.equal(c.job.latestNoteSource,'Daily log');assert.equal(c.job.money.lastPaidAt,'2026-10-20T18:00:00Z');
  const sql=queries.findLast(([sql])=>/FROM projects p/.test(sql))?.[0]??'';
  assert.match(sql,/invoice_payments/);assert.match(sql,/daily_logs/);assert.doesNotMatch(sql,/stage_label AS latest_note/);
 }finally{globalThis.__contextRun=old;}
});
