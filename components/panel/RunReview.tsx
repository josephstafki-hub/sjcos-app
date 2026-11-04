"use client";
import { useEffect, useState } from "react";
import { GrantCard } from "./GrantCard";
import { listRunApprovals, type PendingGrant } from "@/lib/actions/dev-agents";
import { loadRunReview } from "@/lib/actions/panel-review";
import { workSummary, type RunReview as Review } from "@/lib/agent-review";
export function RunReview({runId}:{runId:string}) {
  const [approvals,setApprovals]=useState<PendingGrant[]>([]);
  useEffect(()=>{let alive=true;void listRunApprovals(runId).then(r=>{if(alive)setApprovals(r);}).catch(()=>{});return ()=>{alive=false;};},[runId]);
  const [review,setReview]=useState<Review|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
  useEffect(()=>{let alive=true;setError(false);void loadRunReview(runId).then(r=>{if(alive)setReview(r);}).catch(()=>{if(alive)setError(true);});return ()=>{alive=false;};},[runId,retry]);
  if(error)return <button className="mt-2 text-meta text-flag underline" onClick={()=>setRetry(n=>n+1)}>Run details could not load · Retry</button>;
  if(!review)return null;
  const steps=review.log.split('\n').filter(Boolean).length;
  const confirmed=review.changes.filter(c=>c.evidence==='Confirmed change');
  return <div className="mt-2 space-y-2 text-meta text-ink-3">
    {approvals.map(g=><GrantCard key={g.id} grant={g} onDone={()=>{}}/>)}
    <details><summary className="cursor-pointer">{workSummary(review.durationSeconds,review.toolCount,steps)} · {review.status==='error'?'Failed or stopped':'Finished'}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rule-soft p-3 font-mono text-label text-ink-2">{review.log||'No tool log was recorded.'}</pre>
    </details>
    <details><summary className="cursor-pointer">Changes · {confirmed.length} confirmed {confirmed.length===1?'entry':'entries'}{review.changes.length>confirmed.length?' · activity recorded':''}</summary>
      {!review.changes.length&&<p className="mt-2">No record changes were recorded for this run.</p>}
      <div className="mt-2 divide-y divide-rule-soft">{review.changes.map(c=><div key={c.id} className="py-2">
        <div className="text-body text-ink">{c.href?<a href={c.href} className="text-accent underline">{c.label}</a>:c.label} · {c.action}</div>
        <div>{c.evidence} · {new Date(c.at).toLocaleString()}</div>
        {c.fields.length>0?<dl className="mt-1 space-y-1">{c.fields.map(f=><div key={f.field}><dt className="font-medium">{f.field}</dt><dd className="break-words"><del>{f.before}</del> → {f.after}</dd></div>)}</dl>:<p>Before and after values were not recorded.</p>}
      </div>)}</div>
      {review.changes.some(c=>c.evidence!=='Confirmed change')&&<p>Reported activity can include attempted work. Inferred activity may include another agent’s writes.</p>}
    </details>
  </div>;
}
