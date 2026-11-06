'use client';
import {useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import {getAskPaneFeed,registerAskPaneOverlay} from '../askPaneRegistry';
import {trapAskFocus} from '../askPaneFocus';
export function CanvasOverlay({title,onClose,children,menu=false}:{title:string;onClose:()=>void;children:ReactNode;menu?:boolean}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useLayoutEffect(()=>{const origin=document.activeElement as HTMLElement|null;ref.current?.querySelector<HTMLElement>('button,[tabindex="0"]')?.focus();return ()=>{if(origin?.isConnected)origin.focus();};},[]);
 useEffect(()=>{const scope=getAskPaneFeed().scope;if(!scope)return;return registerAskPaneOverlay({scope,priority:menu?600:500,onEscape:()=>close.current(),element:ref.current??undefined});},[menu]);
 return <div className={`fixed inset-0 z-[100] flex items-end justify-center bg-black/30 ${menu?'lg:items-start lg:justify-end lg:p-4 lg:pt-24':'lg:items-center'}`} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div ref={ref} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e=>{
    if(menu&&['ArrowUp','ArrowDown','Home','End'].includes(e.key)){
     const targets=[...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary')];const index=targets.indexOf(document.activeElement as HTMLElement);const next=e.key==='Home'?0:e.key==='End'?targets.length-1:(index+(e.key==='ArrowUp'?-1:1)+targets.length)%targets.length;targets[next]?.focus();e.preventDefault();
    }
    trapAskFocus(e.nativeEvent,ref.current!);if(e.key==='Escape'){e.stopPropagation();onClose();}}} className="flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-lg border border-rule bg-paper p-3 text-body shadow-lg lg:rounded-lg">
   <div className="flex shrink-0 items-center justify-between gap-2"><h2 className="font-serif text-heading">{title}</h2><button className="min-h-11 rounded px-3" onClick={onClose}>Close</button></div>
   <div className="min-h-0 overflow-auto">{children}</div>
  </div>
 </div>;
}
