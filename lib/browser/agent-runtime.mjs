/** Attended Claude-only runner. Protected bridge owns admission/persistence;
 * this narrow-login process never writes protected ai_messages itself. */
import {buildBrowserLaunch,spawnBrowserCli,browserPrompt,requireCliSupport} from './cli-launch.mjs';
import {strictStartup} from './startup.mjs';
import {UUID} from './phase1-contracts.mjs';
export async function runBrowserAgent({runId,bridge,connectDb,credentialFile,cli,root,servers,cliHelp,managedPolicyAbsent,spawn=spawnBrowserCli,clock=Date.now}){
 UUID.parse(runId);requireCliSupport(cliHelp,{managedPolicyAbsent});
 const client=await strictStartup('runner',{credentialFile,connect:connectDb});let child,launch,finished=false;
 try{
  const run=await bridge.admittedRun(runId); // re-read immutable trusted run
  if(run.runId!==runId||run.profile!=='browser'||run.launchSource!=='panel_web'||run.agent!=='claude'||run.present!==true||run.pendingReview!==false||run.revoked!==false)throw Error('BROWSER_ATTENDED_ONLY');
  for(const id of [run.taskId,run.userId,run.conversationId,run.cliSessionId])UUID.parse(id);
  if(run.expiresAt<=clock()||run.historyProfile!=='browser'||run.resumeSessionId)throw Error('BROWSER_CAPABILITY_EXPIRED');
  await bridge.checkAdmission(run);
  if(typeof bridge.modelBudget!=='function'||typeof bridge.chargeModelBudget!=='function'||typeof bridge.appendPublicMessage!=='function')throw Error('BROWSER_SERVICE_UNAVAILABLE');
  const {RESULT_SCHEMAS}=await import('./repository.mjs');
  const budget=RESULT_SCHEMAS.browser_web_model_budget.parse(await bridge.modelBudget(run));
  if(budget.exhausted||budget.active_ms>=1200000||budget.turns>=60||budget.cost_micros>=2000000)throw Error('BROWSER_RESOURCE_LIMIT');
  launch=await buildBrowserLaunch({root,userId:run.userId,taskId:run.taskId,runId,conversationId:run.conversationId,sessionId:run.cliSessionId,model:run.model,effort:run.effort,maxBudgetUsd:Math.min(run.maxBudgetUsd,(2000000-budget.cost_micros)/1000000),maxTurns:60-budget.turns,servers,providerEnv:await bridge.providerCredential(run)});
  child=spawn(cli,launch);
  // Claim process start/cgroup/executable before releasing a single prompt byte.
  await bridge.registerProcess(run,{pid:child.pid});
  const prompt=browserPrompt({purpose:run.purpose,confirmedFacts:run.confirmedFacts});
  await bridge.appendMessage(run,{role:'user',body:prompt});
  const modelStarted=clock();let costMicros=0,budgetFailed=false,charging=Promise.resolve();
  let ended=false,aborted=false;
  let bytes=0,line='',turns=0,disposition='crashed',answer=null,timer,deadline;
  const abort=()=>{aborted=true;if(ended||deadline)return;child.kill('SIGTERM');deadline=setTimeout(()=>{if(!ended)child.kill('SIGKILL');},2000);};
  timer=setTimeout(abort,Math.max(1,1200000-budget.active_ms));
  const charge=()=>{charging=charging.then(()=>bridge.chargeModelBudget(run,{elapsed_ms:Math.min(1200000,Math.max(0,clock()-modelStarted)),turn_count:turns,cost_micros:costMicros})).then(b=>{if(b.exhausted&&!ended)abort();}).catch(()=>{budgetFailed=true;abort();});return charging;};
  const budgetTimer=setInterval(()=>void charge(),5000);
  const monitor=setInterval(()=>{void bridge.checkAdmission(run).catch(abort);},1000);
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;if(bytes>4*1024*1024){abort();return;}
   line+=chunk.toString('utf8');if(Buffer.byteLength(line)>32768){abort();return;}
   let i;while((i=line.indexOf('\n'))>=0){const current=line.slice(0,i);line=line.slice(i+1);try{const event=JSON.parse(current);if(event.type==='assistant'&&++turns>60-budget.turns)abort();if(event.type==='result'){if(Number.isFinite(event.total_cost_usd)&&event.total_cost_usd>=0)costMicros=Math.ceil(event.total_cost_usd*1000000);disposition=event.is_error?'crashed':'completed';if(typeof event.result==='string'&&Buffer.byteLength(event.result)<=32768)answer=event.result;}}catch{abort();}}
  });
  child.stderr.on('data',()=>{}); // never log raw CLI/page/tool errors
  child.stdin.end(prompt+'\n');
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});}).finally(()=>{clearTimeout(timer);clearTimeout(deadline);clearInterval(monitor);clearInterval(budgetTimer);});
  if(aborted||code!==0||line.trim())disposition='crashed';
  await charge();if(budgetFailed||aborted)disposition='crashed';
  // Persist authenticated finish BEFORE normal exit. No stale capability revival.
  if(answer!==null&&disposition==='completed')await bridge.appendPublicMessage(run,{role:'assistant',body:answer});
  await bridge.finishRun(run,disposition);finished=true;return {run_id:runId,disposition};
 }finally{
  if(child&&!finished){child.kill('SIGKILL');await bridge.failRun(runId).catch(()=>{});}
  await client.end();await bridge.purgeRunCache?.(runId,launch?.cwd);
 }
}

/** Production tool dispatcher. All 13 names stay present; later features are
 * fixed refusals. io methods are protected installation adapters, never MCP
 * names/arguments chosen as CDP selectors or arbitrary code. */
export function createTaskMcpHandler({taskId,service,io}){
 UUID.parse(taskId);
 return async(name,raw)=>{
  const {validateInput,validateOutput}=await import('./contracts.mjs');
  const {webError}=await import('./phase1-contracts.mjs');
  const input=validateInput(name,raw);if(input.task_id!==taskId)throw Error('BROWSER_FORBIDDEN');
  const ticket=service.modelTicket(taskId);
  const task=await io.authorize(); // capability, flags, person, session, areas, attendance
  const deny=code=>({...webError(code),task_id:taskId});
  if(name==='browser_fill_login')return deny('BROWSER_VAULT_UNAVAILABLE');
  if(name==='browser_stage_upload')return deny('BROWSER_PHASE1_READ_ONLY');
  if(name==='browser_list_logins')return {ok:true,logins:[]};
  if(name==='browser_list_downloads')return {ok:true,downloads:[]};
  if(name==='browser_prepare_action'){
   // SQL begin(prepare) persists a fixed final_blocked notice; never an action.
   await io.refusePrepare(input);return deny('BROWSER_PHASE1_READ_ONLY');
  }
  let output;
  if(name==='browser_open')output={ok:true,task:await io.taskProjection(task),queue_position:await io.queuePosition()};
  else if(name==='browser_status')output={ok:true,task:await io.taskProjection(task),pending_action_id:null,last_result:await io.lastResult()};
  else if(name==='browser_observe')output=await service.observe(taskId,()=>io.capturePublic(task));
  else if(name==='browser_request_take_over'){await io.requestTakeOver(input.reason);output={ok:true,task:await io.taskProjection(task),requested:true};}
  else if(name==='browser_action_status')output=await io.actionStatus(input.action_id);
  else if(name==='browser_close'){await service.close(taskId);output={ok:true,task_id:taskId,state:'closed'};}
  else if(name==='browser_navigate'){
   // Exact read authority is consumed and independently anchored by D. A staged
   // candidate is not transmitted, and loss after consume never replays.
   const result=await service.read(taskId,signal=>io.navigateWithReadAuthority(input,{signal}));
   if(!['loaded','waiting_for_review'].includes(result))throw Error('BROWSER_REVIEW_REQUIRED');
   output={ok:true,task:await io.taskProjection(await io.authorize()),result,action_id:null};
  }else if(name==='browser_act'){
   const observation=service.observation(taskId,input.observation_id,input.ref);
   const verdict=await service.io.hooks.submitGuard({operation:input,observation,phase:1});
   if(verdict?.allowed!==true)return deny('BROWSER_PHASE1_READ_ONLY');
   await io.localAct(input);output={ok:true,result:'done',action_id:null,document_epoch:task.document_epoch};
  }else throw Error('BROWSER_BAD_INPUT');
  // Fence every awaited result again; public observation gets its own privacy
  // sanitizer after capture. No page exception strings reach the model.
  await io.authorize();
  // Privacy can change during the final authorization await. Check the actual
  // synchronous MCP return sink too; no already-built public output escapes.
  if(name==='browser_observe'&&!output.private)output=service.publishModel(taskId,ticket,output);
  return validateOutput(name,output);
 };
}
