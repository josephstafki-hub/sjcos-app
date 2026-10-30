"use client";
import {useRef,useState,useTransition,type ReactNode} from "react";
import {Button} from "@/components/ui";
import {runAction} from "@/lib/run-action";
import {useRouter} from "next/navigation";

/** Uncontrolled settings fields keep their normal labels; save follows the
 * owner while scrolling and only appears after a change. */
export function SettingsForm({action,children,className='',saveLabel='Save changes'}:{action:(data:FormData)=>Promise<void>;children:ReactNode;className?:string;saveLabel?:string}){
 const ref=useRef<HTMLFormElement>(null);const [dirty,setDirty]=useState(false);const [pending,start]=useTransition();const [feedback,setFeedback]=useState('');const router=useRouter();
 return <form ref={ref} onChange={()=>{setDirty(true);setFeedback('');}} onSubmit={event=>{event.preventDefault();const fd=new FormData(event.currentTarget);start(async()=>{
  await runAction(()=>action(fd), {onSuccess:()=>{setDirty(false);setFeedback('Saved');router.refresh();},onError:message=>setFeedback(message)});
 });}} className={className}>
  <fieldset disabled={pending} className="contents">{children}</fieldset>
  {feedback&&<p role="status" className="mt-3 text-body text-ink-2">{feedback}</p>}
  {dirty&&<div role="status" className="col-span-full sticky bottom-3 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-card px-4 py-3 shadow-pop">
   <span className="text-body text-ink-2">{pending?'Saving…':'Unsaved changes'}</span><div className="flex gap-2"><Button variant="ghost" disabled={pending} onClick={()=>{ref.current?.reset();setDirty(false);setFeedback('');}}>Discard</Button><Button type="submit" disabled={pending}>{pending?'Saving…':saveLabel}</Button></div>
  </div>}
 </form>;
}
