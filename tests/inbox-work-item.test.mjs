import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(
  new URL("../lib/actions/engine.ts", import.meta.url),
  "utf8",
);
// Evaluate only the real create function with injected dependencies; no DB/provider imports can escape.
const create = source.slice(
  source.indexOf("export async function createWorkItem("),
  source.indexOf("/** Edit existing details;"),
);
globalThis.__work = { role: "owner", calls: [], people: [], existingId: null };
const code = `const w=globalThis.__work;const requireAccess=async()=>({role:w.role});const pickedPeople=async ids=>(w.people=ids,ids);const assignNewItem=async(...a)=>w.calls.push(['assign',...a]);const revalidatePath=()=>{};const runDirect=async(sql,p)=>(w.calls.push([sql,p]),[{id:'job-id'}]);const queryOne=async(sql,p)=>(w.calls.push([sql,p]),{id:'work-id'});const prepareEmailWorkItem=async(r,p)=>(w.calls.push(['email',p]),{existingId:w.existingId,obligationId:'ob-id'});${create}`;
registerHooks({
  resolve(s, c, n) {
    return s === "test:create" ? { url: s, shortCircuit: true } : n(s, c);
  },
  load(u, c, n) {
    return u === "test:create"
      ? {
          format: "module",
          source: ts.transpileModule(code, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
            },
          }).outputText,
          shortCircuit: true,
        }
      : n(u, c);
  },
});
const { createWorkItem } = await import("test:create");
function form() {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    title: "Send plans",
    job: "project:kitchen",
    due_at: "2026-11-02",
    email: JSON.stringify({
      message_id: "m1",
      thread_id: "t1",
      from: "tom@example.test",
    }),
    assigned_user_ids: "staff-id",
  }))
    f.set(k, v);
  return f;
}
test("existing Engine create persists linked job/email obligation, due date and owner-selected people", async () => {
  const w = globalThis.__work;
  w.calls = [];
  assert.equal((await createWorkItem(form())).ok, true);
  const email = w.calls.find((c) => c[0] === "email");
  assert.equal(email[1].email.messageId, "m1");
  assert.equal(email[1].email.threadId, "t1");
  assert.equal(email[1].projectId, "job-id");
  const insert = w.calls.find((c) => /INSERT INTO work_items/.test(c[0]));
  assert.match(insert[0], /obligation_id/);
  assert.ok(insert[1].includes("ob-id"));
  assert.ok(insert[1].includes("2026-11-02"));
  assert.deepEqual(w.people, ["staff-id"]);
});
test("staff cannot assign others; duplicate email does not create or reassign", async () => {
  const w = globalThis.__work;
  w.role = "staff";
  w.calls = [];
  await createWorkItem(form());
  assert.deepEqual(w.calls.find((c) => c[0] === "assign")[3], []);
  w.existingId = "already";
  w.calls = [];
  await createWorkItem(form());
  assert.ok(!w.calls.some((c) => /INSERT INTO work_items/.test(c[0])));
  assert.ok(!w.calls.some((c) => c[0] === "assign"));
  w.role = "owner";
  w.existingId = null;
});
test("invalid source and invalid due date return before any write", async () => {
  const w = globalThis.__work;
  for (const [key, value] of [
    ["email", "{}"],
    ["due_at", "2026-02-30"],
  ]) {
    const f = form();
    f.set(key, value);
    w.calls = [];
    assert.equal((await createWorkItem(f)).ok, false);
    assert.ok(!w.calls.some((c) => /INSERT/.test(c[0]) || c[0] === "email"));
  }
});
test("a repeat reminder schedules the existing email to-do without creating or reassigning it", async () => {
  const w = globalThis.__work;
  w.existingId = "already";
  w.calls = [];
  const f = form();
  f.set("reminder", "true");
  await createWorkItem(f);
  const update = w.calls.find((c) => /UPDATE work_items SET due_at/.test(c[0]));
  assert.deepEqual(update[1], ["already", "2026-11-02"]);
  assert.ok(
    !w.calls.some(
      (c) => /INSERT INTO work_items/.test(c[0]) || c[0] === "assign",
    ),
  );
  w.existingId = null;
});
