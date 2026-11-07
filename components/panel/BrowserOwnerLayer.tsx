'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {BrowserView} from './BrowserView';
import {browserStatus,blankBrowserStates,privateWatchReady,type BrowserModel} from './browser/model';
import {useBrowserSession} from './useBrowserSession';
import {trapAskFocus} from './askPaneFocus';
import {browserAPI} from './browser/api';
import {getAskPaneFeed} from './askPaneRegistry';
import {readPanelState} from './panelStore';
import {askPaneLayout} from './askPaneLayout';
export function BrowserOwnerView({model,onAction,onInput}:{model:BrowserModel;onAction:(a:string,value?:string)=>void;onInput?:(e:unknown)=>void}){
 const m={...model,ownerView:true};
 const p=askPaneLayout({width:m.width,height:m.landscape?360:900,mode:'popout',selected:true});
 const split=p.split&&!m.landscape,review=['read_review','resource_review','write_blocked','final_blocked'].includes(m.state);
 const hasImage=!!m.frameUrl&&!review&&!blankBrowserStates.has(m.state)&&(!m.privatePage||privateWatchReady(m));
 const content=(hideStatus=false)=><BrowserView model={{...m,hideStatus:hideStatus||!!m.dialog,hideAnswers:!!m.dialog,frameUrl:m.dialog?undefined:m.frameUrl}} slot="content" onAction={onAction} onInput={onInput}/>;
 const actions=<BrowserView model={m} slot="actions" onAction={onAction} onInput={onInput}/>;
 return <section data-browser-ui data-browser-owner-layer className="grid h-full min-h-0 min-w-0 overflow-hidden bg-paper" aria-label={`${m.personName}'s browser`} style={{gridTemplateRows:'48px auto minmax(0,1fr)',gridTemplateColumns:m.landscape?(m.dialog?'minmax(0,1fr)':'minmax(0,1fr) 128px'):split?`${p.chat}px 12px minmax(480px,1fr)`:'minmax(0,1fr)'}}>
  <header data-owner-header className="col-span-full flex min-w-0 items-center gap-2 border-b border-rule px-3 text-heading"><button className="min-h-11 min-w-11 shrink-0" onClick={()=>onAction('exit')}>‹ Back</button><span className="min-w-0 whitespace-normal line-clamp-2">{m.personName}'s browser{m.projectLabel?' — '+m.projectLabel:''}</span></header>
  <div className="col-span-full row-start-2 min-h-5 px-3 text-subheading" title={m.origin}>{m.origin||'Site unavailable'}{m.landscape&&hasImage&&<span role="status" className="whitespace-normal"> · {browserStatus(m)}</span>}</div>
  {m.landscape?<><div className="col-start-1 row-start-3 flex min-h-0 flex-col overflow-auto"><div className="min-h-0 flex-1">{content(hasImage)}</div></div>{!m.dialog&&<div className="col-start-2 row-start-3 min-h-0 overflow-auto border-l border-rule">{actions}</div>}</>:split?<><div className="col-start-1 row-start-3 flex min-h-0 flex-col overflow-auto px-3">{m.dialog||review?<div className="min-h-0 flex-1">{content()}</div>:<h3 role="status" className="text-heading">{browserStatus(m)}</h3>}{actions}</div><div className="col-start-3 row-start-3 min-h-0">{!review&&<BrowserView model={{...m,dialog:null,hideStatus:true}} slot="content" onAction={onAction} onInput={onInput}/>}</div></>:<div className="row-start-3 flex min-h-0 flex-col"><BrowserView model={m} slot="meta" onAction={onAction}/><div className="min-h-0 flex-1 overflow-auto">{content()}</div><div className="max-h-[40%] shrink-0 overflow-auto">{actions}</div></div>}
 </section>;
}
/** Top host layer, never a staff PaneSnapshot or a staff chat. */
export function BrowserOwnerLayer({taskId,reviewId,width,height,onClose,registerLeave}:{taskId:string;reviewId?:string|null;width:number;height:number;onClose:()=>void;registerLeave?:(guard:{hasControl:()=>boolean;leave:()=>Promise<boolean>}|null)=>void}) {
 const root=useRef<HTMLDivElement>(null),local=useRef(readPanelState().conversationId),[ready,setReady]=useState(false);
 const session=useBrowserSession({taskId,conversationId:null,visible:true,ownerView:true,localThreadId:local.current,onExit:onClose});
 const current=useRef(session);current.current=session;
 useEffect(()=>{registerLeave?.({hasControl:()=>current.current.hasControl(),leave:()=>current.current.beforeLeave('app')});return ()=>registerLeave?.(null);},[registerLeave]);
 useEffect(()=>{let disposed=false;void Promise.all([browserAPI.inUse(),import('./BrowserIdentity').then(m=>m.browserPaneIdentity(null))]).then(([list,identity])=>{if(disposed)return;const item=list.items.find(x=>x.task_id===taskId);session.patch({personName:item?.person_label??'Team member',projectLabel:item?.job_label??null,ownerName:identity.ok?(identity.name??'Owner'):'Owner',isOwner:identity.ok&&identity.isOwner});}).catch(()=>{});return ()=>{disposed=true;};},[taskId,session.patch]);
 useEffect(()=>{
  const opener=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLElement>('button')?.focus();
  const key=(e:KeyboardEvent)=>{if(e.defaultPrevented)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();const s=current.current;if(s.model.capture){void s.action('capture_off');return;}if(s.model.dialog){void s.action('cancel');return;}if(['read_review','resource_review','write_blocked','final_blocked'].includes(s.model.state)){void s.action('close_review');return;}void s.beforeLeave('app').then(ok=>{if(ok)onClose();});}else if(root.current)trapAskFocus(e,root.current.querySelector<HTMLElement>('[role="dialog"]')??root.current);};
  window.addEventListener('keydown',key,true);setReady(true);return ()=>{window.removeEventListener('keydown',key,true);opener?.isConnected&&opener.focus();};
 },[onClose]);
 useEffect(()=>{if(session.model.dialog)root.current?.querySelector<HTMLElement>('[role="dialog"] h2')?.focus();},[session.model.dialog]);
 // A retained action URL resolves its immutable safe outcome, never a decision alias.
 useEffect(()=>{if(reviewId)void session.action('load_action',reviewId);},[reviewId,taskId]);

 return <div data-browser-ui ref={root} role="dialog" aria-modal="true" aria-label="Browser" tabIndex={-1} className="fixed inset-0 z-[80] bg-paper" style={{padding:'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'}}>
  {ready&&<BrowserOwnerView model={{...session.model,width,landscape:height<600&&width>height,ownerView:true}} onInput={session.input} onAction={a=>{if(a==='exit')void session.beforeLeave('app').then(ok=>{if(ok)onClose();});else void session.action(a);}}/>}
 </div>;
}

/** Shared by the docked host and existing detached window; never broadcasts a claim. */
export function useBrowserOwnerHost(){
  const [ownerReview,setOwnerReview]=useState<{taskId:string;reviewId:string|null}|null>(null);
  const ownerLeave=useRef<{hasControl:()=>boolean;leave:()=>Promise<boolean>}|null>(null),ownerCurrent=useRef(ownerReview),ownerBackBusy=useRef(false);ownerCurrent.current=ownerReview;
  const registerOwnerLeave=useCallback((guard:{hasControl:()=>boolean;leave:()=>Promise<boolean>}|null)=>{ownerLeave.current=guard;},[]);
  const ownerOrigin=useRef<string|null>(null),ownerOwned=useRef(false);
  const closeOwner=useCallback(()=>{
    setOwnerReview(null);
    if(ownerOwned.current){ownerOwned.current=false;window.history.back();return;}
    const url=new URL(window.location.href);url.searchParams.delete('browser');url.searchParams.delete('review');window.history.replaceState(window.history.state,'',ownerOrigin.current??url.pathname+url.search+url.hash);
  },[]);
  useEffect(()=>{
    const read=()=>{
      if(window.location.pathname!=='/today'&&!ownerCurrent.current)return;
      const q=new URLSearchParams(window.location.search),taskId=q.get('browser'),reviewId=q.get('review');
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      const own=getAskPaneFeed().snapshots.some(x=>x.kind==='browser'&&x.id===taskId);if(own&&!ownerOwned.current)return;
      if(taskId&&uuid.test(taskId)&&(!reviewId||uuid.test(reviewId))){
        const enter=()=>setOwnerReview(old=>old?.taskId===taskId&&old.reviewId===reviewId?old:{taskId,reviewId});
        const local=readPanelState().conversationId;
        if(local&&!ownerOwned.current&&!ownerCurrent.current){const href=window.location.href;void browserAPI.tasks(local).then(list=>{if(window.location.href===href&&!list.tasks.some(t=>t.task_id===taskId))enter();}).catch(()=>{if(window.location.href===href)enter();});}else enter();
      }
      else if(ownerCurrent.current&&ownerLeave.current?.hasControl()&&!ownerBackBusy.current){
        ownerBackBusy.current=true;window.history.go(1);void ownerLeave.current.leave().then(ok=>{ownerBackBusy.current=false;if(ok){setOwnerReview(null);ownerCurrent.current=null;ownerOwned.current=false;window.history.back();}});
      }else if(!ownerBackBusy.current)setOwnerReview(null);
    };
    const watch=(e:Event)=>{const id=(e as CustomEvent<{taskId:string}>).detail?.taskId;if(!id||!/^[0-9a-f-]{36}$/.test(id))return;if(!ownerOwned.current)ownerOrigin.current=window.location.pathname+window.location.search+window.location.hash;const url=new URL('/today',window.location.origin);url.searchParams.set('browser',id);if(ownerOwned.current)window.history.replaceState(window.history.state,'',url);else {window.history.pushState(window.history.state,'',url);ownerOwned.current=true;}read();};
    read();window.addEventListener('popstate',read);window.addEventListener('sjcos:browser-route',read);window.addEventListener('sjcos:browser-watch',watch);
    return ()=>{window.removeEventListener('popstate',read);window.removeEventListener('sjcos:browser-route',read);window.removeEventListener('sjcos:browser-watch',watch);};
  },[]);
  return {ownerReview,closeOwner,registerOwnerLeave};
}
