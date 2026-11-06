'use server';
import {pollAgentRun} from '@/lib/actions/dev-agents';
import {loadConversationAction} from '@/lib/actions/ai-chat';
import {isAskFailure} from '@/lib/ask-result-codes';
import type {EventPage} from '@/lib/canvas-api-types';

/** Adapters keep the existing action envelopes and the canonical bounded page.
 * No private metadata is persisted to browser storage or shared transcript. */
export async function canvasRunPage(runId:string,after?:string):Promise<EventPage>{
 const {getDevAgentRun}=await import('@/lib/dev-agents');
 const {canvasEvents}=await import('@/lib/ask-canvases');
 const run=await getDevAgentRun(runId);
 if(!run?.conversationId)throw Error('ASK_THREAD_UNAVAILABLE');
 return canvasEvents(run.conversationId,{...(after?{after}:{}),limit:20});
}
export async function pollAgentRunWithCanvas(runId:string,after?:string){
 const result=await pollAgentRun(runId);
 if(isAskFailure(result)||process.env.SJC_CANVAS_ENABLED!=='1')return result as typeof result & {canvas_changes?:EventPage};
 const {askBoundary}=await import('@/lib/thread-access');
 return askBoundary(async()=>{
  return {...result,canvas_changes:await canvasRunPage(runId,after)};
 });
}
export async function loadConversationWithCanvas(id:string){
 const result=await loadConversationAction(id);
 if(isAskFailure(result)||process.env.SJC_CANVAS_ENABLED!=='1')return result as typeof result & {canvas_changes?:EventPage};
 const {askBoundary}=await import('@/lib/thread-access');
 const {canvasEvents}=await import('@/lib/ask-canvases');
 return askBoundary(async()=>{
  return {...result,canvas_changes:await canvasEvents(id,{limit:20})};
 });
}
