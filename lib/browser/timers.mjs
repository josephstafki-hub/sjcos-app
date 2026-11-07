/** Wall-clock cancellation is separate from authority; callers MUST honor the
 * abort signal and recheck the generation at their actual output sink. */
export async function withDeadline(operation,{ms,code='BROWSER_TIMEOUT',signal,onTimeout=()=>{}}){
 if(!Number.isSafeInteger(ms)||ms<1||ms>1200000||typeof operation!=='function')throw Error('BROWSER_BAD_INPUT');
 const controller=new AbortController();let timer,abort;
 const cancelled=new Promise((_,reject)=>{
  abort=()=>{controller.abort();reject(Error(code));};
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{abort();Promise.resolve().then(onTimeout).catch(()=>{});},ms);
 });
 try{if(controller.signal.aborted)throw Error(code);return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),cancelled]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function reviewActivityDeadline({created_at,expires_at,present_until,now}){
 if(![created_at,expires_at,present_until,now].every(Number.isSafeInteger)||created_at>now||expires_at<=now||expires_at<=created_at||expires_at-created_at>60000||present_until<=now)throw Error('BROWSER_REVIEW_STALE');
 return expires_at;
}
