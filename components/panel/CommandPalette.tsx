"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { searchPanelAction } from "@/lib/actions/panel-search";
import type { PanelSearchResult } from "@/lib/panel-search";
import { NewProjectButton } from "@/components/projects/NewProjectButton";
import { NewLeadButton } from "@/components/leads/NewLeadButton";
import { writePanelState } from "./panelStore";

export const PALETTE_EVENT = "sjcos:command-palette";
export function CommandPalette() {
  const router=useRouter(); const pathname=usePathname();
  const [open,setOpen]=useState(pathname==='/cmdk');
  const [query,setQuery]=useState(''); const [results,setResults]=useState<PanelSearchResult[]>([]);
  const [allowed,setAllowed]=useState<string[]>([]); const [index,setIndex]=useState(0);
  const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null); const input=useRef<HTMLInputElement>(null);
  const lead=useRef<HTMLSpanElement>(null); const project=useRef<HTMLSpanElement>(null);
  const previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const show=()=>{setOpen(true);setQuery('');};
    const key=(e:KeyboardEvent)=>{
      if ((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k') {e.preventDefault(); if(!e.repeat)setOpen(v=>!v);}
    };
    window.addEventListener('keydown',key);window.addEventListener(PALETTE_EVENT,show);
    return ()=>{window.removeEventListener('keydown',key);window.removeEventListener(PALETTE_EVENT,show);};
  },[]);
  useEffect(()=>{
    if(open) {previous.current=document.activeElement as HTMLElement;dialog.current?.showModal();input.current?.focus();}
    else {dialog.current?.close();previous.current?.focus();}
  },[open]);
  useEffect(()=>{
    if(!open)return; let alive=true;
    void searchPanelAction('').then(r=>{if(alive)setAllowed(r.map(x=>x.href));}).catch(()=>{});
    return ()=>{alive=false;};
  },[open]);
  useEffect(()=>{
    if(!open)return;let alive=true;setLoading(true);setError('');
    const timer=setTimeout(()=>{void searchPanelAction(query.startsWith('>')?'':query).then(r=>{
      if(alive){setResults(query.startsWith('>')?[]:r);setIndex(0);setLoading(false);}
    }).catch(()=>{if(alive){setResults([]);setError('Search could not load. Change your search to try again.');setLoading(false);}});},180);
    return ()=>{alive=false;clearTimeout(timer);};
  },[open,query]);
  const actions=[
    {id:'new-chat',title:'New chat',path:'/panel'},
    {id:'new-lead',title:'New lead',path:'/leads'},
    {id:'new-project',title:'New project',path:'/projects'},
  ].filter(a=>allowed.includes(a.path)&&a.title.toLowerCase().includes(query.replace(/^>/,'').trim().toLowerCase()));
  const items=[...actions.map(a=>({...a,kind:'action',detail:'Quick action',href:a.path})),...results];
  const choose=(i:number)=>{
    const item=items[i];if(!item)return;
    setOpen(false);
    if(item.id==='new-lead')lead.current?.querySelector('button')?.click();
    else if(item.id==='new-project')project.current?.querySelector('button')?.click();
    else if(item.id==='new-chat'){writePanelState({conversationId:null,collapsed:false});window.dispatchEvent(new CustomEvent('sjcos:panel-thread',{detail:{newChat:true}}));router.push('/panel?new=1');}
    else router.push(item.href);
  };
  return <>
    {/* Existing forms retain their own server-side permission and validation. */}
    {allowed.includes('/leads')&&<span ref={lead} className="[&>button]:hidden"><NewLeadButton /></span>}
    {allowed.includes('/projects')&&<span ref={project} className="[&>button]:hidden"><NewProjectButton /></span>}
    <dialog ref={dialog} aria-label="Search pages, records and conversations" onCancel={()=>setOpen(false)} onClose={()=>setOpen(false)}
      onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}
      className="fixed inset-0 m-auto w-full max-w-xl rounded-xl border border-rule-soft bg-card p-0 text-ink shadow-modal backdrop:bg-ink/30">
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Search className="size-4 text-ink-3" />
        <input ref={input} value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search" role="combobox" aria-expanded aria-controls="command-results" aria-activedescendant={items[index]?'command-'+index:undefined}
          placeholder="Search pages, jobs, people, threads…" className="min-w-0 flex-1 bg-transparent text-body outline-none"
          onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setIndex(n=>(n+(e.key==='ArrowDown'?1:-1)+items.length)%Math.max(items.length,1));}else if(e.key==='Enter'){e.preventDefault();choose(index);}}}/>
        <button type="button" onClick={()=>setOpen(false)} aria-label="Close search" title="Close search" className="rounded p-1 hover:bg-hover"><X className="size-4"/></button>
      </div>
      <div id="command-results" role="listbox" aria-label="Search results" className="max-h-96 overflow-y-auto p-2">
        {items.map((item,i)=><button key={item.id} id={'command-'+i} role="option" aria-selected={i===index} tabIndex={-1}
          ref={el=>{if(i===index)el?.scrollIntoView({block:'nearest'});}} onMouseMove={()=>setIndex(i)} onClick={()=>choose(i)}
          className={`block w-full rounded-md px-3 py-2 text-left ${i===index?'bg-selected':'hover:bg-hover'}`}>
          <span className="block text-subheading">{item.title}</span><span className="block line-clamp-2 text-meta text-ink-3">{item.kind} · {item.detail}</span>
        </button>)}
        {loading&&<p role="status" className="p-3 text-meta text-ink-3">Searching…</p>}
        {error&&<p role="alert" className="p-3 text-body text-flag">{error}</p>}
        {!loading&&!error&&!items.length&&<p className="p-3 text-body text-ink-3">No matches. Try a job name, invoice number, or words from a chat.</p>}
      </div>
      <p className="border-t border-rule px-4 py-2 text-meta text-ink-3">↑ ↓ Choose · Enter Open · Esc Close · &gt; Actions</p>
    </dialog>
  </>;
}
