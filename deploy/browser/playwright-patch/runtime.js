/* Embedded verbatim into the isolated coreBundle. No env/argv enable switch. */
function createSjcRuntime() {
  const sessions = new WeakMap(), boots = new WeakMap();
  const error = () => Error('BROWSER_TARGET_BARRIER_REFUSED');
  function boot(browser) {
    let b = boots.get(browser);
    if (!b) {
      const policy = browser.options.__sjcBarrier;
      if (!policy || ['guardTarget','bindTarget','validateBinding','registerFetch','revokeListener'].some(k => typeof policy[k] !== 'function')) throw error();
      b = {policy, live:true, targets:new Set(), pages:new Map(), states:new Set(), listeners:new Set()};
      boots.set(browser,b);
    }
    if (!b.live) throw error();
    return b;
  }
  async function fail(browser) {
    const b = boots.get(browser);
    if (!b || b.failing) return;
    b.failing = true;
    b.live = false; // synchronous fence before any asynchronous revocation
    await Promise.allSettled([...b.states].map(s=>s.guard?.fail()));
    await b.policy.revokeListener();
  }
  async function deny(browser,session,target) {
    try { await fail(browser); }
    finally { if (target?.targetId) { const x=await session._parentSession?.send('Target.closeTarget',{targetId:target.targetId}) ?? await browser._session.send('Target.closeTarget',{targetId:target.targetId}); if(x?.success!==true) throw error(); } }
    throw error();
  }
  async function attach(browser, session, event) {
    const b=boot(browser), target={...event.targetInfo,waitingForDebugger:event.waitingForDebugger};
    if (!['page','iframe'].includes(target.type) || !target.waitingForDebugger || !browser._contexts.has(target.browserContextId) || b.targets.has(target.targetId)) return deny(browser,session,target);
    const count=b.pages.get(target.browserContextId)||0;
    if(target.type==='page' && count>=2) return deny(browser,session,target);
    b.targets.add(target.targetId); // reserve synchronously, before bindTarget awaits
    if(target.type==='page') b.pages.set(target.browserContextId,count+1);
    const s={browser,session,target,b,queue:[],dispatch:null,resumed:false};
    sessions.set(session,s);b.states.add(s);
    try {
      const started=Date.now();
      let timer;
      const binding=await Promise.race([b.policy.bindTarget(target),new Promise((_,reject)=>{timer=setTimeout(()=>reject(error()),2000);})]).finally(()=>clearTimeout(timer));
      if(!b.live)throw error();
      s.guard=await b.policy.guardTarget({session,target,binding,deferResume:true,timeoutMs:2000-(Date.now()-started),
        validateBinding:async(t,v)=>b.live && await b.policy.validateBinding(t,v)===true && b.live,
        registerFetch:async()=>{
          // Controller callback owns only request-stage Fetch. Auth is always
          // CancelAuth; Playwright network handlers are removed by the patch.
          session.on('Fetch.authRequired',e=>{if(b.live)void session.send('Fetch.continueWithAuth',{requestId:e.requestId,authChallengeResponse:{response:'CancelAuth'}}).catch(()=>fail(browser));});
          session.on('Inspector.targetCrashed',()=>{void fail(browser);});
          session.on('Inspector.targetReloadedAfterCrash',()=>{void fail(browser);});
          await b.policy.registerFetch(session,binding,()=>b.live);
        },
        registerChildren:async()=>{
          session.on('Target.attachedToTarget',e=>{
            const child=session.createChildSession(e.sessionId);
            const inherited={...e,targetInfo:{...e.targetInfo,browserContextId:e.targetInfo.browserContextId||target.browserContextId}};
            void attach(browser,child,inherited).then(()=>{if(!b.live)return;const item={...inherited,__sjcSession:child};if(s.dispatch)s.dispatch(item);else s.queue.push(item);}).catch(()=>fail(browser));
          });
          session.on('Target.detachedFromTarget',()=>{void fail(browser);});
          await session.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
        },
        revokeListener:async()=>{b.live=false;await b.policy.revokeListener();},
        closeTarget:async()=>{const x=await browser._session.send('Target.closeTarget',{targetId:target.targetId});if(x?.success!==true)throw error();}
      });
      if(!s.guard.ok||!b.live)throw error();
      return s;
    } catch { await deny(browser,session,target); }
  }
  function reserveContext(browser,options) {
    const b=boot(browser),proxy=options.proxyOverride||options.proxy;
    if(b.listeners.size>=2||options.httpCredentials||options.serviceWorkers!=='block'||!proxy||!/^http:\/\/10\.203\.0\.2:1808[12]$/.test(proxy.server)||proxy.username||proxy.password||proxy.bypass||b.listeners.has(proxy.server))throw error();
    b.listeners.add(proxy.server);
  }
  async function resume(session) {
    const s=sessions.get(session);
    if(!s||!s.b.live||s.resumed)throw error();
    s.resumed=true;
    if(!(await s.guard.resume()).ok||!s.b.live){await fail(s.browser);throw error();}
  }
  function ready(session,dispatch) {
    const s=sessions.get(session);if(!s||!s.b.live)throw error();
    s.dispatch=dispatch;for(const e of s.queue.splice(0))dispatch(e);
  }
  async function detach(session) {const s=sessions.get(session);if(!s)throw error();return deny(s.browser,session,s.target);}
  function lost(session) {const s=sessions.get(session);if(s)void fail(s.browser).catch(()=>{});}
  function prepared(session) {const s=sessions.get(session);if(!s||!s.b.live)throw error();}
  return {attach,resume,ready,prepared,fail,deny,boot,detach,lost,reserveContext,
    connect(parent,transport,options){if(options.persistent||!options.__sjcBarrier)throw error();return CRBrowser.connect(parent,transport,options);}};
}
