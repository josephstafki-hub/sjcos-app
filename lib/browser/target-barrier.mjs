/** Same Playwright session, prepare before initialization and resume exactly once.
 * A prepared guard retains its original deadline until resume. No new timeout
 * budget on resume; failure revokes the listener before closing the target. */
export async function guardTarget({session,target,binding,validateBinding,registerFetch,registerChildren,closeTarget,revokeListener,timeoutMs=2000,deferResume=false}) {
  let timer,live=true,resumed=false,failed,stage='init';
  // stage is a fixed step label passed to revokeListener so a root run can name the refusing step.
  const refuse=(why=stage)=>failed??=(async()=>{live=false;try{await revokeListener(binding,String(why));}finally{await closeTarget(target);}})();
  const check=async()=>{if(!live||await validateBinding(target,binding)!==true||!live)throw Error();};
  let rejectDeadline;
  const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
  // A prepared guard may expire after this function returns; attach a rejection
  // handler now and fail the boot even when nobody ever calls resume().
  deadline.catch(()=>{});
  const resume=async()=>{
    try{if(resumed)throw Error();resumed=true;await Promise.race([(async()=>{stage='resume-validate';await check();stage='resume-run';await session.send('Runtime.runIfWaitingForDebugger');stage='resume-revalidate';await check();})(),deadline]);clearTimeout(timer);return {ok:true};}
    catch{clearTimeout(timer);try{await refuse();}catch{}return {ok:false,code:'BROWSER_SERVICE_UNAVAILABLE'};}
  };
  try {
    stage='precheck';if(!Number.isFinite(timeoutMs)||timeoutMs>2000||timeoutMs<=0||!['page','iframe'].includes(target.type)||!target.waitingForDebugger||!binding)throw Error();
    stage='start';timer=setTimeout(()=>{live=false;rejectDeadline(Error());void refuse('deadline:'+stage).catch(()=>{});},timeoutMs);
    await Promise.race([(async()=>{
      stage='validate';await check();stage='register-fetch';await registerFetch(session,binding,()=>live);stage='validate-2';await check();
      stage='fetch-enable';await session.send('Fetch.enable',{handleAuthRequests:true,patterns:[{urlPattern:'*',requestStage:'Request'}]});
      stage='validate-3';await check();stage='register-children';await registerChildren(session,binding);stage='validate-4';await check();
    })(),deadline]);
    if(deferResume)return {ok:true,resume,fail:async()=>{clearTimeout(timer);await refuse();}};
    return await resume();
  }catch{clearTimeout(timer);try{await refuse();}catch{}return {ok:false,code:'BROWSER_SERVICE_UNAVAILABLE'};}
}
