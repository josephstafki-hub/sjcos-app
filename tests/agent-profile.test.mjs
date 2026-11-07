import {startCluster} from './_harness/testdb.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_DISALLOWED_TOOLS,
  BUSINESS_DOCS_DIR,
  assertBusinessArgs,
  argsGrantRepoAccess,
  parseThreshold,
  permissionModeFor,
  profileArgs,
  profileFor,
  profilePromptLine,
  runAdmission,
} from "../lib/authority/run-profile.mjs";
import { WORKERS, assertWorkerMay, workerMayUseLane, workerPrincipal, WorkerScopeError } from "../lib/authority/worker-identity.ts";
import { AUTHORITY_ACTIONS, DELEGABLE_ACTIONS, authorityForGatedAction, isAuthorityActionType } from "../lib/authority/catalog.ts";

// A08a / A08b pure checks (V12, V27): what a business-profile run is spawned
// with, who may start what, and the finite limits — none of it prompt text.

const REPO = "/srv/sjcos-app";

test("profileFor: staff and unattended runs are business; only an active owner gets operator", () => {
  assert.equal(profileFor({ role: "staff", active: true }, "operator"), "business", "staff asking for operator still gets business");
  assert.equal(profileFor({ role: "staff", active: true }, undefined), "business");
  assert.equal(profileFor(null, "operator"), "business", "nobody behind the run → business");
  assert.equal(profileFor({ role: "owner", active: false }, undefined), "business", "disabled owner row → business");
  assert.equal(profileFor({ role: "owner", active: true }, undefined), "operator");
  assert.equal(profileFor({ role: "owner", active: true }, "business"), "business", "owner may opt into a business run");
  assert.equal(profileFor({ role: "client", active: true }, "operator"), "business");
});

test("business profile args: --restricted, disallowed tools, server-side readers, no --add-dir, scratch cwd, finite limits", () => {
  const p = profileArgs("business", { repo: REPO, scratchDir: "/tmp/sjcos-agent-x", maxBudgetUsd: 2.5 });
  assert.ok(p.args.includes("--restricted"));
  const i = p.args.indexOf("--disallowedTools");
  assert.ok(i >= 0);
  const disallowed = p.args[i + 1].split(" ");
  for (const t of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch"]) assert.ok(disallowed.includes(t), `${t} disallowed`);
  assert.deepEqual(disallowed, [...BUSINESS_DISALLOWED_TOOLS]);
  assert.equal(argsGrantRepoAccess(p.args, REPO), false, "no repo-wide --add-dir");
  assert.equal(p.args.includes("--add-dir"),false);
  assert.equal(p.args[p.args.indexOf("--tools")+1],"ToolSearch");
  for(const t of ["Read","Glob","Grep","NotebookRead"])assert.ok(disallowed.includes(t));
  assert.equal(p.cwd, "/tmp/sjcos-agent-x");
  assert.equal(p.maxTurns, 60);
  assert.equal(p.timeoutMs, 20 * 60 * 1000);
  assert.deepEqual(p.args.slice(p.args.indexOf("--max-budget-usd"), p.args.indexOf("--max-budget-usd") + 2), ["--max-budget-usd", "2.5"]);
  assert.doesNotThrow(() => assertBusinessArgs(p.args, REPO));
});

test("operator profile keeps the repo and no caps; business self-check refuses a repo --add-dir", () => {
  const o = profileArgs("operator", { repo: REPO });
  assert.deepEqual(o.args, ["--add-dir", REPO]);
  assert.equal(o.cwd, REPO);
  assert.equal(o.maxTurns, null);
  assert.equal(o.timeoutMs, null);
  assert.throws(() => assertBusinessArgs([...profileArgs("business", { repo: REPO, scratchDir: "/tmp/x" }).args, "--add-dir", REPO], REPO), /repo --add-dir/);
  assert.throws(() => assertBusinessArgs(["--disallowedTools", "Bash Write Edit"], REPO), /--restricted/);
  assert.throws(() => assertBusinessArgs(["--restricted", "--disallowedTools", "Bash Write"], REPO), /Read not disallowed/);
});

test("business runs cannot run bypassPermissions / auto / dontAsk; owner modes pass through", () => {
  assert.equal(permissionModeFor("business", "bypassPermissions"), "acceptEdits");
  assert.equal(permissionModeFor("business", "auto"), "acceptEdits");
  assert.equal(permissionModeFor("business", "plan"), "plan");
  assert.equal(permissionModeFor("operator", "bypassPermissions"), "bypassPermissions");
});

test("usage thresholds: business run refused past the hourly cap, owner run only warned, unset = open", () => {
  assert.equal(parseThreshold(""), null);
  assert.equal(parseThreshold("0"), null);
  assert.equal(parseThreshold("abc"), null);
  assert.equal(parseThreshold(" 12 "), 12);
  assert.deepEqual(runAdmission({ profile: "business", runsLastHour: 5, maxRunsPerHour: null }), { ok: true, warning: null });
  const refused = runAdmission({ profile: "business", runsLastHour: 12, maxRunsPerHour: 12 });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /cap reached/);
  const warned = runAdmission({ profile: "operator", runsLastHour: 12, maxRunsPerHour: 12 });
  assert.equal(warned.ok, true);
  assert.match(warned.warning, /cap reached/);
  assert.equal(runAdmission({ profile: "business", runsLastHour: 11, maxRunsPerHour: 12 }).ok, true);
});

test("profile prompt line states the profile (informational only)", () => {
  assert.match(profilePromptLine("business"), /NO shell, NO file editing/);
  assert.match(profilePromptLine("operator"), /operator/);
});

test("worker identities: least privilege per worker, unknown worker refused", () => {
  assert.ok(assertWorkerMay("dispatch", "send_email"));
  assert.throws(() => assertWorkerMay("monitor", "send_email"), WorkerScopeError);
  assert.throws(() => assertWorkerMay("business-agent-worker", "send_invoice"), WorkerScopeError, "the agent worker cannot dispatch sends itself");
  assert.throws(() => assertWorkerMay("nobody", "send_email"), WorkerScopeError);
  assert.equal(workerMayUseLane("backup", "backup"), true);
  assert.equal(workerMayUseLane("backup", "sends"), false);
  assert.deepEqual(workerPrincipal("dispatch"), { kind: "service", name: "worker:dispatch" });
  for (const w of Object.values(WORKERS)) assert.ok(["sjcos_worker", "sjcos_agent", "sjcos_readonly", "sjcos_backup"].includes(w.dbRole));
});

test("authority catalog: DECISIONS.md kinds present, 'grant' never delegable, gated actions map to kinds", () => {
  for (const k of ["package_release", "proposal", "purchase", "payment", "refund", "publication", "schedule", "funding", "markup", "change_order", "design_package", "grant"]) {
    assert.ok(isAuthorityActionType(k), k);
  }
  assert.equal(AUTHORITY_ACTIONS.find((a) => a.key === "grant").ownerOnly, true);
  assert.ok(!DELEGABLE_ACTIONS.some((a) => a.key === "grant"));
  assert.equal(isAuthorityActionType("*"), false);
  assert.equal(authorityForGatedAction("send_bid_package"), "package_release");
  assert.equal(authorityForGatedAction("send_invoice"), "proposal");
  assert.equal(authorityForGatedAction("send_email"), null, "one-off email is not delegable through an agent");
  assert.equal(authorityForGatedAction("made_up"), null);
});

test('unattended runtime stamps background identity after extraEnv, never person/panel tags', async () => {
  const {businessMcpConfig}=await import('../lib/agent-runtime/claude-runner.mjs');
  const env=businessMcpConfig({repo:REPO,databaseUrl:'test',extraEnv:{SJC_RUN_PROFILE:'operator',SJC_LAUNCH_SOURCE:'panel_web',SJC_PRINCIPAL_USER_ID:'owner',SJC_CONVERSATION_ID:'private'}}).mcpServers.sjcos.env;
  assert.equal(env.SJC_RUN_PROFILE,'business'); assert.equal(env.SJC_LAUNCH_SOURCE,'background');
  assert.equal(env.SJC_PRINCIPAL_USER_ID,''); assert.equal(env.SJC_CONVERSATION_ID,'');
});

test('0105 never promotes unattended or Telegram identity through a requested profile', async()=>{
 const {browserEligible}=await import('../lib/authority/run-profile.mjs');
 for(const source of ['background','telegram','legacy','panel_mobile','panel_voice'])assert.equal(browserEligible({user:{role:'owner',active:true},launchSource:source,withMcp:true}),false);
 assert.equal(browserEligible({user:{role:'owner',active:true},launchSource:'panel_web',withMcp:false}),false);
 assert.equal(profileFor({role:'staff',active:true},'operator'),'business');
});

test('tracked business rejects every native reader, hooks and extra filesystem roots before spawn',async()=>{
 const {assertTrackedBusinessArgs}=await import('../lib/authority/run-profile.mjs');
 const args=[...profileArgs('business',{repo:REPO,scratchDir:'/tmp/scratch'}).args,'--strict-mcp-config'];
 assert.doesNotThrow(()=>assertTrackedBusinessArgs(args,REPO));
 for(const name of ['Read','Glob','Grep','NotebookRead','Bash','Write','Edit']){
  const unsafe=args.map(v=>v===BUSINESS_DISALLOWED_TOOLS.join(' ')?v.split(' ').filter(t=>t!==name).join(' '):v);
  assert.throws(()=>assertTrackedBusinessArgs(unsafe,REPO),new RegExp(name+' not disallowed'));
 }
 for(const flag of ['--strict-mcp-config','--disable-slash-commands','--safe-mode'])assert.throws(()=>assertTrackedBusinessArgs(args.filter(v=>v!==flag),REPO));
 assert.throws(()=>assertTrackedBusinessArgs([...args,'--add-dir','/tmp/docs'],REPO));
 assert.throws(()=>assertTrackedBusinessArgs([...args,'--plugin-dir','/tmp/evil'],REPO));
});

test('real unattended runner constructs a reader-free argv for a fake CLI, including web exception',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const {runClaudeBusiness}=await import('../lib/agent-runtime/claude-runner.mjs');
 const dir=await mkdtemp(path.join(tmpdir(),'c1prov-cli-'));
 try{
  const fake=path.join(dir,'fake-cli');
  await writeFile(fake,'#!/usr/bin/env node\nconsole.log(JSON.stringify({type:"result",result:JSON.stringify(process.argv.slice(2)),session_id:"fake",total_cost_usd:0}));\n',{mode:0o700});
  for(const webResearch of [false,true]){
   const r=await runClaudeBusiness({prompt:'instruction',repo:process.cwd(),databaseUrl:'postgresql://invalid/unused',claudeBin:fake,webResearch,timeoutMs:5000});
   const args=JSON.parse(r.resultText);
   assert.ok(!args.includes('--add-dir'));assert.equal(args[args.indexOf('--tools')+1],webResearch?'ToolSearch WebSearch WebFetch':'ToolSearch');
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('every actual sjcos registration is classified, including canvas and server readers',async()=>{
 // Building a server registers schemas only. Dead URL prevents any live DB access.
 process.env.DATABASE_URL_AGENT=startCluster().url;process.env.SJC_DB_LOGIN='agent';
 const {buildServer}=await import('../mcp/sjcos-mcp.mjs');
 const {CLASSIFICATION_REGISTRY,assertEveryToolClassified}=await import('../lib/canvas-classification.mjs');
 const server=buildServer({transportKind:'http'}),names=Object.keys(server._registeredTools);
 assertEveryToolClassified(names,CLASSIFICATION_REGISTRY);
 assert.ok(names.includes('read_chat_attachment'));assert.ok(names.includes('show_canvas'));
 console.log(`classification registered=${names.length} classified=${names.filter(n=>Object.hasOwn(CLASSIFICATION_REGISTRY.tools,n)).length} registry=${Object.keys(CLASSIFICATION_REGISTRY.tools).length}`);
 await server.close();
});

// Phase 3 does not create an editing/sending authority from a Canvas renderer.
test("floor preview permission requires projects and leads independently",async()=>{
 const {assertFloorAccess}=await import('../lib/canvas-floor.ts');
 const staff=permissions=>({id:'staff',role:'staff',permissions,active:true});
 assert.throws(()=>assertFloorAccess(staff(['ai']),{project_id:'job'}),/CANVAS_UNAVAILABLE/);
 assert.throws(()=>assertFloorAccess(staff(['ai','projects']),{lead_slug:'lead'}),/CANVAS_UNAVAILABLE/);
 assert.doesNotThrow(()=>assertFloorAccess(staff(['ai','projects','leads']),{lead_slug:'lead'}));
 assert.throws(()=>assertFloorAccess({...staff(['projects']),active:false},{project_id:'job'}),/CANVAS_UNAVAILABLE/);
});
