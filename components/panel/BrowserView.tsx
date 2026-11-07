'use client';
import {useEffect,useRef,useState} from 'react';
import {browserStatus,blankBrowserStates,type BrowserModel} from './browser/model';
import {PHONE_INSTRUCTION} from './browser/device';
import {InputEvent} from '../../lib/browser/phase1-contracts.mjs';
import {browserMenuKey} from './browser/navigation';
import {letterboxPoint,privateWatchReady} from './browser/model';
export type BrowserViewProps={model:BrowserModel;slot:'title'|'meta'|'content'|'actions'|'all';onAction:(action:string,value?:string)=>void;onInput?:(event:unknown)=>void};
const button='min-h-12 min-w-11 rounded border border-rule bg-paper px-3 text-subheading focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';
export function BrowserView({model:m,slot,onAction,onInput}:BrowserViewProps) {
 const root=useRef<HTMLDivElement>(null),image=useRef<HTMLDivElement>(null),ime=useRef<HTMLTextAreaElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const [answerId,setAnswerId]=useState<string|null>(null);
 const status=browserStatus(m),all=slot==='all',review=['read_review','resource_review','write_blocked','final_blocked'].includes(m.state);
 const privateHidden=!!m.ownerView&&!!m.privatePage&&!privateWatchReady(m);
 const canImage=!blankBrowserStates.has(m.state)&&!privateHidden&&!review;
 const controlled=m.state==='controlling'&&!m.phone&&!m.busy&&!m.livePaused&&!m.zoom;
 const remoteActions:Record<string,string>={takeover:'take_over',done:'done',fresh:'fresh_browser',resume:'resume',stop:'stop',pause_owner:'pause',back:'back',forward:'forward',reload:'reload',confirm_reload:'reload',window:'switch_tab'};
 const act=(label:string,action:string,disabled=false,value?:string,ariaLabel?:string)=><button type="button" aria-label={ariaLabel} className={button+(action==='takeover'?' min-h-14':'')} disabled={disabled||m.busy||(!!remoteActions[action]&&!(m.availableControls??[]).includes(remoteActions[action]))} onClick={()=>onAction(action,value)}>{label}</button>;
 useEffect(()=>{if(review)heading.current?.focus();},[review,m.state]);
 useEffect(()=>{
  if(!m.capture||!controlled)return;
  image.current?.focus();
 },[m.capture,controlled]);
 const send=(event:unknown)=>{const parsed=InputEvent.safeParse(event);if(controlled&&parsed.success)onInput?.(parsed.data);};
 const point=(e:{clientX:number;clientY:number})=>image.current?letterboxPoint(image.current.getBoundingClientRect(),e.clientX,e.clientY):null;
 const pointer=(e:React.PointerEvent<HTMLDivElement>,phase:'down'|'up'|'move')=>{
  if(!controlled)return;const p=point(e);if(!p)return;
  if(phase==='down'){e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.focus();}
  send({type:'pointer',phase,...p,button:Math.max(0,e.button),buttons:e.buttons,modifiers:e.shiftKey?['Shift']:[]});
  if(phase==='up'&&e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 };
 const controls=()=>{
  if(m.state==='final_blocked')return act('Close','close_review');
  if(m.state==='write_blocked')return <>{!m.phone&&!m.ownerView&&act('Take over','takeover')}{act('Close','close_review')}</>;
  if(m.state==='read_review'||m.state==='resource_review')return <>{act(m.state==='read_review'?'Read once':'Allow these files once','approve_read',!m.readUrls?.length||m.readExpired||(m.state==='resource_review'&&(m.readUrls?.length??0)>20))}{act(m.state==='read_review'?"Don't open":'Keep blocked','deny_read')}</>;
  if(m.state==='off')return act('Close','exit');
  if(m.state==='unsupported')return act('Start with Claude','claude');
  if(m.state==='empty')return act('Open browser','sites');
  if(m.state==='queued')return act('Leave line','stop');
  if(m.state==='offer')return <>{act('Open browser','start')}{act('Leave line','stop')}</>;
  if(['queue_expired','offer_expired'].includes(m.state))return act('Get back in line','start');
  if(m.state==='queue_full')return act('Close','exit');
  if(m.state==='pause_failed')return <>{act('Try again','retry_pause')}{act('Stop browser','stop')}</>;
  if(m.state==='disconnected')return act('Reconnect','reconnect');
  if(m.state==='auth_expired')return <a className={button+' inline-flex items-center'} href="/login">Sign in</a>;
  if(['latched','access_removed','closed'].includes(m.state))return act('Close','exit');
  if(['crashed','idle_closed'].includes(m.state))return act('Open again','sites');
  if(m.state==='service_unavailable')return <>{act('Try again','reconnect')}{act('Close','exit')}</>;
  if(m.ownerView)return <>{privateHidden?(m.privateViewStatus==='pending_audit'?null:act('Show the page','show_private')):!privateHidden&&!m.phone&&!review&&act(`Take over from ${m.personName}`,'takeover')}{act('Pause agent','pause_owner')}</>;
  if(m.state==='done')return <>{act('Open a fresh browser','fresh')}{act('Keep paused','keep_paused')}</>;
  return <>
   {m.state==='controlling'?act('Done','done'):m.state==='taking_over'?null:m.state==='paused_private'?<>{!m.phone&&act('Take over again','takeover')}{act('Open a fresh browser','fresh')}</>:<>{['paused','absent','turn_ended','owner_paused','reconnected'].includes(m.state)&&!m.privatePage&&act(m.state==='reconnected'?'Resume':'Continue','resume')}{!m.phone&&act(m.state==='other_device'?'Take over here':'Take over','takeover')}</>}
   {act('Stop browser','stop')}
  </>;
 };
 const dialog=()=>{
  if(!m.dialog)return null;
  if(m.dialog==='menu')return <div role="dialog" aria-modal="true" aria-label="Browser options" className="absolute inset-0 z-10 overflow-y-auto bg-paper p-4 space-y-2" onKeyDown={e=>browserMenuKey(e,e.currentTarget)}><h2 tabIndex={-1}>Browser options</h2><div className="flex flex-wrap gap-2">{act('‹','back',!m.navigation,undefined,'Back')}{act('›','forward',!m.navigation,undefined,'Forward')}{act('Reload','reload',!m.navigation)}{m.windowCount===2&&<>{act(m.origin,'window',!m.navigation?.target_ids[0],m.navigation?.target_ids[0])}{act('Payment window','window',!m.navigation?.target_ids[1],m.navigation?.target_ids[1])}</>}</div><p>Review page addresses</p>{act('This task’s sites','sites')}{m.phone&&<p>{PHONE_INSTRUCTION}</p>}<p>Sending information isn't available in this version.</p>{act('Close','cancel')}</div>;
  const title=m.dialog==='reload'?'Reload this page?':m.dialog==='takeover'?"Take over? After you take over, the agent can't see this page anymore. To let it keep reading, open a fresh browser afterwards.":m.dialog==='fresh'?'Starts a new browser for this task on the same sites. Pages you signed in to will need signing in again.':m.dialog==='leave'?`Pause browser and return to ${m.destination??'Chat'}?`:m.dialog==='pause_owner'?`Pause ${m.personName}'s agent? ${m.personName} will need to tap Continue.`:m.dialog==='replace'?`Take over from ${m.personName}? Their control ends.`:'This task can use these sites.';
  return <div role="dialog" aria-modal="true" aria-label={title} className="absolute inset-0 z-10 flex min-h-0 flex-col bg-paper p-4 text-subheading">
   <div className="min-h-0 flex-1 space-y-3 overflow-y-auto"><h2 tabIndex={-1}>{title}</h2>
    {m.dialog==='reload'&&<p>Reloading may clear what you've entered. Review page addresses before reloading. Nothing will be sent.</p>}
    {m.dialog==='sites'&&<><ul>{m.sites?.map(s=><li key={s} className="break-all">{s}</li>)}</ul>{m.areas?.length?<p>Areas: {m.areas.join(', ')}</p>:null}<h3>Pages this task may read</h3><ul>{(m.approvedReadUrls??m.readUrls)?.map((s,i)=><li key={i} className="break-all">{s}</li>)}</ul><p>Review page addresses</p><p>This version reads public pages only. Sending job details isn't available yet.</p><label className="block">Page address<input type="url" name="page-address" className="mt-1 min-h-11 w-full border border-rule p-2" placeholder="https://city.example/" onChange={e=>onAction('address',e.target.value)} /></label><label className="block">What should the agent read?<input name="purpose" maxLength={500} className="min-h-11 w-full border border-rule p-2" onChange={e=>onAction('purpose',e.target.value)} /></label>{!m.sites?.length&&!m.addressReady&&<p>Add at least one site to start.</p>}</>}
    {m.error&&<p role="alert">{m.error}</p>}
    {m.dialog==='takeover'&&m.isOwner&&<label className="flex min-h-11 items-center gap-2"><input type="checkbox" onChange={e=>onAction('suppress_confirm',String(e.target.checked))}/>Don't ask again</label>}
   </div>
   <div className="flex shrink-0 flex-wrap gap-2 pt-2">{act(m.dialog==='reload'?'Reload':m.dialog==='fresh'?'Open a fresh browser':m.dialog==='leave'?'Pause and return':m.dialog==='pause_owner'?'Pause agent':m.dialog==='sites'?(m.hasTask?'Add a site':'Open browser'):'Take over',m.dialog==='reload'?'confirm_reload':m.dialog==='fresh'?'confirm_fresh':m.dialog==='leave'?'confirm_leave':m.dialog==='pause_owner'?'confirm_pause_owner':m.dialog==='sites'?'create':'confirm_takeover',m.dialog==='sites'&&!m.addressReady)}{act(m.dialog==='leave'?'Keep browser open':'Cancel','cancel')}</div>
  </div>;
 };
 return <div ref={root} tabIndex={m.capture?0:undefined} className="h-full min-h-0 min-w-0 motion-reduce:transition-none" data-browser-state={m.state} data-browser-compact-capture={m.compactCapture?true:undefined}>
  {(all||slot==='title')&&<div className="flex min-w-0 items-center"><h2 data-browser-title ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate px-2 text-heading" title={m.origin}>{m.origin||'Browser'}</h2>{m.compactCapture?<><span className="truncate text-subheading"> · You're in control</span>{act('Done','done')}</>:!review&&<button type="button" aria-label="Browser options" className="size-11 shrink-0" onClick={()=>onAction('menu')}>⋯</button>}</div>}
  {(all||slot==='meta')&&<p role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 gap-1 text-meta"><span className="min-w-0 truncate">{status}</span>{m.watchingOwner&&<span className="shrink-0"> · {m.ownerName} is watching.</span>}{m.windowCount===2&&!m.landscape&&<span> · 2 windows</span>}</p>}
  {(all||slot==='content')&&<div className={'relative flex h-full min-h-0 flex-col p-1 '+(review?'overflow-y-auto':'overflow-hidden')}>
   {m.idleSeconds!==undefined&&m.idleSeconds<=60&&m.idleSeconds>0&&!review&&<p className="flex flex-wrap items-center text-subheading">Browser closes in {m.idleSeconds} seconds. {act('Keep open','keep_open')}</p>}
   {m.privatePage&&!m.ownerView&&<p className="shrink-0 text-subheading">Private — you took over. The agent can't see this page.</p>}
   {m.capture&&!m.compactCapture&&controlled&&<p className="shrink-0 text-subheading">Keys go to the website · Esc to stop</p>}
   {m.livePaused&&<p className="text-subheading">Live view paused. The agent may still be working.</p>}
   {(!canImage||!m.frameUrl)&&<h3 ref={heading} tabIndex={-1} className="p-3 text-heading">{status}</h3>}
   {m.state==='loading'&&m.frameUrl&&<p>Earlier view</p>}
   {review&&m.readUrls?.map((url,i)=><p key={i} className="break-all p-2 text-subheading">{url}</p>)}
   {m.state==='empty'&&m.isOwner&&!!m.inUse?.length&&<div className="space-y-2 overflow-auto p-3"><h3>In use</h3>{m.inUse.map(item=><div key={item.task_id} className="flex items-center gap-2 text-subheading"><p>{item.person_label} · {item.task_kind}{item.project_label?' — '+item.project_label:''} · {item.state==='active'?'Agent is working':'Paused'}</p><button className={button} onClick={()=>onAction('watch',item.task_id)}>Watch</button></div>)}</div>}
   {m.state==='write_blocked'&&!m.phone&&<p className="px-3 text-subheading">Sending information isn't available in this version.</p>}
   {canImage&&m.frameUrl&&<div ref={image} role="group" aria-label="Website view" tabIndex={0} className={'relative min-h-0 flex-1 overflow-auto bg-black '+(controlled?'touch-none':'')} onPointerDown={e=>pointer(e,'down')} onPointerMove={e=>{if(e.buttons)pointer(e,'move');}} onPointerUp={e=>pointer(e,'up')}
    onWheel={e=>{if(!controlled)return;const p=point(e);if(p)send({type:'wheel',...p,delta_x:Math.max(-1200,Math.min(1200,e.deltaX)),delta_y:Math.max(-1200,Math.min(1200,e.deltaY))});}}
    onKeyDown={e=>{if(!m.capture||!controlled)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onAction('capture_off');return;}const parsed=InputEvent.safeParse({type:'key',phase:'down',key:e.key,code:e.code,modifiers:e.shiftKey?['Shift']:[]});if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&parsed.success){e.preventDefault();send(parsed.data);}}}
    onKeyUp={e=>{if(m.capture&&controlled&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key!=='Escape')send({type:'key',phase:'up',key:e.key,code:e.code,modifiers:e.shiftKey?['Shift']:[]});}}>
    {/* Authorized raster only; no remote DOM/iframe, no per-frame live announcements. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={m.frameUrl} alt={`Live view of ${m.origin}. ${status}${status.endsWith('.')?'':'.'}`} draggable={false} className={m.zoom?'h-auto min-w-[1280px] max-w-none':'h-full w-full object-contain'} />
   </div>}
   {m.capture&&controlled&&<textarea ref={ime} aria-label="Keyboard for website" autoComplete="off" className="min-h-11 shrink-0 border border-rule p-2" onCompositionEnd={e=>{send({type:'ime_commit',text:e.data});e.currentTarget.value='';}} onChange={e=>{if(!(e.nativeEvent as Event & {isComposing?:boolean}).isComposing&&e.target.value){send({type:'ime_commit',text:e.target.value});e.target.value='';}}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onAction('capture_off');}}} onPaste={e=>e.preventDefault()} onCopy={e=>e.preventDefault()} />}
   {!!m.answers?.length&&!m.compactCapture&&<div className={'shrink-0 overflow-auto text-subheading '+(m.width>=960?'max-h-56':'max-h-28')}><h3>Your answers</h3>{m.answers.map(a=><div key={a.id} className="flex items-center gap-2"><p>{a.label}: {a.value} · From chat</p><button className={button} disabled={!controlled} onClick={()=>onInput?.({type:'type_answer',answer_id:a.id,confirmed_revision:a.revision})}>Type it</button></div>)}</div>}
   {m.phone&&!m.landscape&&!review&&!blankBrowserStates.has(m.state)&&<p className="shrink-0 p-2 text-subheading">{PHONE_INSTRUCTION}</p>}
   {m.error&&!m.dialog&&<p role="alert" className="p-2 text-subheading">{m.error}</p>}{dialog()}
  </div>}
  {(all||slot==='actions')&&<div className={'flex w-full gap-1 overflow-auto p-1 '+(m.landscape?'h-full flex-col':'items-center')}>
   {m.compactCapture&&!m.landscape?<div className="flex min-h-11 items-center gap-2 whitespace-nowrap" aria-label="Your answers">{m.answers?.map(a=><button key={a.id} className={button} onClick={()=>setAnswerId(a.id)}>{a.label} ▸</button>)}{m.answers?.filter(a=>a.id===answerId).map(a=><span key={a.id}>{a.value} <button className={button} onClick={()=>onInput?.({type:'type_answer',answer_id:a.id,confirmed_revision:a.revision})}>Type it</button></span>)}</div>:controls()}
   {!m.compactCapture&&!review&&canImage&&<>{act(m.zoom?'Fit view':'Zoom','zoom')}{act(m.livePaused?'Resume live view':'Pause live view','live_pause')}{controlled&&act('Keyboard','capture')}</>}
   {m.phone&&m.landscape&&!review&&!blankBrowserStates.has(m.state)&&<p className="text-subheading" aria-label={PHONE_INSTRUCTION}>{m.landscape?'Take over on a tablet or computer.':PHONE_INSTRUCTION}</p>}
  </div>}
 </div>;
}
