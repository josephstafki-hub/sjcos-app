"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { getWorkItemJobOptions, updateWorkItem } from "@/lib/actions/engine";
import { PRIORITY_LABEL } from "@/lib/engine-constants";
import type { EngineData, WorkItemView } from "@/lib/engine";
import { runAction } from "@/lib/run-action";

const input = "w-full rounded-md border border-rule bg-card px-3 py-2 text-body text-ink focus:border-accent";
export function WorkItemEditor({item,assignees,canAssign,onClose}: {
  item: WorkItemView; assignees: EngineData['assignees']; canAssign: boolean; onClose:()=>void;
}) {
  const router=useRouter(); const [pending,start]=useTransition();
  const [jobs,setJobs]=useState<{value:string;label:string}[]>([]);
  const [error,setError]=useState('');
  const currentJob=item.projectSlug ? `project:${item.projectSlug}` : item.leadSlug ? `lead:${item.leadSlug}` : '';
  useEffect(()=>{let live=true;getWorkItemJobOptions().then(xs=>{if(live)setJobs(xs);}).catch(()=>{if(live)setError('Jobs could not be loaded. Close and try again.');});return ()=>{live=false;};},[]);
  return <form aria-label="Edit work item" className="space-y-4" onSubmit={event=>{event.preventDefault();const fd=new FormData(event.currentTarget);start(async()=>{
    setError('');const r=await runAction(()=>updateWorkItem(item.id,fd));
    if(r.ok){onClose();router.refresh();}else setError(r.error ?? 'Could not save changes.');
  });}}>
    <label className="block text-label text-ink-2">Title<input name="title" required defaultValue={item.title} className={`${input} mt-1.5`}/></label>
    <label className="block text-label text-ink-2">Description<textarea name="body" rows={4} defaultValue={item.body} className={`${input} mt-1.5`}/></label>
    <div className="grid gap-4 @xl/page:grid-cols-2">
      <label className="text-label text-ink-2">Priority<select aria-label="Priority" name="priority" defaultValue={item.priority} className={`${input} mt-1.5`}>{Object.entries(PRIORITY_LABEL).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
      <label className="text-label text-ink-2">Due date<input name="due_at" type="date" defaultValue={item.dueAt?.slice(0,10)??''} className={`${input} mt-1.5`}/></label>
    </div>
    <label className="block text-label text-ink-2">Job<select aria-label="Job" name="job" defaultValue={currentJob} className={`${input} mt-1.5`}>
      <option value="">No linked job</option>
      {!jobs.some(j=>j.value===currentJob)&&currentJob&&<option value={currentJob}>{item.projectName??item.leadName}</option>}
      {jobs.map(j=><option key={j.value} value={j.value}>{j.label}</option>)}
    </select></label>
    {canAssign&&<fieldset><legend className="mb-2 text-label text-ink-2">Assignees</legend><div className="flex flex-wrap gap-3">{assignees.map((a,i)=><label key={a.userId} className="flex items-center gap-2 text-body"><input type="checkbox" name="assigned_user_ids" value={a.userId} defaultChecked={item.assignedTo.some(x=>x.userId===a.userId)||(!item.assignedTo.length&&i===0)}/>{a.name}</label>)}</div></fieldset>}
    <p className="text-meta text-ink-3">Scheduled work appears in Today on its due day, Central time.</p>
    {error&&<p role="alert" className="text-body text-flag">{error}</p>}
    <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending?'Saving…':'Save changes'}</Button><Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button></div>
  </form>;
}
