'use client';
import {useState} from 'react';
import type {JobPicker} from './JobPicker';
/** Reuse the rail picker in-flow, loaded only on an explicit Job click. */
export function BrowserJobField({projectId,label,disabled,onPick}:{projectId?:string|null;label?:string|null;disabled?:boolean;onPick:(job:{id:string;label:string})=>void}){
 const [Picker,setPicker]=useState<typeof JobPicker|null>(null),[open,setOpen]=useState(false),[error,setError]=useState('');
 return <div data-browser-ui className="space-y-2"><span>Job</span><button type="button" aria-label="Choose job" aria-expanded={open} disabled={disabled} className="ml-2 min-h-12 max-w-full rounded border border-rule px-3 text-subheading" onClick={()=>{setOpen(true);void import('./JobPicker').then(m=>setPicker(()=>m.JobPicker)).catch(()=>setError("Couldn't load projects."));}}>{label??'No job'} ▾</button>{disabled&&<p>This browser keeps its current job.</p>}{open&&Picker&&<Picker inline projectOnly title="Choose Browser job" current={projectId?{kind:'project',id:projectId}:null} onDone={()=>setOpen(false)} onPick={async job=>{const {browserProject}=await import('./BrowserIdentity');const result=await browserProject(job.slug);if(result.ok&&result.project){onPick(result.project);setOpen(false);}else setError("Couldn't load this project.");}}/>}{error&&<p role="alert">{error}</p>}</div>;
}
