'use client';

import {useCallback,useEffect,useId,useLayoutEffect,useReducer,useRef,useState,useSyncExternalStore} from 'react';
import {useRouter} from 'next/navigation';
import {History} from 'lucide-react';
import type {TodayPriority} from '@/lib/today';
import {QueueRail} from './QueueRail';
import {PanelChat} from './PanelChat';
import type {ActiveRun} from './useAgentChat';
import {AskContentPane} from './AskContentPane';
import {AskPaneSplitter} from './AskPaneSplitter';
import {askPaneLayout,arrivalSelection,canvasAnnouncement,initialPaneState,paneTransition,readPaneWidth,writePaneWidth,tabKey,topEscapeLayer,type PaneMode,type PaneRef,type PaneSnapshot} from './askPaneLayout';
import {askPaneOverlays,getAskPaneFeed,getServerAskPaneFeed,recalledAskPane,rememberAskPane,sameAskScope,setAskPaneScope,subscribeAskPanes} from './askPaneRegistry';
import {AskPaneHistory} from './askPaneHistory';
import {moveAskFrameFocus,trapAskFocus} from './askPaneFocus';
import {useAskContentWidth,useAskViewport} from './askPaneHooks';

export type AskPaneControls={closeOperator:()=>Promise<boolean>;exitForNavigation:(href:string)=>Promise<boolean>};
export type AskPaneActivity={selected:boolean;landscape:boolean};
export function PanelDock({width,navigate,compact=false,inWindow=false,mode=inWindow?'popout':'dock',active=true,suspended=false,dockWidth=width,onPaneActivity,registerPaneControls,closeOperator,landscapeWindowBar}: {
  width?:number;navigate?:(href:string)=>void;compact?:boolean;inWindow?:boolean;mode?:PaneMode;active?:boolean;suspended?:boolean;dockWidth?:number;
  onPaneActivity?:(activity:AskPaneActivity)=>void;
  landscapeWindowBar?:import('react').ReactNode;
  registerPaneControls?:(controls:AskPaneControls|null)=>void;closeOperator?:()=>void;
}) {
  const [,setActiveRun]=useState<ActiveRun|null>(null);
  const [narrowView,setNarrowView]=useState('chat');
  const [threadsOpen,setThreadsOpen]=useState(false);
  const [focusedSubjectId,setFocusedSubjectId]=useState<string|null>(null);
  const [feedback,setFeedback]=useState('');
  const [announcement,setAnnouncement]=useState('');
  const [chatWidth,setChatWidth]=useState<number|null>(null);
  const capturedDock=useRef<number|null>(null);
  const [device,setDevice]=useState('');
  const strip=useRef<HTMLDivElement>(null);
  const root=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
  const chatRegion=useRef<HTMLHeadingElement>(null);
  const viewport=useAskViewport();
  const measured=useAskContentWidth(root);
  const stripWidth=useAskContentWidth(strip);
  const feed=useSyncExternalStore(subscribeAskPanes,getAskPaneFeed,getServerAskPaneFeed);
  const scope=feed.scope;
  const scopeKey=scope?JSON.stringify([scope.userId,scope.threadId,scope.claimToken]):'';
  const [state,dispatch]=useReducer(paneTransition,'',initialPaneState);
  // Scope mismatch masks pixels during render, before any cleanup effect.
  const selected=active&&state.scope===scopeKey?state.selected:null;
  const snapshot=selected?feed.snapshots.find(x=>x.id===selected.id&&x.kind===selected.kind):undefined;
  const registration=snapshot?feed.registrations.find(x=>x.id===snapshot.kind):undefined;
  const showing=!!snapshot&&!!registration;
  const policy=askPaneLayout({width:measured,height:viewport.height,mode,selected:showing,dockWidth:capturedDock.current??dockWidth,chatWidth,stripWidth:stripWidth+1});
  const history=useRef<AskPaneHistory|null>(null);
  const origin=useRef<HTMLElement|null>(null);
  const entrySerial=useRef(0);
  const handOffRef=useRef<((p:TodayPriority,kind:'do'|'prep')=>void)|null>(null);
  const restoredScope=useRef<string|null>(null);
  const previousScope=useRef(scopeKey);
  const requestSeen=useRef<unknown>(null);
  const transitionBusy=useRef(false);
  const router=useRouter();
  const id=useId();
  const chatId=`${id}-chat`,paneId=`${id}-pane`,queueId=`${id}-queue`;
  const current=useRef({feed,selected,snapshot,registration,showing,scopeKey});
  current.current={feed,selected,snapshot,registration,showing,scopeKey};
  const restoreFocus=()=>requestAnimationFrame(()=>{
    if(origin.current?.isConnected&&origin.current.getClientRects().length)origin.current.focus();
    else chatRegion.current?.focus();
  });
  useEffect(()=>{history.current=new AskPaneHistory(window);},[]);
  useLayoutEffect(()=>{
    dispatch({type:'scope',scope:scopeKey});setChatWidth(null);setFeedback('');setAnnouncement('');
    // Identity changes invalidate DOM requests, but never run a browser action.
    requestSeen.current=null;
    if(previousScope.current!==scopeKey&&history.current?.ownsEntry)void history.current.consume();
    previousScope.current=scopeKey;
  },[scopeKey]);
  useEffect(()=>{
    try {
      let value=localStorage.getItem('sjcos:ask-pane-device:v1');
      if(!value){value=crypto.randomUUID();localStorage.setItem('sjcos:ask-pane-device:v1',value);}setDevice(value);
    }catch{setDevice(crypto.randomUUID());}
  },[]);
  useEffect(()=>{
    if(!scope||!device||mode==='dock')return;
    try{setChatWidth(readPaneWidth(window.localStorage,scope.userId,device));}catch{setChatWidth(null);}
  },[scopeKey,device,mode,scope]);
  const commitWidth=(next:number)=>{
    setChatWidth(next);
    if(mode!=='dock'&&scope&&device)try{writePaneWidth(window.localStorage,scope.userId,device,next);}catch{/* storage getter can itself throw */}
  };
  const leave=useCallback(async(reason:'switch'|'exit'|'operator'|'navigation'|'back')=>{
    const before=current.current;
    try {
      if(before.snapshot&&before.registration?.beforeLeave&&!(await before.registration.beforeLeave(before.snapshot,reason)))return false;
    }catch{setFeedback("Couldn't leave the browser. Try again.");return false;}
    return before.scopeKey===current.current.scopeKey&&!before.feed.signal.aborted;
  },[]);
  const select=useCallback(async(ref:PaneRef,cause:'person'|'arrival'='person',opener:HTMLElement|null=null,direct=false)=>{
    const now=current.current;
    if(!active||suspended||!now.feed.scope||transitionBusy.current)return;
    if(!now.feed.snapshots.some(x=>x.kind===ref.kind&&x.id===ref.id)||!now.feed.registrations.some(x=>x.id===ref.kind))return;
    transitionBusy.current=true;
    try {
      if(now.selected&&(now.selected.id!==ref.id||now.selected.kind!==ref.kind)&&!(await leave('switch')))return;
      if(now.scopeKey!==current.current.scopeKey||!current.current.feed.snapshots.some(x=>x.id===ref.id&&x.kind===ref.kind))return;
      if(cause==='person'){origin.current=opener??document.activeElement as HTMLElement;entrySerial.current++;}
      if(!now.selected&&mode==='dock')capturedDock.current=dockWidth??420;
      dispatch({type:'scope',scope:now.scopeKey});
      dispatch({type:'select',ref,mode,cause});setNarrowView('chat');setThreadsOpen(false);setFeedback('');
      rememberAskPane(now.feed.scope,now.feed.snapshots.find(x=>x.kind===ref.kind&&x.id===ref.id)??ref);
      if(mode!=='popout')history.current?.open(ref,direct);
    }finally{transitionBusy.current=false;}
  },[active,suspended,mode,leave,dockWidth]);
  const exit=useCallback(async(reason:'exit'|'operator'|'navigation'|'back'='exit')=>{
    const now=current.current;
    if(transitionBusy.current)return false;
    transitionBusy.current=true;
    try {
      if(now.showing&&!(await leave(reason)))return false;
      if(reason!=='back'&&mode!=='popout')await history.current?.consume();
      else if(mode==='popout')history.current?.clean();
      if(now.scopeKey!==current.current.scopeKey)return false;
      if(now.feed.scope)rememberAskPane(now.feed.scope,reason==='operator'?(current.current.snapshot??now.selected):null);
      dispatch({type:reason==='operator'?'close-operator':reason==='back'?'pop':'exit'});
      setNarrowView('chat');setChatWidth(null);capturedDock.current=null;
      if(reason==='operator')setAskPaneScope(null);
      restoreFocus();return true;
    }finally{transitionBusy.current=false;}
  },[leave,mode]);
  useEffect(()=>{
    if(!active||suspended)return;
    registerPaneControls?.({closeOperator:()=>exit('operator'),exitForNavigation:async(href)=>{
      if(!(await exit('navigation')))return false;
      if(navigate)navigate(href);else router.push(href);return true;
    }});
    return ()=>registerPaneControls?.(null);
  },[active,suspended,exit,navigate,registerPaneControls,router]);
  useLayoutEffect(()=>{onPaneActivity?.({selected:showing,landscape:policy.landscape});},[active,suspended,showing,policy.landscape,onPaneActivity]);
  useEffect(()=>{
    if(active)for(const feature of feed.registrations)feature.onActivate?.();
  },[active,suspended,feed.registrations]);
  useEffect(()=>{if(!active)restoredScope.current=null;},[active,suspended]);
  useEffect(()=>{
    if(!active||suspended||!scope||!feed.loaded||restoredScope.current===scopeKey)return;
    restoredScope.current=scopeKey;
    const query=new URLSearchParams(window.location.search);
    if(window.location.pathname==='/today'&&query.has('browser')&&!feed.snapshots.some(x=>x.kind==='browser'&&x.id===query.get('browser')))return;
    const direct=feed.snapshots.find(x=>query.get(x.kind==='workbench'?'record':x.kind)===x.id);
    const saved=direct??recalledAskPane(scope);
    if(saved&&feed.snapshots.some(x=>x.kind===saved.kind&&x.id===saved.id)&&!current.current.selected)void select(saved,'person',null,!!direct);
    else if(['canvas','browser','record'].some(key=>query.has(key)))history.current?.clean();
  },[active,suspended,scope,scopeKey,feed.loaded,feed.snapshots,select]);
  useEffect(()=>{
    if(!active||suspended||!feed.request||requestSeen.current===feed.request)return;
    requestSeen.current=feed.request;
    if(sameAskScope(scope,feed.request.scope))void select(feed.request.ref,'person',feed.request.opener);
  },[active,suspended,feed.request,scope,select]);
  // Arrivals can use an already expanded host or wide popout, never expand
  // a resting dock/sheet. Human choice and current-run eligibility still win.
  useEffect(()=>{
    const expanded=showing||(mode==='popout'&&measured>=840);
    if(!active||suspended||!expanded||!scope)return;
    const busyFocus=!!document.activeElement?.matches('input,textarea,[contenteditable="true"]')||!!document.querySelector('[role="dialog"]:not(#mobile-operator-sheet)')||askPaneOverlays(scope).length>0;
    const next=arrivalSelection({arrivals:feed.snapshots,selected,humanChoice:state.humanChoice,expanded,canFollow:feed.canFollow&&!busyFocus});
    if(next&&(next.id!==selected?.id||next.kind!==selected?.kind))void select(next,'arrival');
  },[active,suspended,showing,scope,feed.snapshots,feed.canFollow,selected,state.humanChoice,select,mode,measured]);
  useEffect(()=>{
    if(!active||suspended)return;
    const pop=async()=>{
      if(history.current?.isOurEntry()){
        // Blocked Back was restored, or Forward reached a consumed entry.
        if(!current.current.showing)history.current.clean();return;
      }
      if(transitionBusy.current)return;
      if(current.current.showing&&!(await exit('back'))){history.current?.restoreAfterBlockedBack();return;}
      history.current?.didPop();
    };
    window.addEventListener('popstate',pop);return ()=>window.removeEventListener('popstate',pop);
  },[active,suspended,exit]);
  useEffect(()=>{
    if(!active||suspended||!showing)return;
    const key=(event:KeyboardEvent)=>{
      const layers=askPaneOverlays(current.current.feed.scope);
      const top=topEscapeLayer(layers);
      if(event.key==='Escape'&&!event.defaultPrevented){
        event.preventDefault();event.stopImmediatePropagation();
        if(top)top.onEscape();else void exit();return;
      }
      if(top?.element)trapAskFocus(event,top.element);
    };
    // Capture beats PanelHost's bubble listener and stops exactly ONE layer.
    window.addEventListener('keydown',key,true);return ()=>window.removeEventListener('keydown',key,true);
  },[active,suspended,showing,exit]);
  // Missing/revoked metadata unmounts pixels immediately and clears stale URL.
  useEffect(()=>{
    if(active&&selected&&!showing){void history.current?.consume();dispatch({type:'pop'});setChatWidth(null);}
  },[active,suspended,selected,showing]);
  const seen=useRef(new Map<string,string>());
  const [,refreshSeen]=useReducer((value:number)=>value+1,0);
  useEffect(()=>{
    if(!snapshot||!showing||!active)return;
    if(scope)rememberAskPane(scope,snapshot);
    const key=scopeKey+snapshot.kind+snapshot.id;
    if(seen.current.get(key)===snapshot.revision)return;
    seen.current.set(key,snapshot.revision);refreshSeen();
    if(snapshot.kind==='canvas')setAnnouncement(canvasAnnouncement(snapshot.label,snapshot.latest_version,snapshot.followLatest!==false));
    else if(snapshot.kind==='browser')setAnnouncement(`Browser opened: ${snapshot.label}`);
  },[snapshot,showing,active,scopeKey,scope]);
  const frameBoundary=(frame:HTMLIFrameElement,direction:'forward'|'backward'|'escape')=>{
    if(!root.current?.contains(frame)||feed.signal.aborted)return;
    if(direction==='escape'){
      const top=topEscapeLayer(askPaneOverlays(scope));
      if(top)top.onEscape();else void exit();
    }else{
      const trap=root.current.closest<HTMLElement>('[role="dialog"]')??root.current;
      moveAskFrameFocus(trap,frame,direction==='backward');
    }
  };
  const hasFeatures=feed.registrations.some(x=>x.id!=='workbench');
  const twoCol=!compact&&mode!=='sheet'&&!showing&&(width??measured)>=560;
  const tabs=['queue','chat',...(['canvas','browser'] as const).filter(kind=>feed.registrations.some(x=>x.id===kind))];
  const tabValue=showing&&snapshot?.kind!=='workbench'?snapshot!.kind:narrowView;
  const chooseTab=async(value:string,opener:HTMLElement)=>{
    if(value==='queue'||value==='chat'){
      if(showing&&!(await exit())){if(!askPaneOverlays(scope).length)root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();return;}dispatch({type:'human'});setNarrowView(value);return;
    }
    const next=feed.snapshots.find(x=>x.kind===value);
    if(next)await select(next,'person',opener);else setFeedback(`${value==='canvas'?'Canvas':'Browser'} isn't available yet.`);
  };
  const inspect=(subjectId:string)=>{
    setFocusedSubjectId(subjectId);
    const registered=feed.registrations.some(x=>x.id==='workbench');
    const record=feed.snapshots.find(x=>x.kind==='workbench'&&x.subject_id===subjectId);
    if(registered&&record)void select(record,'person');
    else {const href=`/workbench?s=${encodeURIComponent(subjectId)}`;if(navigate)navigate(href);else router.push(href);}
  };
  const showSelector=!twoCol||showing||hasFeatures;
  const chatVisible=showing?policy.split:twoCol||narrowView!=='queue';
  return <div data-ask-host ref={root} className={`flex h-full min-h-0 min-w-0 ${policy.landscape?'flex-row gap-0 pb-2':'flex-col gap-2 p-2'}`}>
    {showSelector&&<div data-horizontal-selector={!policy.landscape?true:undefined} ref={strip} className={`shrink-0 ${policy.landscape?'flex min-w-16 flex-col border-r border-rule':'flex h-12 min-w-0 items-center'}`}>
      {policy.landscape&&mode==='popout'&&landscapeWindowBar}
      {policy.landscape&&mode==='sheet'&&<button aria-label="Close Operator" onClick={closeOperator} className="h-12 w-full text-heading focus-visible:outline-2 focus-visible:outline-focus">×</button>}
      <div role="tablist" aria-label="Operator view" aria-orientation={policy.landscape?'vertical':'horizontal'} className={`min-w-0 rounded-md bg-paper-2 ${policy.landscape?'flex flex-col':tabs.length===2?'inline-flex h-12 max-w-full items-center gap-0.5 overflow-x-auto p-0.5':'flex h-12 flex-1 items-center gap-0.5 p-0.5'}`}>
        {tabs.map(tab=>{
          const attention=feed.snapshots.find(x=>x.kind===tab&&x.attention!=='none'&&seen.current.get(scopeKey+x.kind+x.id)!==x.revision);
          const label=tab[0].toUpperCase()+tab.slice(1);
          const accessible=attention?`${label}, ${tab==='canvas'?'new version':attention.attention==='needs_you'?'needs you':'new activity'}`:label;
          return <button key={tab} role="tab" id={`${id}-tab-${tab}`} aria-label={accessible} aria-selected={tabValue===tab} aria-controls={tab==='queue'?queueId:tab==='chat'?chatId:paneId} tabIndex={tabValue===tab?0:-1}
            className={`relative inline-flex shrink-0 items-center whitespace-nowrap rounded-[5px] px-2.5 font-sans text-label font-medium transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${policy.landscape?'h-12 min-w-16':tabs.length===2?'h-11':'h-11 flex-1 min-w-0'} ${tabValue===tab?'bg-card text-ink shadow-card':'text-ink-3'}`}
            onClick={e=>void chooseTab(tab,e.currentTarget)}
            onKeyDown={e=>{const next=tabKey(tabs,tab,e.key,policy.landscape);if(next){e.preventDefault();const target=root.current?.querySelector<HTMLElement>(`[id="${id}-tab-${next}"]`);target?.focus();if(target)void chooseTab(next,target);}}}>
            {label}{attention&&<span className="ml-0.5 inline-block size-1.5 rounded-full bg-ai" aria-hidden="true" />}
          </button>;
        })}
      </div>
      {inWindow&&showing&&!policy.landscape&&<button aria-label="Threads" aria-pressed={threadsOpen} onClick={()=>{if(showing)void exit().then(ok=>{if(ok)setThreadsOpen(true);});else setThreadsOpen(open=>!open);}} className="flex size-12 shrink-0 items-center justify-center text-ink-3"><History className="size-4" /></button>}
    </div>}
    <div ref={content} className="relative min-h-0 min-w-0 flex-1">
      <div className="grid h-full min-h-0 min-w-0" style={{gridTemplateColumns:showing?(policy.split?`${policy.chat}px 12px minmax(0,1fr)`:'minmax(0,1fr)'):twoCol?((width??measured)>=880?'minmax(200px,2fr) minmax(480px,4fr)':'minmax(200px,2fr) minmax(300px,3fr)'):'minmax(0,1fr)',gap:twoCol?8:0}}>
        {!showing&&(twoCol||narrowView==='queue')&&<div id={queueId} className="flex min-h-0" role="tabpanel" aria-label="Queue"><QueueRail className="flex min-h-0 flex-1" onHandOff={(p,k)=>{handOffRef.current?.(p,k);setNarrowView('chat');}} onInspect={inspect} focusedSubjectId={focusedSubjectId}/></div>}
        <div key="chat" id={chatId} role="tabpanel" aria-label="Chat" className={`min-h-0 min-w-0 ${chatVisible?'grid':'hidden'} grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]`}>
          <h2 ref={chatRegion} tabIndex={-1} className="sr-only">Chat</h2>
          <PanelChat paneActive={active} browserVisible={showing&&snapshot?.kind==='browser'} onCanvasChat={()=>exit()} selectedCanvas={showing&&snapshot?.kind==='canvas'?{id:snapshot.id,version:snapshot.selected_version}:null} registerHandOff={fn=>{handOffRef.current=fn;}} onRunStart={setActiveRun} onRunEnd={()=>setActiveRun(null)} showQueueCards={false} showNarration={!inWindow} compact={compact} threadView={inWindow&&!twoCol?threadsOpen:undefined} onThreadViewChange={open=>{dispatch({type:'human'});setThreadsOpen(open);}} threadsRail={!compact&&!showing&&(width??measured)>=880}/>
        </div>
        {showing&&policy.split&&<AskPaneSplitter width={policy.chat} min={policy.min} max={policy.max} reset={policy.reset} controls={`${chatId} ${paneId}`} onResize={setChatWidth} onCommit={commitWidth}/>}
        {showing&&snapshot&&registration&&<AskContentPane key={`${scopeKey}:${snapshot.kind}:${snapshot.id}`} id={paneId} registration={registration} snapshot={snapshot} mode={mode} compact={policy.compact} landscape={policy.landscape} split={policy.split} paneWidth={policy.pane} viewportWidth={viewport.width} signal={feed.kindSignals?.[snapshot.kind]??feed.signal} frameBoundary={frameBoundary} onExit={()=>void exit()} entrySerial={entrySerial.current}/>}
      </div>
      {feedback&&<div role="alert" className="absolute inset-x-0 bottom-0 bg-paper p-2 text-body text-flag"><button className="min-h-11 text-left" onClick={()=>setFeedback('')}>{feedback}</button></div>}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </div>;
}
