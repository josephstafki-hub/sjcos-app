import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserEligible, profileArgs, permissionModeFor, profileFor, BROWSER_SJC_TOOLS } from '../lib/authority/run-profile.mjs';
const human = {role:'owner',active:true,permissions:[]};
test('only attended web owner/staff with ai can be browser eligible', () => {
  for (const user of [human,{role:'staff',active:true,permissions:['ai']}]) assert.equal(browserEligible({user,launchSource:'panel_web',withMcp:true}),true);
});
for (const source of ['telegram','background','legacy','panel_mobile','panel_voice',undefined]) test(`adversarial: ${source} cannot become browser`, () => assert.equal(browserEligible({user:human,launchSource:source,withMcp:true}),false));
for (const user of [null,{...human,active:false},{role:'client',active:true},{role:'sub',active:true},{role:'staff',active:true,permissions:[]}]) test(`adversarial: excluded person ${JSON.stringify(user)}`, () => assert.equal(browserEligible({user,launchSource:'panel_web',withMcp:true}),false));
test('with_mcp=false cannot enable browser; profile request never upgrades staff',()=>{
  assert.equal(browserEligible({user:human,launchSource:'panel_web',withMcp:false}),false);
  assert.equal(profileFor({role:'staff',active:true},'operator'),'business');
});
test('browser has no builtins, repo access or wildcard SJC tools and bounded work',()=>{
  const p=profileArgs('browser',{repo:'/repo',scratchDir:'/tmp/browser',maxBudgetUsd:2});
  assert.equal(p.cwd,'/tmp/browser'); assert.ok(!p.args.includes('--add-dir'));
  assert.equal(p.args[p.args.indexOf('--tools')+1],'');
  assert.ok(p.args.includes('--strict-mcp-config'));
  const allowed=p.args[p.args.indexOf('--allowedTools')+1].split(' ');
  assert.ok(!allowed.includes('mcp__sjcos'));
  assert.deepEqual(BROWSER_SJC_TOOLS,['get_operating_context','get_project','get_lead','get_work_item']);
  assert.equal(p.maxTurns,60); assert.equal(p.timeoutMs,1200000);
  for (const mode of ['auto','bypassPermissions','dontAsk']) assert.equal(permissionModeFor('browser',mode),'default');
});
