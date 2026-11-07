// Expectations first: all writes confined to a private temporary root.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm,mkdir,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import * as installer from '../deploy/browser/phase1-installer.mjs';
const {installationPlan,applyPlan,uninstall,verifyInstallation}=installer;
import * as bootstrap from '../lib/browser/protected-bootstrap.mjs';
const evidence={phase:1,sourceVerified:true,acceptanceVerified:true,accountingVerified:true,databasePort:55432};const accounts={joe:1010,browser:{name:'sjcos-browser',uid:998},controller:{name:'sjcos-browser-controller',uid:997},gate:{name:'sjcos-browser-gate',uid:996},dns:{name:'sjcos-browser-dns',uid:995},runner:{name:'sjcos-browser-runner',uid:994},retention:{name:'sjcos-browser-retention',uid:993},exporter:{name:'sjcos-browser-exporter',uid:992}};
test('default dry-run deterministic no enable/start actions',async()=>{const a=await installationPlan({accounts,evidence});assert.equal(a.dryRun,true);assert.ok(a.files.some(f=>f.path==='/etc/systemd/system/user-1010-sjcosbrowser.slice'));assert.equal(JSON.stringify(a).includes('systemctl'),false);});
test('uid998 wrong account refused',async()=>{await assert.rejects(installationPlan({accounts:{...accounts,browser:{name:'joe',uid:998}},evidence}),/ACCOUNT/);});
test('missing exact-candidate evidence refused',async()=>{await assert.rejects(installationPlan({accounts,evidence:{}}),/EVIDENCE/);});
test('shared controller/browser credential uid refused',async()=>{await assert.rejects(installationPlan({accounts:{...accounts,controller:{...accounts.controller,uid:998}},evidence}),/ACCOUNT/);});
test('dry-run writes nothing',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'b-a2b-'));try{const p=await installationPlan({accounts,evidence});await applyPlan(p,{root});await assert.rejects(readFile(path.join(root,'var/lib/sjcos-browser-supervisor/install-journal.json')),{code:'ENOENT'});}finally{await rm(root,{recursive:true,force:true});}});
test('journal roundtrip restores previous bytes and removes added files',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'b-a2b-'));try{const file=path.join(root,'etc/systemd/system/sjcos-browser.service');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'original');const p=await installationPlan({accounts,evidence});await applyPlan(p,{root,apply:true,fixture:true});assert.equal(await verifyInstallation({root}),true);await uninstall({root,apply:true,fixture:true});assert.equal(await readFile(file,'utf8'),'original');await assert.rejects(readFile(path.join(root,'etc/systemd/system/sjcos-browser-gate.service')),{code:'ENOENT'});}finally{await rm(root,{recursive:true,force:true});}});
test('uninstall refuses administrator edits',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'b-a2b-'));try{await applyPlan(await installationPlan({accounts,evidence}),{root,apply:true,fixture:true});await writeFile(path.join(root,'etc/systemd/system/sjcos-browser.service'),'changed');await assert.rejects(uninstall({root,apply:true,fixture:true}),/DRIFT/);}finally{await rm(root,{recursive:true,force:true});}});
test('real-root apply requires verified external installation bundle',async()=>{await assert.rejects(applyPlan(await installationPlan({accounts,evidence}),{root:'/',apply:true}),/BUNDLE/);});

// R1: artifact contract is executable offline, including public-only metadata,
// private secret bytes, fixed loader path, unit bytes and the broker Node pin.
const publicConfig={v:1,phase:1,adapter:'/opt/sjcos-browser/node/source/deploy/browser/production-adapter.mjs',adapterSha256:'a'.repeat(64),bridgeSha256:'b'.repeat(64)};
test('installer emits the exact bootstrap path and safely readable metadata, retaining private configs',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'b-r1-'));try{
  const plan=await installationPlan({accounts,evidence});assert.ok(plan.requiredBundle.includes('phase1.json'));assert.ok(!plan.requiredBundle.includes('production.json'));
  assert.equal(bootstrap.PRODUCTION_BOOTSTRAP,'/etc/sjcos-browser/phase1.json');
  for(const [name,content,mode] of [['phase1.json',JSON.stringify(publicConfig),0o644],['credentials/browser-database','SECRET',0o600],['root-broker.json','{}',0o600],['exporter.json','{}',0o600]]){
   const a=installer.bundleArtifact(name,Buffer.from(content));assert.equal(a.mode,mode);plan.files.push({...a,content:a.data});
  }
  await applyPlan(plan,{root,apply:true,fixture:true});
  const file=path.join(root,bootstrap.PRODUCTION_BOOTSTRAP);assert.equal((await stat(file)).mode&0o777,0o644);
  assert.deepEqual(bootstrap.validateProductionBootstrapConfig(JSON.parse(await readFile(file,'utf8'))),publicConfig);
  assert.equal((await stat(path.join(root,'etc/sjcos-browser/credentials/browser-database'))).mode&0o777,0o600);
  await uninstall({root,apply:true,fixture:true});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('bootstrap metadata refuses secret-bearing or unknown config fields',()=>{
 for(const patch of [{database:'SECRET'},{credentials:{}},{adapter:'/tmp/evil.mjs'},{bridgeSha256:'bad'},{phase:0}])assert.throws(()=>bootstrap.validateProductionBootstrapConfig({...publicConfig,...patch}),/BOOTSTRAP_REFUSED/);
});
test('all planned Node unit entrypoints agree with broker fixed Node executable',async()=>{
 const plan=await installationPlan({accounts,evidence}),broker=await readFile('deploy/browser/root-broker.py','utf8');assert.match(broker,/NODE='\/usr\/bin\/node'/);
 for(const f of plan.files.filter(f=>f.path.endsWith('.service'))){for(const line of f.content.split('\n').filter(l=>/^ExecStart=[^ ]*\/node(?: |$)/.test(l)))assert.match(line,/^ExecStart=\/usr\/bin\/node /);}
 const units=JSON.parse(await readFile('deploy/browser/phase1-unit-files.json','utf8'));
 for(const [name,content] of Object.entries(units))if(name.endsWith('.service'))assert.equal(content,await readFile('deploy/'+name,'utf8'),name);
});
