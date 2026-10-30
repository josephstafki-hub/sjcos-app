"use client";
import {useState,useTransition} from "react";
import {Button} from "@/components/ui";
import {uploadSubDocument} from "@/lib/actions/sub-docs";
import {runAction} from "@/lib/run-action";

export function CoiUpload({slug}: {slug:string}) {
  const [pending,start]=useTransition();
  const [message,setMessage]=useState("");
  return <details className="mt-2 text-label">
    <summary className="cursor-pointer py-2 text-accent-2">Upload COI</summary>
    <form className="mt-2 space-y-2" onSubmit={e=>{
      e.preventDefault();const form=e.currentTarget;const data=new FormData(form);data.set("docType","coi");
      start(async()=>{const r=await runAction(()=>uploadSubDocument(slug,data),{onError:setMessage});if(r.ok){setMessage("Uploaded · awaiting review");form.reset();}});
    }}>
      <label className="block">Certificate<input className="mt-1 block w-full max-w-48 text-meta" name="file" type="file" accept="image/*,application/pdf" required disabled={pending}/></label>
      <label className="block">Expiry date<input className="mt-1 block rounded-md border border-rule bg-paper p-1" name="expires" type="date" disabled={pending}/></label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending?"Uploading…":"Upload for review"}</Button>
      <p role="status" className="text-meta text-ink-2">{message}</p>
    </form>
  </details>;
}
