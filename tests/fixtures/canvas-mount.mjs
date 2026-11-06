import React from 'react';
export function mounted(Component,props){
 const slots=[],pending=[];let i=0,tree;
 const state=init=>{const index=i++;if(!(index in slots))slots[index]=typeof init==='function'?init():init;return [slots[index],next=>{slots[index]=typeof next==='function'?next(slots[index]):next;}];};
 const effect=(fn,deps)=>{const [slot]=state(()=>({}));if(!slot.deps||deps.some((d,k)=>!Object.is(d,slot.deps[k]))){pending.push(()=>{slot.cleanup?.();slot.cleanup=fn();slot.deps=deps;});}};
 const hooks={useState:state,useRef:init=>state(()=>({current:init}))[0],useEffect:effect,useLayoutEffect:effect,useCallback:fn=>fn};
 return {render(){i=0;globalThis.__saveHooks=hooks;try{tree=Component(props);return tree;}finally{delete globalThis.__saveHooks;}},effects(){while(pending.length)pending.shift()();},close(){for(const slot of slots)slot?.cleanup?.();},get tree(){return tree;}};
}
export function elements(tree,predicate){if(!tree||typeof tree!=='object')return [];const children=React.Children.toArray(tree.props?.children);return [...(predicate(tree)?[tree]:[]),...children.flatMap(c=>elements(c,predicate))];}
export const text=tree=>typeof tree==='string'||typeof tree==='number'?String(tree):React.Children.toArray(tree?.props?.children).map(text).join('');
export const find=(tree,label)=>elements(tree,e=>e.type==='button'&&text(e)===label)[0];
export const settle=()=>new Promise(r=>setImmediate(r));
