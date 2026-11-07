'use client';
import {useEffect,useLayoutEffect,useState,useSyncExternalStore,type RefObject} from 'react';
export function useAskViewport() {
  const [size,setSize]=useState({width:0,height:0});
  useEffect(()=>{
    const measure=()=>setSize({width:window.innerWidth,height:window.visualViewport?.height??window.innerHeight});
    measure();window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);
    return ()=>{window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
  },[]);return size;
}
export function useAskContentWidth(ref:RefObject<HTMLElement|null>) {
  const [width,setWidth]=useState(0);
  useLayoutEffect(()=>{
    if(!ref.current)return;
    const observer=new ResizeObserver(entries=>{const entry=entries[0];if(entry)setWidth(entry.contentRect.width);});
    observer.observe(ref.current);return ()=>observer.disconnect();
  },[ref]);return width;
}

/** Sole lifetime for authenticated pane scope. Feature flags never own it. */
export function useSharedPaneScope(threadId:string|null,blocked:boolean) {
 const scope=useSyncExternalStore(subscribeAskPanes,getAskPaneFeed,getServerAskPaneFeed).scope;
 useLayoutEffect(()=>{setAskPaneScope(null);},[threadId,blocked]);
 useEffect(()=>{
  if(blocked)return;let disposed=false;let busy=false;
  const refresh=async()=>{if(disposed||busy||document.hidden)return;busy=true;try{
   const identity=await browserPaneIdentity(threadId);if(disposed)return;
   if(!identity.ok){setAskPaneScope(null);return;}
   const current=getAskPaneFeed().scope;
   if(!current||current.userId!==identity.userId||current.threadId!==(threadId??'new-chat'))setAskPaneScope({userId:identity.userId,threadId:threadId??'new-chat',claimToken:crypto.randomUUID()});
  }catch{if(!disposed)setAskPaneScope(null);}finally{busy=false;}};
  const visibility=()=>{if(document.hidden)setAskPaneScope(null);else void refresh();};
  void refresh();const timer=setInterval(refresh,5000);document.addEventListener('visibilitychange',visibility);
  return ()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);setAskPaneScope(null);};
 },[threadId,blocked]);return scope;
}
import {browserPaneIdentity} from './BrowserIdentity';
import {getAskPaneFeed,getServerAskPaneFeed,subscribeAskPanes,setAskPaneScope} from './askPaneRegistry';
