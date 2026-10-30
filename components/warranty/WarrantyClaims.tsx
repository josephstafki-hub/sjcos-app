"use client";
import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Card, Chip, EmptyState } from "@/components/ui";
import { acknowledgeWarrantyClaim, resolveWarrantyClaim, reopenWarrantyClaim, editWarrantyClaim } from "@/lib/actions/warranty";
import { runAction } from "@/lib/run-action";
import type { WarrantyClaim } from "@/lib/warranty";
export function WarrantyClaims({ claims, resolved = false }: { claims: WarrantyClaim[]; resolved?: boolean }) {
  const [open,setOpen] = useState<string|null>(null);
  const [editing,setEditing] = useState<string|null>(null);
  const [issue,setIssue] = useState("");
  const [pending,start] = useTransition();
  const act = (fn:()=>Promise<{ok:boolean;error?:string}>) => start(async()=>{await runAction(fn);});
  return <Card className="overflow-hidden"><div className="border-b border-rule-soft px-4 py-3"><h2 className="font-serif text-heading">{resolved?"Resolved":"Active"} claims <span className="text-meta text-ink-3">{claims.length}</span></h2></div>
    {claims.length===0?<EmptyState compact icon={ShieldCheck} title={resolved?"No resolved claims yet":"No active claims"} description={resolved?"Claims you resolve remain here and can be reopened if work is still needed.":"Client issues appear here when reported through the portal or logged with Log a claim."} />:<div className="divide-y divide-rule-soft">{claims.map(c=><div key={c.id} data-focus={`claim-${c.id}`}><button onClick={()=>setOpen(open===c.id?null:c.id)} aria-expanded={open===c.id} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-hover"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${resolved?"bg-ok":c.dot==="flag"?"bg-flag":"bg-accent"}`} /><div className="min-w-0 flex-1"><h3 className="break-words text-subheading font-semibold">{c.project}</h3><p className="mt-0.5 text-meta text-ink-3">{c.client} · {c.age}</p><p className="mt-1 break-words text-body text-ink-2">{c.issue}</p><div className="mt-2 flex flex-wrap items-center gap-2"><Chip kind={resolved?"ok":c.acknowledged?"info":"warn"}>{resolved?"Resolved":c.acknowledged?"Acknowledged":"Awaiting reply"}</Chip>{!resolved&&c.deadline&&<span className="text-meta text-ink-3">{c.deadline}</span>}</div></div></button>
      {open===c.id&&<div className="space-y-3 bg-paper-2/50 px-4 py-3">{editing===c.id?<form onSubmit={e=>{e.preventDefault();start(async()=>{const r=await runAction(()=>editWarrantyClaim(c.id,issue));if(r.ok)setEditing(null);});}}><label className="block text-label">Issue<textarea autoFocus required className="mt-1.5 w-full rounded-md border border-rule bg-card p-3 text-body" value={issue} onChange={e=>setIssue(e.target.value)} /></label><div className="mt-2 flex justify-end gap-2"><Button variant="secondary" onClick={()=>setEditing(null)}>Cancel</Button><Button type="submit" disabled={pending}>Save issue</Button></div></form>:<div className="flex flex-wrap items-center gap-2"><Button variant="secondary" onClick={()=>{setEditing(c.id);setIssue(c.issue);}}>Edit issue</Button>{resolved?<Button disabled={pending} onClick={()=>act(()=>reopenWarrantyClaim(c.id))}>Reopen claim</Button>:<>{!c.acknowledged&&<Button variant="secondary" disabled={pending} onClick={()=>act(()=>acknowledgeWarrantyClaim(c.id))}>Acknowledge</Button>}<Button disabled={pending} onClick={()=>act(()=>resolveWarrantyClaim(c.id))}>Resolve claim</Button></>}</div>}</div>}
    </div>)}</div>}
  </Card>;
}
