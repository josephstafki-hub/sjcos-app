/** In-process callback for a FUTURE pinned Playwright patch. Never registers
 * competing raw Target autoattach. Session belongs to Playwright itself. */
export async function guardTarget({session,target,binding,validateBinding,registerFetch,registerChildren,closeTarget,revokeListener,timeoutMs=2000}) {
  let timer,live=true;
  const refuse=async()=>{live=false;try{await revokeListener(binding);}finally{await closeTarget(target);}};
  try {
    if(timeoutMs>2000||timeoutMs<=0||!['page','iframe'].includes(target.type)||!target.waitingForDebugger||!binding)throw Error();
    await Promise.race([(async()=>{
      if(await validateBinding(target,binding)!==true||!live)throw Error();
      // Handlers first, Fetch acknowledgment second, recursive guards third.
      await registerFetch(session,binding);
      if(!live)throw Error();
      await session.send('Fetch.enable',{handleAuthRequests:true,patterns:[{urlPattern:'*',requestStage:'Request'}]});
      await registerChildren(session,binding);
      if(await validateBinding(target,binding)!==true||!live)throw Error();
      await session.send('Runtime.runIfWaitingForDebugger');
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>{live=false;reject(Error());},timeoutMs);})]);
    return {ok:true};
  }catch{try{await refuse();}catch{/* Runtime adapter must fail its entire boot if cleanup fails. */}return {ok:false,code:'BROWSER_SERVICE_UNAVAILABLE'};}finally{clearTimeout(timer);}
}
