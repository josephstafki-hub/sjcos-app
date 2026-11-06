"use client";
import { useEffect, useState } from "react";
import { GrantCard } from "./GrantCard";
import { listRunApprovals, type PendingGrant } from "@/lib/actions/dev-agents";
import { loadRunReview } from "@/lib/actions/panel-review";
import { workSummary, type RunReview as Review } from "@/lib/agent-review";
import type { AskFailureCode } from "@/lib/ask-result-codes";
import { askCall, askFailure, ASK_STATUS_COPY } from "./askStatusCopy";
export function RunReview({runId,onFailure}:{runId:string;onFailure?:(code:AskFailureCode)=>void}) {
  const [approvals,setApprovals]=useState<PendingGrant[]>([]);
  const [review,setReview]=useState<Review|null>(null);
  const [error,setError]=useState<AskFailureCode|null>(null);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let alive=true;
    setReview(null); setApprovals([]); setError(null);
    void Promise.all([askCall(listRunApprovals(runId)),askCall(loadRunReview(runId))]).then(([a,r])=>{
      if(alive) { setApprovals("grants" in a ? a.grants : a); setReview(r && "review" in r ? r.review : r); }
    }).catch(error=>{if(alive){const code=askFailure(error)?.code??"ASK_PAUSED";setReview(null);setApprovals([]);setError(code);onFailure?.(code);}});
    return ()=>{alive=false;};
    // Callback changes alone must not restart the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[runId,retry]);
  if(error)return <div role="status" className="mt-2 text-body text-ink-2">{ASK_STATUS_COPY[error]}{error==='SIGN_IN_AGAIN'?<a href="/login" className="inline-flex min-h-11 items-center px-2 text-ai-2">Sign in</a>:<button className="min-h-11 px-2 text-ai-2" onClick={()=>setRetry(n=>n+1)}>Try again</button>}</div>;
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
