/* Embedded verbatim into the isolated coreBundle. No env/argv enable switch. */
function createSjcRuntime() {
  const sessions = new WeakMap(), boots = new WeakMap();
  // Fixed reason codes (target type only, never URLs or content) so a root run can tell which check refused.
  const error = (reason) => Error('BROWSER_TARGET_BARRIER_REFUSED' + (reason ? ':' + reason : ''));
  function boot(browser) {
    let b = boots.get(browser);
    if (!b) {
      const policy = browser.options.__sjcBarrier;
      if (!policy || ['guardTarget','bindTarget','validateBinding','registerFetch','revokeListener'].some(k => typeof policy[k] !== 'function')) throw error('policy');
      b = {policy, live:true, targets:new Set(), pages:new Map(), states:new Set(), listeners:new Set(), contexts:new Map()};
      boots.set(browser,b);
      policy.registerFence?.(()=>{b.live=false;});
    }
    if (!b.live || b.policy.isLive?.()===false) throw error('boot-not-live:' + (b.failReason || 'unknown'));
    return b;
  }
  async function fail(browser, reason = 'unknown') {
    const b = boots.get(browser);
    if (!b || b.failing) return;
    b.failing = true;
    b.failReason = String(reason).slice(0, 80); // first cause only
    b.live = false; // synchronous fence before any asynchronous revocation
    await Promise.allSettled([...b.states].map(s=>s.guard?.fail()));
    // fail() is often fired and forgotten (void fail(...)). The boot is already dead (live=false above) and the
    // launcher's revokeListener closes the browser in its finally; a revoke that cannot reach a crashed gate
    // must be recorded, not escape as an unhandled rejection that kills the controlling process.
    try { await b.policy.revokeListener(b.failReason); } catch { b.revokeFailed = true; }
  }
  async function deny(browser,session,target,reason='deny') {
    try { await fail(browser, 'deny:' + reason); }
    finally { if (target?.targetId) { const x=await session._parentSession?.send('Target.closeTarget',{targetId:target.targetId}) ?? await browser._session.send('Target.closeTarget',{targetId:target.targetId}); if(x?.success!==true) throw error('close-failed:'+reason); } }
    throw error(reason);
  }
  async function attach(browser, session, event) {
    const b=boot(browser), target={...event.targetInfo,waitingForDebugger:event.waitingForDebugger};
    if (!['page','iframe'].includes(target.type) || !target.waitingForDebugger || !browser._contexts.has(target.browserContextId) || b.targets.has(target.targetId) || b.contexts.get(target.browserContextId)?.closing) return deny(browser,session,target,!['page','iframe'].includes(target.type)?'type:'+String(target.type).replace(/[^a-z_]/gi,'').slice(0,24):!target.waitingForDebugger?'not-waiting':!browser._contexts.has(target.browserContextId)?'unknown-context':'duplicate');
    const count=b.pages.get(target.browserContextId)||0;
    if(target.type==='page' && count>=2) return deny(browser,session,target,'page-limit');
    b.targets.add(target.targetId); // reserve synchronously, before bindTarget awaits
    if(target.type==='page') b.pages.set(target.browserContextId,count+1);
    const s={browser,session,target,b,queue:[],dispatch:null,resumed:false,closing:false,released:false};
    sessions.set(session,s);b.states.add(s);
    try {
      const started=Date.now();
      let timer;
      const binding=await Promise.race([b.policy.bindTarget(target),new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('bind-timeout')),2000);})]).finally(()=>clearTimeout(timer));
      if(!b.live)throw error('bind-not-live');
      s.guard=await b.policy.guardTarget({session,target,binding,deferResume:true,timeoutMs:2000-(Date.now()-started),
        validateBinding:async(t,v)=>b.live && !s.closing && !s.released && await b.policy.validateBinding(t,v)===true && b.live && !s.closing && !s.released,
        registerFetch:async()=>{
          // Controller callback owns only request-stage Fetch. Auth is always
          // CancelAuth; Playwright network handlers are removed by the patch.
          session.on('Fetch.authRequired',e=>{if(b.live)void session.send('Fetch.continueWithAuth',{requestId:e.requestId,authChallengeResponse:{response:'CancelAuth'}}).catch(()=>fail(browser,'auth-cancel-failed'));});
          session.on('Inspector.targetCrashed',()=>{void fail(browser,'target-crashed');});
          session.on('Inspector.targetReloadedAfterCrash',()=>{void fail(browser,'reloaded-after-crash');});
          await b.policy.registerFetch(session,binding,()=>b.live && !s.closing && !s.released);
        },
        registerChildren:async()=>{
          session.on('Target.attachedToTarget',e=>{
            const child=session.createChildSession(e.sessionId);
            const inherited={...e,targetInfo:{...e.targetInfo,browserContextId:e.targetInfo.browserContextId||target.browserContextId}};
            void attach(browser,child,inherited).then(()=>{if(!b.live)return;const item={...inherited,__sjcSession:child};if(s.dispatch)s.dispatch(item);else s.queue.push(item);}).catch(e=>fail(browser,'child-attach:'+String(e?.message||'').replace(/^BROWSER_TARGET_BARRIER_REFUSED:?/,'').slice(0,60)));
          });
          session.on('Target.detachedFromTarget',e=>{detached(browser,e);});
          await session.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
        },
        revokeListener:async(_binding,why)=>{if(!b.failReason)b.failReason='guard:'+String(why||'unknown').replace(/[^a-z0-9:_-]/gi,'').slice(0,40)+':'+String(target.type).replace(/[^a-z_]/gi,'').slice(0,24);b.live=false;await b.policy.revokeListener();},
        closeTarget:async()=>{const x=await browser._session.send('Target.closeTarget',{targetId:target.targetId});if(x?.success!==true)throw error('close-target');}
      });
      if(!s.guard.ok||!b.live)throw error(!b.live?'guard-not-live':'guard-refused');
      return s;
    } catch (e) { await deny(browser,session,target,/^BROWSER_[A-Z_]+(:[a-z0-9:_-]+)?$/i.test(e?.message||'')?String(e.message).slice(0,80):'attach-error'); }
  }
  function reserveContext(browser,options) {
    const b=boot(browser),proxy=options.proxyOverride||options.proxy;
    if(b.listeners.size>=2||options.httpCredentials||options.serviceWorkers!=='block'||!proxy||!/^http:\/\/10\.203\.0\.2:1808[12]$/.test(proxy.server)||proxy.username||proxy.password||proxy.bypass||b.listeners.has(proxy.server))throw error(b.listeners.size>=2?'context-limit':options.httpCredentials?'credentials':options.serviceWorkers!=='block'?'service-workers':!proxy?'no-proxy':'proxy');
    b.listeners.add(proxy.server);
  }
  function commitContext(browser,id,options) {
    const b=boot(browser),proxy=options.proxyOverride||options.proxy;
    if(!b.listeners.has(proxy.server)||b.contexts.has(id))throw error('context-commit');
    b.contexts.set(id,{proxy:proxy.server,closing:false});
  }
  function detached(browser,e) {
    const b=boots.get(browser);if(!b)return;
    const s=[...b.states].find(s=>s.target.targetId===e.targetId||typeof e.sessionId==='string'&&s.session._sessionId===e.sessionId);
    if(!s||!s.closing)void fail(browser,'unexpected-detached');else {s.detached=true;s.detachAck?.();}
  }
  async function closing(browser,states,send) {
    const b=boot(browser);
    if(states.some(s=>!s.resumed||s.closing||s.released)) {await fail(browser,'close-state');throw error('close-state');}
    for(const s of states){s.closing=true;s.detachedPromise=new Promise(r=>{s.detachAck=r;});} // synchronous fence before policy/CDP awaits
    try {
      for(const s of states)await b.policy.releaseTarget(s.target);
      if(!b.live)throw error('close-not-live');
      await send();
      let timer;try{await Promise.race([Promise.all(states.map(s=>s.detachedPromise)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(error('close-detach-timeout')),2000);})]);}finally{clearTimeout(timer);}
      if(!b.live)throw error('close-not-live');
      for(const s of states){s.released=true;b.states.delete(s);b.targets.delete(s.target.targetId);
        if(s.target.type==='page')b.pages.set(s.target.browserContextId,Math.max(0,(b.pages.get(s.target.browserContextId)||0)-1));}
    }catch(e){await fail(browser,'guarded-close-failed');throw error('guarded-close-failed');}
  }
  async function closePage(browser,id) {
    const b=boot(browser),page=[...b.states].find(s=>s.target.targetId===id&&s.target.type==='page');
    if(!page){await fail(browser,'close-unknown');throw error('close-unknown');}
    // All OOPIFs in this page's session tree close with their parent page.
    const owned=s=>s===page||s.session._parentSession===page.session||[...b.states].some(p=>p!==s&&s.session._parentSession===p.session&&owned(p));
    return closing(browser,[...b.states].filter(owned),async()=>{const r=await browser._session.send('Target.closeTarget',{targetId:id});if(r?.success!==true)throw error('close-failed');});
  }
  async function closeContext(browser,id) {
    const b=boot(browser),c=b.contexts.get(id);if(!c||c.closing)throw error('close-context-unknown');c.closing=true;
    await closing(browser,[...b.states].filter(s=>s.target.browserContextId===id),()=>browser._session.send('Target.disposeBrowserContext',{browserContextId:id}));
    b.contexts.delete(id);b.listeners.delete(c.proxy);b.pages.delete(id);
  }
  async function resume(session) {
    const s=sessions.get(session);
    if(!s||!s.b.live||s.closing||s.released||s.resumed)throw error('resume-state');
    s.resumed=true;
    if(!(await s.guard.resume()).ok||!s.b.live){await fail(s.browser,'resume-refused');throw error('resume-refused');}
  }
  function ready(session,dispatch) {
    const s=sessions.get(session);if(!s||!s.b.live||s.closing||s.released)throw error('ready-state');
    s.dispatch=dispatch;for(const e of s.queue.splice(0))dispatch(e);
  }
  async function detach(session) {const s=sessions.get(session);if(!s)throw error('detach-unknown');return deny(s.browser,session,s.target,'detached');}
  function lost(session) {const s=sessions.get(session);if(s&&!s.closing&&!s.released)void fail(s.browser,'session-lost').catch(()=>{});}
  function prepared(session) {const s=sessions.get(session);if(!s||!s.b.live||s.closing||s.released)throw error('prepared-state');}
  // Upstream registers the CRPage synchronously on attach, before Target.createTarget returns.
  // Here attach first passes the barrier, so wait (bounded, fail-closed) for the approved page.
  async function pageFor(browser,targetId) {
    const end=Date.now()+2500;
    for(;;){const b=boots.get(browser);if(!b||!b.live)throw error('page-not-live:'+(b?.failReason||'unknown'));
      const p=browser._crPages.get(targetId);if(p)return p;
      if(Date.now()>end){await fail(browser,'page-timeout');throw error('page-timeout');}
      await new Promise(r=>setTimeout(r,10));}
  }
  return {attach,resume,ready,prepared,fail,deny,boot,detach,lost,reserveContext,commitContext,closePage,closeContext,detached,pageFor,
    connect(parent,transport,options){if(options.persistent||!options.__sjcBarrier)throw error('connect-options');return CRBrowser.connect(parent,transport,options);}};
}
