import test from 'node:test';
import assert from 'node:assert/strict';
// Expectations precede implementation: strict boundaries, zero forwarding on invalid input.
const tools=await import('../mcp/canvas-tools.mjs');
const uuid='11111111-1111-4111-8111-111111111111';
const valid={request_id:uuid,title:'Steps',summary:'Permit steps',required_areas:[],content:{kind:'diagram',source:'flowchart TD\n A-->B'}};
for(const [label,input,code] of [
 ['unknown identity',{...valid,user_id:uuid},'INVALID_INPUT'],['unknown context',{...valid,context:{}},'INVALID_INPUT'],
 ['coercion',{...valid,title:42},'INVALID_INPUT'],['empty title',{...valid,title:''},'INVALID_INPUT'],
 ['bad UUID',{...valid,request_id:'no'},'INVALID_INPUT'],['unknown area',{...valid,required_areas:['wat']},'INVALID_INPUT'],
 ['duplicate area',{...valid,required_areas:['money','money']},'INVALID_INPUT'],['content override',{...valid,content:{...valid.content,url:'http://localhost'}},'INVALID_INPUT'],
])test(label,async()=>{let calls=0;const regs={};tools.registerCanvasTools({registerTool(n,s,fn){regs[n]=fn;}},{json:v=>v,canvasCall:async()=>{calls++;}});const r=await regs.show_canvas(input);assert.equal(r.isError,true);assert.equal(JSON.parse(r.content[0].text).code,code);assert.equal(calls,0);});
test('four registrations and valid forwarding',async()=>{const regs={};let got;tools.registerCanvasTools({registerTool(n,s,f){assert.equal(s.inputSchema.safeParse({user_id:uuid}).success,false);regs[n]=f;}},{json:v=>v,canvasCall:async(...a)=>(got=a,{ok:true})});assert.deepEqual(Object.keys(regs),['show_canvas','update_canvas','get_canvas','list_canvases']);await regs.show_canvas(valid);assert.deepEqual(got,['show',valid]);});
// Fresh adversarial cases, written before execution. SDK-facing strict schemas
// and the command parser share these same schemas (no coercion or identity args).
for(const [label,action,value] of [
 ['restore xor neither','update',{request_id:uuid,canvas_id:uuid,base_version:1,summary:'x'}],
 ['restore xor both','update',{request_id:uuid,canvas_id:uuid,base_version:1,summary:'x',content:valid.content,restore_version:1}],
 ['note required','update',{request_id:uuid,canvas_id:uuid,base_version:1,summary:'x',content:valid.content}],
 ['zero base','update',{request_id:uuid,canvas_id:uuid,base_version:0,summary:'x',restore_version:1}],
 ['fractional base','update',{request_id:uuid,canvas_id:uuid,base_version:1.5,summary:'x',restore_version:1}],
 ['NaN base','update',{request_id:uuid,canvas_id:uuid,base_version:NaN,summary:'x',restore_version:1}],
 ['infinite base','update',{request_id:uuid,canvas_id:uuid,base_version:Infinity,summary:'x',restore_version:1}],
 ['scope mutation','update',{request_id:uuid,canvas_id:uuid,base_version:1,summary:'x',restore_version:1,project_slug:'other'}],
 ['title cap','show',{...valid,title:'x'.repeat(81)}],['summary cap','show',{...valid,summary:'x'.repeat(501)}],
 ['unknown content kind','show',{...valid,content:{kind:'url',url:'https://example.test'}}],
 ['page identity','show',{...valid,content:{kind:'page',source:'Hi',run_id:uuid}}],
 ['floor URL','show',{...valid,content:{kind:'floor_plan',design_id:'https://example.test',expected_design_rev:1}}],
 ['floor bigint coercion','show',{...valid,content:{kind:'floor_plan',design_id:123,expected_design_rev:1}}],
 ['negative design rev','show',{...valid,content:{kind:'floor_plan',design_id:'123',expected_design_rev:-1}}],
 ['get source coercion','get',{canvas_id:uuid,include_source:'true'}],['get version zero','get',{canvas_id:uuid,version:0}],
 ['list thread input','list',{conversation_id:uuid}],['list limit cap','list',{limit:21}],['list cursor bytes','list',{cursor:'a'.repeat(257)}],
 ['list empty cursor','list',{cursor:''}],['both feed directions','events',{after:'a',before:'b'}],
 ['restore extra summary','restore',{request_id:uuid,base_version:1,restore_version:1,summary:'hidden'}],
 ['delete extra method','delete',{request_id:uuid,action:'show'}],
])test(`fresh: ${label}`,()=>assert.equal(tools.canvasSchemas[action].safeParse(value).success,false));
for(const [name,transportKind,patch,als] of [
 ['HTTP owner tuple','http',{},false],['HTTP staff tuple','http',{SJC_RUN_PROFILE:'business'},false],
 ['bare stdio','stdio',{SJC_RUN_ID:''},false],['missing person','stdio',{SJC_PRINCIPAL_USER_ID:''},false],
 ['wrong start','stdio',{SJC_RUN_STARTED_S:'NaN'},false],['HTTP ALS on stdio','stdio',{},true],
])test(`transport: ${name} cannot forward`,async()=>{
 let calls=0;const env={SJC_RUN_ID:uuid,SJC_CONVERSATION_ID:uuid,SJC_PRINCIPAL_USER_ID:uuid,SJC_RUN_PROFILE:'operator',SJC_RUN_STARTED_S:'1',MCP_HTTP_TOKEN:'valid-real-token',...patch};
 const call=tools.createCanvasCall({transportKind,env,httpActive:()=>als,pool:{query(){throw Error('unexpected SQL');}},internalCall(){calls++;}});
 const r=await call('get',{canvas_id:uuid});assert.equal(r.code,'RUN_CONTEXT_REQUIRED');assert.equal(calls,0);
});
test('source omitted by default and strict restore works',()=>{assert.deepEqual(tools.canvasSchemas.get.parse({canvas_id:uuid}),{canvas_id:uuid});assert.equal(tools.canvasSchemas.update.safeParse({request_id:uuid,canvas_id:uuid,base_version:1,summary:'Restored steps',restore_version:1}).success,true);});
