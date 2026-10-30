"use client";
import {useState,useTransition} from "react";
import {Button} from "@/components/ui";
import {uploadSubDocument} from "@/lib/actions/sub-docs";
import { SUB_DOC_LABEL, type SubDocType } from "@/lib/sub-doc-types";
import {runAction} from "@/lib/run-action";

export function CoiUpload({slug, docType = "coi", initiallyOpen = false}: {slug:string; docType?:SubDocType; initiallyOpen?:boolean}) {
  const [pending,start]=useTransition();
  const [message,setMessage]=useState("");
  return <details open={initiallyOpen} className="mt-2 text-label">
    <summary className="cursor-pointer py-2 text-accent-2">Upload {SUB_DOC_LABEL[docType]}</summary>
    <form className="mt-2 space-y-2" onSubmit={e=>{
      e.preventDefault();const form=e.currentTarget;const data=new FormData(form);data.set("docType",docType);
      start(async()=>{const r=await runAction(()=>uploadSubDocument(slug,data),{onError:setMessage});if(r.ok){setMessage(docType === "coi" ? "Uploaded · awaiting review" : "Uploaded · on file");form.reset();}});
    }}>
      <label className="block">{SUB_DOC_LABEL[docType]} file<input className="mt-1 block w-full max-w-48 text-meta" name="file" type="file" accept="image/*,application/pdf" required disabled={pending}/></label>
      {docType === "coi" && <label className="block">Expiry date<input className="mt-1 block rounded-md border border-rule bg-paper p-1" name="expires" type="date" disabled={pending}/></label>}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending?"Uploading…":docType === "coi" ? "Upload for review" : "Upload document"}</Button>
      <p role="status" className="text-meta text-ink-2">{message}</p>
    </form>
  </details>;
}
