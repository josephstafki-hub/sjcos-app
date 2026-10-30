"use client";

import {useState, useTransition} from "react";
import {useRouter} from "next/navigation";
import {Button} from "@/components/ui";
import {createPlanDesign} from "@/lib/actions/plan-designs";
import {runAction} from "@/lib/run-action";

export function NewPlanButton({choices}: {choices: {slug:string;name:string;kind:"project"|"lead"}[]}) {
  const router=useRouter();
  const [target,setTarget]=useState("");
  const [name,setName]=useState("");
  const [error,setError]=useState("");
  const [pending,start]=useTransition();
  return <form className="mb-6 space-y-3 rounded-lg border border-rule-soft bg-card p-4" onSubmit={e=>{
    e.preventDefault();const choice=choices.find(c=>`${c.kind}:${c.slug}`===target);if(!choice)return;
    setError("");start(async()=>{const r=await runAction(()=>createPlanDesign({...(choice.kind==="project"?{projectSlug:choice.slug}:{leadSlug:choice.slug}),name}),{onError:setError});if(r.ok)router.push(`/floor/${r.id}`);});
  }}>
    <h2 className="text-subheading font-semibold">Create a floor plan</h2>
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-label">Project or lead
        <select required disabled={pending} value={target} onChange={e=>setTarget(e.target.value)} className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-body"><option value="">Choose a project or lead…</option>{["project","lead"].map(kind=><optgroup key={kind} label={kind==="project"?"Projects":"Leads"}>{choices.filter(c=>c.kind===kind).map(c=><option key={c.slug} value={`${c.kind}:${c.slug}`}>{c.name}</option>)}</optgroup>)}</select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-label">Design name
        <input required disabled={pending} value={name} onChange={e=>setName(e.target.value)} placeholder="Kitchen, main floor…" className="w-full rounded-md border border-rule bg-paper px-3 py-2 text-body"/>
      </label>
      <Button type="submit" disabled={pending||!target||!name.trim()}>{pending?"Creating…":"Create plan"}</Button>
    </div>
    {error&&<p role="alert" className="text-body text-flag">{error}</p>}
  </form>;
}
