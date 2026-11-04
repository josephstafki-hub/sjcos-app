import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {seedModules,templates} from '../lib/consult/forms/seed.ts';
import {pinnedDerivations} from '../lib/consult/derive.ts';
const instances=[{id:'r1',module_key:'room'},{id:'r2',module_key:'room'},{id:'b',module_key:'bath_scope'},{id:'k',module_key:'kitchen_scope'},{id:'w',module_key:'kitchen_wall'}];
const answers=v=>Object.entries(v).flatMap(([instance_id,fields])=>Object.entries(fields).map(([field_key,value])=>({id:randomUUID(),instance_id,field_key,value,status:'answered',server_revision:'1'})));
test('legacy pins preserve room quantities for each job',()=>{
 const modules=seedModules.map(m=>m.key==='room'?{...m,fields:m.fields.filter(f=>f.key!=='part_of')}:m);
 const ts=templates.filter(t=>['bath','kitchen'].includes(t.key)).map(t=>({...t,derived:[{key:'area',formula:'room.floor_area'}]}));
 const p=pinnedDerivations(modules,ts,instances,answers({r1:{length:120,width:120,shape:'Rectangle'},r2:{length:60,width:96,shape:'Rectangle'}}));
 assert.deepEqual(p.derived.map(d=>d.result.value),[140,140]);
});
test('bath ceiling uses maximum room height, never their sum',()=>{
 const p=pinnedDerivations(seedModules,templates.filter(t=>t.key==='bath'),instances,answers({r1:{ceiling_height:96},r2:{ceiling_height:108},b:{tub_shower_plan:'Keep tub',existing_length:60,existing_width:30,wall_tile_height:'To ceiling'}}));
 assert.equal(p.field(instances[2],'wall_tile_area').value,90);
});
for(const [choice,pair,expected] of [['Full wall at range',[36,60],48],['To the uppers',[30,18],36.75],['4″',null,7.3333]])test('backsplash '+choice,()=>{
 const p=pinnedDerivations(seedModules,templates.filter(t=>t.key==='kitchen'),instances,answers({k:{backsplash_height:choice,backsplash_measured_height:18,...(pair?{range_wall_tile:pair}:{})},w:{base_run:264}}));
 assert.equal(p.derived.find(d=>d.definition.key==='backsplash_area').result.value,expected);
});
test('legacy pins can still close; server refuses skips as membership completion',async()=>{
 const {withTestDb}=await import('./_harness/testdb.mjs');
 const {fixture}=await import('./_harness/consult.mjs');
 const {readFileSync}=await import('node:fs');
 assert.match(readFileSync('lib/consult/protocol.ts','utf8'),/skip:a\?\.status==='skipped'&&!\(m.key==='room'&&f.key==='part_of'&&templates.length>1\)/);
 await withTestDb(async(_url,c)=>{
 const f=await fixture(c);await f.send([f.op()]);await f.save();assert.equal((await f.close()).complete,true);
 },{fresh:true});
});
test('direct SQL enforces door component ranges without mutation',async()=>{
 const {withTestDb}=await import('./_harness/testdb.mjs');const {fixture}=await import('./_harness/consult.mjs');const {publish}=await import('../lib/consult/protocol.ts');
 await withTestDb(async(_url,c)=>{
 const f=await fixture(c);
 const definition={key:'door',version:1,title:'Door',repeatable:true,say:[],fields:[{key:'size',label:'Size',type:'length_pair',unit:'in',tier:'price_critical',required:true,range:[18,96],component_ranges:[[18,72],[72,96]]}],shots:[],coverage:[]};
 const id=(await c.query("INSERT INTO consult_form_versions(kind,key,version,definition,checksum,author) VALUES('module','door',1,$1,'',$2) RETURNING id",[definition,f.owner])).rows[0].id;
 await publish(c,f.context('publish_form',f.owner,null),{form_id:id,registry_id:f.registry});
 await c.query('INSERT INTO consult_form_pins SELECT $1,id,kind,key,version,checksum FROM consult_form_versions WHERE id=$2',[f.consult,id]);
 const door=randomUUID();await f.send([f.op('create_instance',{},await f.revision(),{instance_id:door,module_key:'door',label:'Door'})]);
 const before=await f.revision();
 for(const value of [[90,20],[17,80],[36,97]]){
 await assert.rejects(c.query('SELECT consult_capture_answer($1,$2,$3,1,$4,$5)',[f.context('capture_answer'),f.consult,f.device,randomUUID(),{instance_id:door,field_key:'size',unit:'in',status:'answered',value,generation:1,base_revision:0}]),/out_of_range/);
 assert.equal(await f.revision(),before);
 }
 assert.equal((await c.query('SELECT count(*)::int n FROM consult_answers WHERE instance_id=$1',[door])).rows[0].n,0);
 },{fresh:true});
});
test('updated bath and range-wall QA fixture still closes Complete',async()=>{
 const {withTestDb}=await import('./_harness/testdb.mjs');
 const {fixture}=await import('./_harness/consult.mjs');
 const {seedQaConsult}=await import('../scripts/qa-seed-consult.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const dir=await mkdtemp('/tmp/consult-r15-');
 try{await withTestDb(async(_url,c)=>{
 const owner=randomUUID(),project=randomUUID();
 await c.query("INSERT INTO users(id,email,password_hash,name,role) VALUES($1,$2,'x','Owner','owner')",[owner,owner+'@test']);
 await c.query("INSERT INTO projects(id,slug,name) VALUES($1,$2,'QA')",[project,project]);
 await c.query("UPDATE app_settings SET value='true' WHERE key='consult_capture'");
 const result=await seedQaConsult(c,project,{uploadRoot:dir,fixtureKey:'r15-regression'});
 assert.ok(result.visits.some(v=>v.result?.complete===true));
 },{fresh:true});}finally{await rm(dir,{recursive:true,force:true});}
});
