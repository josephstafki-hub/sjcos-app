'use client';
import {useEffect,useLayoutEffect,useState,type RefObject} from 'react';
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
