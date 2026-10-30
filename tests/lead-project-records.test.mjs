import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const root = new URL("../", import.meta.url);
let writes = [];
registerHooks({
  resolve(s, c, n) {
    if (
      s === "@/lib/db" ||
      (s === "./db" && c.parentURL?.endsWith("/lib/projects.ts"))
    )
      return { url: "stub:db", shortCircuit: true };
    if (s === "@/lib/dal") return { url: "stub:dal", shortCircuit: true };
    if (s === "next/cache") return { url: "stub:cache", shortCircuit: true };
    if (s === "next/navigation") return { url: "stub:nav", shortCircuit: true };
    if (s === "./coi-status" || s === "./sub-docs")
      return { url: "stub:coi", shortCircuit: true };
    if (s === "./file-trash") return { url: "stub:trash", shortCircuit: true };
    if (s === "./ai" || s === "@/lib/ai")
      return { url: "stub:ai", shortCircuit: true };
    if (s === "@/lib/leads") return { url: "stub:leads", shortCircuit: true };
    if (s.startsWith("@/")) return { url: "stub:other", shortCircuit: true };
    return n(s, c);
  },
  load(u, c, n) {
    const stubs = {
      "stub:db":
        "export const query=(...a)=>globalThis.__recordQuery(...a);export const queryOne=async()=>null;export const queryAs=query;",
      "stub:dal": "export const requireAccess=async()=>({});",
      "stub:cache": "export const revalidatePath=()=>{};",
      "stub:nav": "export const redirect=()=>{};",
      "stub:coi": 'export const coiStatusSql=()=>"";',
      "stub:trash": "export const listFileTrash=async()=>[];",
      "stub:ai": "export const ai={};",
      "stub:leads":
        'export const STAGES=[];export const ALL_STAGES=[];export const stageLabel=()=>"";export const suggestedProjectName=()=>"";export const formatMoneyish=(x)=>x;',
      "stub:other":
        'export const logLeadActivity=async()=>{};export const cancelLeadNurture=()=>{};export const openEntityRoom=()=>{};export const closeEntityRoom=()=>{};export const carryRoomMembership=()=>{};export const leadRoomKey=()=>{};export const roomKey=()=>{};export const scoreLead=()=>{};export const emit=()=>{};export const INTAKE_QUESTIONS=[];export const AI_NAME="AI";export const sendNewEmailAction=()=>{};export const renderRoughEstimatePdf=()=>{};export const clientSendVerdict=()=>{};export const runDirect=()=>{};export const userPrincipal=()=>{};',
    };
    if (stubs[u])
      return { format: "module", source: stubs[u], shortCircuit: true };
    return n(u, c);
  },
});
globalThis.__recordQuery = async (sql, p) => {
  writes.push([sql, p]);
  return { rowCount: 1, rows: [] };
};
const { updateLeadContact } = await import("../lib/actions/leads.ts");
test("invalid contact email returns a useful error without writing", async () => {
  writes = [];
  const r = await updateLeadContact("zz-qa", "bad-email", "");
  assert.equal(r.ok, false);
  assert.match(r.error, /email/i);
  assert.equal(writes.length, 0);
});
test("contact edits trim valid emails and permit clearing", async () => {
  writes = [];
  assert.equal(
    (await updateLeadContact("zz-qa", " qa@example.test ", " 555 ")).ok,
    true,
  );
  assert.deepEqual(writes[0][1], ["zz-qa", "qa@example.test", "555"]);
  assert.equal((await updateLeadContact("zz-qa", "", "")).ok, true);
});
const { getProject } = await import("../lib/projects.ts");
test("estimated values never become contracts and empty stage metadata has a fallback", async () => {
  globalThis.__recordQuery = async (sql) => ({
    rows: sql.includes("SELECT slug, name")
      ? [
          {
            slug: "zz-qa",
            name: "ZZ QA",
            status: "precon_signed",
            value: "$50k",
            billed: 0,
            sub: "",
            stage: "",
            total_cents: "0",
            collected_cents: "0",
          },
        ]
      : [],
  });
  const p = await getProject("zz-qa");
  assert.doesNotMatch(p.contractValue, /contract/i);
  assert.match(p.contractValue, /estimated/i);
  assert.equal(p.money.contract, "—");
  assert.match(p.pulse, /pre-con signed/i);
  assert.ok(p.statusChips.every((c) => c.label.trim()));
  assert.doesNotMatch(p.subtitle, /^\s*·/);
});
