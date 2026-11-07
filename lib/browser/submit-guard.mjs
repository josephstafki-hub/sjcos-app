/** Layer 1 refuses ambiguous model controls before click. Layer 2 is the
 * independent exact-read gate; labels/DOM heuristics never authorize a request. */
export const PHASE1_STOP_CARD=Object.freeze({message:'This version stops here. Nothing was submitted.',button:'Close'});
export function submitGuard({operation,observation,actualRequest,phase=1,classify}) {
  const blocked=()=>({allowed:false,kind:'blocked',code:'BROWSER_PHASE1_READ_ONLY',notice_kind:'final_blocked',card:PHASE1_STOP_CARD});
  if(phase!==1)return blocked();
  if(actualRequest){
    // Only the independently bound classifier may prove a GET/HEAD is a read.
    const result=typeof classify==='function'?classify(actualRequest):null;
    return result?.kind==='read'?{allowed:true,kind:'read',entry_id:result.entry_id}:blocked();
  }
  // Adapter-free Phase 1: no generic click/fill/check/select/Enter is known safe.
  // Link navigation uses a separately reviewed exact read, never a click bypass.
  if(observation?.private===false&&['scroll','key'].includes(operation?.type??operation?.operation)){
    const type=operation.type??operation.operation;
    if(type==='scroll'||['Tab','Shift+Tab','Escape'].includes(operation.key))return {allowed:true,kind:'local'};
  }
  return blocked();
}
