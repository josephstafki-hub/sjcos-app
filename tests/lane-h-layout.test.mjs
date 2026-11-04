import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const files = [
 'components/engine/EngineClient.tsx','components/engine/CapabilitiesTable.tsx',
 'components/panel/WorkbenchPanel.tsx','components/settings/SettingsForm.tsx',
 'components/settings/SettingsClient.tsx','components/settings/SettingsSection.tsx',
 'components/settings/TeamAccess.tsx','components/settings/PricingSetup.tsx',
 'components/unsorted/UnsortedClient.tsx','components/cost-book/PlanRulesPanel.tsx',
 'components/projects/ProjectsClient.tsx','components/leads/LeadsClient.tsx',
 'app/(os)/engine/page.tsx','app/(os)/engine/houzz-exit/page.tsx',
 'app/(os)/settings/team/[userId]/page.tsx','app/(os)/settings/page.tsx',
 'app/(os)/cost-book/page.tsx','app/(os)/projects/page.tsx',
];
test('lane H edited components have valid TSX syntax (no type-check or build)',()=>{
 for(const file of files){
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],file);
 }
});
test('capability summary shows one furthest state while preserving independent indicator facts',()=>{
 const source=ts.transpileModule(readFileSync('components/engine/CapabilitiesTable.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};
 runInNewContext(source+'\nexports.StateSummary=StateSummary;', {exports,require(name){
  if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='@/components/ui')return {Chip:'chip'};
  if(name==='@/lib/measure/capabilities')return {CAPABILITY_STATES:['implemented','deployed','enabled','proven']};
  return {};
 }});
 const row={implemented:true,deployed:false,enabled:true,proven:false};
 const tree=exports.StateSummary({row});
 assert.equal(tree.props.children[0].type,'chip');
 assert.equal(tree.props.children[0].props.children,'Enabled');
 const indicators=tree.props.children[1].props.children;
 assert.equal(indicators.length,4);
 assert.match(indicators[1].props.title,/not recorded/);
 assert.match(indicators[2].props.title,/recorded/);
 assert.equal(exports.StateSummary({row:{...row,proven:true}}).props.children[0].props.children,'Proven');
 assert.equal(exports.StateSummary({row:{}}).props.children[0].props.children,'Not implemented');
});
