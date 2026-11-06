import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOL_NAMES,TOOL_SCHEMAS,ERROR_CODES,validateInput,validateOutput,TaskV1,BrowserTaskV1,PermitBrowserHandoffV1,validateObservation,errorEnvelope} from '../lib/browser/contracts.mjs';
import {RUNTIME_PINS,DEFAULT_FLAGS,verifyInstalledMetadata} from '../lib/browser/runtime-pins.mjs';
import {id,task,publicObservation,privateObservation,permitHandoff,inputs,outputs} from './fixtures/browser-contract-v1.mjs';
for(const name of Object.keys(inputs)) test(`${name}: exact input and success fixture`,()=>{
  assert.deepEqual(validateInput(name,inputs[name]),inputs[name]);
  assert.deepEqual(validateOutput(name,outputs[name]),outputs[name]);
  assert.ok(TOOL_SCHEMAS[name].inputSchema);
  for(const key of ['user_id','run_id','principal','password','selector','approved','owner_grant_id','allowed_sites','capability']) assert.throws(()=>validateInput(name,{...inputs[name],[key]:'forged'}));
  assert.throws(()=>validateOutput(name,{...outputs[name],secret:'leak'}));
  assert.throws(()=>validateInput(name,{...inputs[name],task_id:'not-uuid'}));
});
test('exact 13 tools, unknown tools forbidden',()=>{
  assert.equal(TOOL_NAMES.length,13);
  for(const name of ['browser_eval','browser_execute','browser_approve','browser_get_password']) assert.throws(()=>validateInput(name,{}));
});
test('all act variants require only their discriminated fields',()=>{
  const base=inputs.browser_act;
  for(const [operation,extra] of [['click',{}],['fill',{value:'fact'}],['select',{value:'option'}],['check',{checked:false}],['scroll',{direction:'up'}],['key',{key:'Tab'}]]) {
    const x={...base,operation,...extra};assert.deepEqual(validateInput('browser_act',x),x);
    assert.throws(()=>validateInput('browser_act',{...x,selector:'#foo'}));
    if(operation!=='click') assert.throws(()=>validateInput('browser_act',{...base,operation}));
  }
  assert.throws(()=>validateInput('browser_act',{...base,value:'bad'}));
  assert.throws(()=>validateInput('browser_act',{...base,operation:'fill',value:'x'.repeat(4001)}));
});
test('private/public observation union and strict nested boundaries',()=>{
  assert.deepEqual(validateOutput('browser_observe',privateObservation),privateObservation);
  for(const x of [{...privateObservation,untrusted_page:publicObservation.untrusted_page},{...privateObservation,controls:[{ref:'r',operation:'fill',field_key:'address'}]},{...publicObservation,controls:[]},{...publicObservation,untrusted_page:{...publicObservation.untrusted_page,screenshot:'data'}},{...publicObservation,untrusted_page:{...publicObservation.untrusted_page,controls:Array(151).fill({ref:'r',role:'button',label:'x'})}}]) assert.throws(()=>validateOutput('browser_observe',x));
  assert.throws(()=>validateObservation(publicObservation,{now:Date.parse(publicObservation.expires_at)-31000}));
  assert.throws(()=>validateObservation(publicObservation,{now:Date.parse(publicObservation.expires_at)+1}));
  assert.throws(()=>validateOutput('browser_observe',{...publicObservation,untrusted_page:{...publicObservation.untrusted_page,text:'é'.repeat(17000)}}));
});
test('private adapter controls require reviewed registry, TTL and epoch',()=>{
  const x={...privateObservation,adapter_id:'permit-v1',controls:[{ref:'address',operation:'fill',field_key:'address'}]};
  assert.throws(()=>validateObservation(x,{now:Date.parse(x.expires_at)-1000,documentEpoch:1}));
  assert.deepEqual(validateObservation(x,{now:Date.parse(x.expires_at)-1000,documentEpoch:1,adapter:{id:'permit-v1',controls:x.controls}}),x);
  assert.throws(()=>validateObservation(x,{now:Date.parse(x.expires_at)-1000,documentEpoch:2,adapter:{id:'permit-v1',controls:x.controls}}));
});
test('task invariants and canonical origins',()=>{
  assert.deepEqual(TaskV1.parse(task),task);
  for(const x of [{...task,private:true},{...task,privacy_mode:'delegated_secret'},{...task,manifest_revision:1.2},{...task,allowed_sites:['https://permit.example/path']},{...task,actor_id:id}]) assert.throws(()=>TaskV1.parse(x));
});
test('shared permit handoff consumed unchanged by research and attended-start',()=>{
  assert.deepEqual(PermitBrowserHandoffV1.parse(permitHandoff),permitHandoff);
  for(const x of [{...permitHandoff,password:'x'},{...permitHandoff,required_areas:['projects']},{...permitHandoff,confirmed_facts:{...permitHandoff.confirmed_facts,secret:'x'}},{...permitHandoff,portal_origin:'https://permit.example/login'}]) assert.throws(()=>PermitBrowserHandoffV1.parse(x));
});
test('bounded inputs and content-free fixed errors; retry only allowed transient codes',()=>{
  assert.throws(()=>validateInput('browser_navigate',{...inputs.browser_navigate,url:'https://permit.example/'+'é'.repeat(1024)}));
  assert.throws(()=>validateInput('browser_navigate',{...inputs.browser_navigate,url:'https://u:p@permit.example'}));
  for(const code of ERROR_CODES) {
    const error={ok:false,code,message:code,retryable:false,task_id:id};assert.deepEqual(validateOutput('browser_status',error),error);
    if(!['BROWSER_BUSY','BROWSER_RESOURCE_LIMIT','BROWSER_SERVICE_UNAVAILABLE'].includes(code)) assert.throws(()=>validateOutput('browser_status',{...error,retryable:true}));
  }
  assert.throws(()=>validateOutput('browser_status',{ok:false,code:'BROWSER_BAD_INPUT',message:'password=x',retryable:false,task_id:null}));
  assert.throws(()=>validateOutput('browser_list_downloads',{ok:true,downloads:[{...outputs.browser_list_downloads.downloads[0],name:'secret-portal-name'}]}));
});
test('server-only BrowserTask is exact Task plus opaque references, absent from tool inputs',()=>{
  const internal={...task,actor_ref:id,capability_ref:id,manifest_ref:id,state_ref:id};
  assert.deepEqual(BrowserTaskV1.parse(internal),internal);
  assert.throws(()=>validateInput('browser_open',internal));
  assert.throws(()=>BrowserTaskV1.parse({...internal,password:'never'}));
});
test('MCP errors contain only JSON text plus isError',()=>{
  const result=errorEnvelope('BROWSER_BAD_INPUT',id);
  assert.equal(result.isError,true);assert.equal(result.content.length,1);
  assert.deepEqual(validateOutput('browser_open',JSON.parse(result.content[0].text)),{ok:false,code:'BROWSER_BAD_INPUT',message:'BROWSER_BAD_INPUT',retryable:false,task_id:id});
  assert.throws(()=>errorEnvelope('unknown-exception-content',id));
});
test('exact runtime pins and metadata cannot enable release; all flags off',()=>{
  assert.equal(RUNTIME_PINS.playwrightCore.version,'1.64.1');
  assert.equal(RUNTIME_PINS.playwrightCore.chromiumRevision,'1248');
  assert.equal(RUNTIME_PINS.comparatorOnly.version,'0.0.81');
  assert.equal(RUNTIME_PINS.comparatorOnly.runtimeDependency,false);
  assert.equal(Object.values(DEFAULT_FLAGS).every(x=>x===false),true);
  const x={playwrightCore:{version:'1.64.1'},browsers:{browsers:[{name:'chromium',revision:'1248',browserVersion:'156.0.8078.4'}]},mcpSdk:{version:'1.29.0'},comparator:{version:'0.0.81'}};
  assert.deepEqual(verifyInstalledMetadata(x),{ok:true,releaseReady:false});
  assert.deepEqual(verifyInstalledMetadata({...x,browsers:{browsers:[{name:'chromium',revision:'1228'}]}}),{ok:false,releaseReady:false});
});

import {registerBrowserTools} from '../mcp/browser-tools.mjs';
test('stdio wrapper refuses global/unverified registration and has exact v1 catalog',async()=>{
 const records=new Map(),server={registerTool:(name,config,handler)=>records.set(name,{config,handler})};
 assert.throws(()=>registerBrowserTools(server,{transportKind:'http'}));assert.equal(records.size,0);
 const taskId='11111111-1111-4111-8111-111111111111';let calls=0;
 registerBrowserTools(server,{transportKind:'stdio',verifiedRun:{profile:'browser',capability:'memory-only',taskId},authorize:async()=>true,invoke:async()=>{calls++;throw Error('secret upstream details');}});
 assert.deepEqual([...records.keys()],TOOL_NAMES);
 const h=records.get('browser_status').handler;
 for(const input of [{task_id:'22222222-2222-4222-8222-222222222222'},{task_id:taskId,approve:true}]){const result=await h(input);assert.equal(result.isError,true);assert.equal(calls,0);}
 const result=await h({task_id:taskId});assert.equal(calls,1);assert.equal(result.isError,true);assert.equal(result.content[0].text.includes('secret'),false);
});
