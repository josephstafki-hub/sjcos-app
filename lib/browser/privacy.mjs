/** Permanent context privacy. All IO hooks are trusted controller adapters, not
 * route JSON. A missing/failed hook fences the generation and never grants input. */
import {UUID,UInt,InputEvent,TaskSafe} from './phase1-contracts.mjs';
import {browserEnterPrivate} from './repository.mjs';
const fail=()=>{throw Error('BROWSER_PRIVATE_INPUT_REQUIRED');};
const sinks=new Set(['model','log','transcript','receipt','error','download','frame','title','query','dom','console','network','trace']);
export function createPublicOutputFence({contextGeneration}) {
  UInt.parse(contextGeneration);let epoch=0,closed=false;
  return Object.freeze({
    contextGeneration,
    ticket(){return Object.freeze({epoch,contextGeneration});},
    fence(){closed=true;epoch++;},
    isOpen(){return !closed;},
    // Check at the synchronous sink itself, AFTER every await. emit must enqueue
    // synchronously; an asynchronous transport must repeat this check on flush.
    publish({ticket,task,sink,value,emit}) {
      if(!sinks.has(sink)||closed||ticket?.epoch!==epoch||ticket?.contextGeneration!==contextGeneration||task?.context_generation!==contextGeneration||task?.private!==false||task?.privacy_mode!=='public'||typeof emit!=='function')return false;
      emit(value);return true;
    },
  });
}
export async function enterPrivate({taskId,bootId,expectedEpoch,contextGeneration,reason,io}) {
  UUID.parse(taskId);UUID.parse(bootId);UInt.parse(expectedEpoch);UInt.parse(contextGeneration);
  if(reason!=='manual'||!io?.outputFence||io.outputFence.contextGeneration!==contextGeneration)fail();
  // No await, not even acquiring the lock, before closing all public sinks.
  io.outputFence.fence();
  try {
    if(io.fenceCommands({taskId,contextGeneration})!==true)fail();
    return await io.withContextLock(taskId,async()=>{
      const task=TaskSafe.parse(await io.readTask());
      if(task.id!==taskId||task.controller_boot_id!==bootId||task.control_epoch!==expectedEpoch||task.context_generation!==contextGeneration||!['active','paused'].includes(task.state)||task.vault_dependency!=='none')fail();
      if(await io.cancelAndDrainCommands()!==true)fail();
      if(await io.cancelObservations()!==true)fail();
      if(await io.stopAndAckScreencast()!==true)fail();
      if(await io.drainPublicOutputs()!==true)fail();
      // Persist must COMMIT before resolving. No private input on rolled-back SQL.
      const saved=TaskSafe.parse(await io.persistPrivate({tid:taskId,boot:bootId,expected_epoch:expectedEpoch,mode:'private'}));
      if(saved.id!==taskId||!saved.private||saved.privacy_mode!=='private'||saved.context_generation!==contextGeneration||saved.vault_dependency!=='none'||saved.state!=='paused')fail();
      const rotated=await io.rotatePrivateHandles(saved);
      UInt.min(1).parse(rotated?.stream_generation);
      if(await io.ackPrivate({context_generation:contextGeneration,control_epoch:saved.control_epoch,stream_generation:rotated.stream_generation})!==true)fail();
      return {privacy_mode:'private',context_generation:contextGeneration,control_epoch:saved.control_epoch,stream_generation:rotated.stream_generation,drained:true};
    });
  }catch {
    try{await io.pauseAfterFailure();}catch{}
    fail(); // Never propagate page/adapter exception strings.
  }
}
/** Explicit transaction adapter for enterPrivate.io.persistPrivate. */
export const persistPrivateWithRepository=({transaction},args)=>transaction(client=>browserEnterPrivate(client,args));
export function authorizeManualInput({task,viewer,control,frame,event,now}) {
  try{InputEvent.parse(event);TaskSafe.parse(Object.fromEntries(Object.keys(TaskSafe.shape).map(k=>[k,task?.[k]])));}catch{fail();}
  if(viewer?.task_id!==task.id||frame?.task_id!==task.id||!Number.isSafeInteger(now)||![viewer?.present_until,viewer?.expires_at,control?.expires_at,frame?.expires_at].every(Number.isFinite)||!UUID.safeParse(frame?.id).success||!task?.private||task.privacy_mode!=='private'||task.vault_dependency!=='none'||!['active','paused'].includes(task.state)||control?.drained!==true||control.context_generation!==task.context_generation||control.control_epoch!==task.control_epoch||control.holder_viewer_id!==viewer?.id||control.web_session_id!==viewer?.web_session_id||viewer?.consented!==true||viewer?.session_valid!==true||viewer.present_until<=now||viewer.expires_at<=now||control.expires_at<=now||frame?.expires_at<=now||frame?.viewer_id!==viewer.id||frame.context_generation!==task.context_generation||frame.document_epoch!==task.document_epoch||frame.control_epoch!==task.control_epoch||frame.stream_id!==viewer.stream_id||frame.stream_generation!==viewer.stream_generation||frame.id!==viewer.last_frame_uuid||typeof control.claimSequence!=='function'||control.claimSequence({frame_id:frame.id,event})!==true)fail();
  return {allowed:true};
}
export async function ensurePrivateBeforeInput({task,input,io,viewer,control,frame,now}) {
  InputEvent.parse(input);
  const barrier=task.private?io.getPrivateBarrier():await enterPrivate({taskId:task.id,bootId:task.controller_boot_id,expectedEpoch:task.control_epoch,contextGeneration:task.context_generation,reason:'manual',io});
  if(barrier?.drained!==true||io.outputFence.isOpen()||barrier.context_generation!==task.context_generation)fail();
  // Re-read authority after the drain; do not deliver using the old public frame.
  const current=await io.readInputAuthority({viewer,control,frame});
  authorizeManualInput({...current,event:input,now:typeof now==='function'?now():now});
  return barrier;
}
export async function finishPrivateInput({io}) {
  // Done never returns a public handle, irrespective of vault preferences.
  try{if(await io.stopInputAndCapture()!==true)fail();const task=TaskSafe.parse(await io.pausePrivate());if(!task.private||task.state!=='paused')fail();return task;}catch{fail();}
}
export async function freshAnonymousReset({task,io}) {
  if(task?.state!=='paused'||!task.private)fail();
  io.outputFence.fence();
  try{
    if(await io.destroyAndFenceOldGeneration(task)!==true)fail();
    const fresh=TaskSafe.parse(await io.commitFreshGeneration(task));
    if(fresh.id!==task.id||fresh.context_generation!==task.context_generation+1||fresh.private||fresh.privacy_mode!=='public'||fresh.vault_dependency!=='none'||fresh.current_run_id!==null||fresh.state!=='paused'||fresh.controller_boot_id===task.controller_boot_id)fail();
    return {task:fresh,outputFence:createPublicOutputFence({contextGeneration:fresh.context_generation})};
  }catch{fail();}
}
