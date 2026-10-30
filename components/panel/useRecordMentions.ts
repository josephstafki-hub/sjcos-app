"use client";
import { useEffect, useState, type KeyboardEvent } from "react";
import { searchPanelAction } from "@/lib/actions/panel-search";
import type { PanelSearchResult } from "@/lib/panel-search";
export function useRecordMentions(prompt:string,setPrompt:(text:string)=>void) {
  const [records,setRecords]=useState<PanelSearchResult[]>([]);
  const [results,setResults]=useState<PanelSearchResult[]>([]);const [index,setIndex]=useState(0);const [error,setError]=useState('');
  const match=/(?:^|\s)@([^@\n]*)$/.exec(prompt);const query=match?.[1];
  useEffect(()=>{if(query==null){setResults([]);return;}let alive=true;setError('');
    const t=setTimeout(()=>{void searchPanelAction(query,true).then(r=>{if(alive){setResults(r);setIndex(0);}}).catch(()=>{if(alive)setError('Record search could not load. Try typing the name again.');});},180);
    return ()=>{alive=false;clearTimeout(t);};
  },[query]);
  const pick=(record:PanelSearchResult)=>{
    if(!records.some(r=>r.id===record.id))setRecords(cur=>[...cur,record].slice(0,8));
    setPrompt(prompt.replace(/@[^@\n]*$/,''));setResults([]);
  };
  const onKeyDown=(e:KeyboardEvent)=>{
    if(query==null)return false;
    if(e.key==='Escape'){e.preventDefault();setPrompt(prompt.replace(/@[^@\n]*$/,''));return true;}
    if(!results.length)return false;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(n=>(n+(e.key==='ArrowDown'?1:-1)+results.length)%results.length);return true;}
    if(e.key==='Enter'){e.preventDefault();pick(results[index]);return true;}return false;
  };
  return {records,results,index,error,open:query!=null,pick,onKeyDown,remove:(id:string)=>setRecords(r=>r.filter(x=>x.id!==id)),clear:()=>setRecords([]),refs:records.map(r=>({kind:r.kind,id:r.recordId!}))};
}
