"use client";

import Link from 'next/link';
import {PostPreview} from './PostPreview';
import {useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {Copy,Check,Sparkles,Megaphone,ChevronRight} from 'lucide-react';
import {Button,Card,Chip,EmptyState,PageHeader} from '@/components/ui';
import type {MarketingDraft} from '@/lib/marketing';
import {generateDraft,updateDraft,markPosted,markDraft,deleteDraft} from '@/lib/actions/marketing';
import {runAction} from '@/lib/run-action';

const input='min-w-0 rounded-md border border-rule bg-card px-3 py-2 text-body text-ink';
export function MarketingClient({drafts,projects}:{drafts:MarketingDraft[];projects:{slug:string;name:string}[]}){
 const router=useRouter();const [slug,setSlug]=useState(projects[0]?.slug??'');const [kind,setKind]=useState('social');
 const [pending,start]=useTransition();const [error,setError]=useState('');
 return <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 @3xl/page:px-6">
  <PageHeader title="Marketing" meta={`${drafts.filter(d=>d.status==='draft').length} drafts · Review your posts, then copy and publish them yourself.`}/>
  <Card className="p-4"><h2 className="mb-3 text-subheading font-semibold">Draft from a project</h2>
   <div className="flex flex-wrap gap-2">
    <select aria-label="Project" value={slug} onChange={e=>setSlug(e.target.value)} className={`${input} w-full @3xl/page:w-auto @3xl/page:flex-1`}><option value="">Choose a project…</option>{projects.map(p=><option key={p.slug} value={p.slug}>{p.name}</option>)}</select>
    <select aria-label="Post type" value={kind} onChange={e=>setKind(e.target.value)} className={input}><option value="social">Social post</option><option value="blog">Blog post</option></select>
    <Button variant="ai" icon={Sparkles} disabled={pending||!slug} onClick={()=>{setError('');start(async()=>{const r=await runAction(()=>generateDraft(slug,kind));if(!r.ok)setError(r.error??'Could not draft.');else router.refresh();});}}>{pending?'Drafting…':'Draft a post'}</Button>
   </div>{error&&<p role="alert" className="mt-2 text-body text-flag">{error}</p>}
  </Card>
  {!drafts.length?<EmptyState icon={Megaphone} title="Your posts start here" description="Choose a project above to draft a social or blog post. Review the copy before publishing."/>:
   <div className="divide-y divide-rule-soft">{drafts.map((draft,i)=><DraftRow key={draft.id} draft={draft} initiallyOpen={i===0}/>)}</div>}
 </div>;
}
function DraftRow({draft,initiallyOpen}:{draft:MarketingDraft;initiallyOpen:boolean}){
 const router=useRouter();const [open,setOpen]=useState(initiallyOpen);const [body,setBody]=useState(draft.body);
 const [title,setTitle]=useState(draft.title);
 const [feedback,setFeedback]=useState('');
 const [pending,start]=useTransition();const [copied,setCopied]=useState(false);const dirty=body!==draft.body||title!==draft.title;
 const run=(fn:()=>Promise<{ok:boolean;error?:string}>)=>start(async()=>{const r=await runAction(fn,{onError:setFeedback});if(r.ok){setFeedback('Saved');router.refresh();}});
 return <section className="py-4">
  <div className="flex items-start gap-3"><button className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={()=>setOpen(!open)}>
    <h2 className="text-subheading font-semibold">{draft.title||draft.projectName||'Post'}</h2>
    <p className="mt-1 text-meta text-ink-3">{draft.kindLabel} · {draft.projectName} · {draft.createdLabel}</p>
   </button><ChevronRight aria-hidden="true" className={`size-4 shrink-0 text-ink-3 ${open?'rotate-90':''}`}/><Chip kind={draft.status==='posted'?'money':'ghost'}>{draft.status==='posted'?'Posted':'Draft'}</Chip>
  </div>
  {open&&<div className="mt-4 space-y-3">
   {draft.projectSlug&&<Link href={`/projects/${draft.projectSlug}`} className="text-body text-accent-2 hover:underline">Source project · {draft.projectName} →</Link>}
   <p role="status" className="text-meta text-ink-2">{pending?'Saving…':feedback||(dirty?'Unsaved changes':'Saved')}</p>
   <label className="block text-label text-ink-2">Headline<input disabled={pending} value={title} onChange={e=>{setTitle(e.target.value);setFeedback('');}} className={`${input} mt-1.5 w-full`}/></label>
   {draft.copyError&&<p role="status" className="text-body text-warn">{draft.copyError}</p>}
   <label className="block text-label text-ink-2">Post copy<textarea disabled={pending} aria-label="Post copy" value={body} onChange={e=>{setBody(e.target.value);setFeedback('');}} rows={draft.kind==='blog'?10:4} className={`${input} mt-2 w-full resize-y leading-relaxed`}/></label>
   <div className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" size="sm" icon={copied?Check:Copy} disabled={!body.trim()} onClick={async()=>{try{await navigator.clipboard.writeText(body);setCopied(true);setTimeout(()=>setCopied(false),1500);}catch{setCopied(false);}}}>{copied?'Copied':'Copy'}</Button>
    {dirty&&<><Button size="sm" disabled={pending||!body.trim()||!title.trim()} onClick={()=>run(()=>updateDraft(draft.id,body,title))}>Save edits</Button><Button variant="ghost" size="sm" disabled={pending} onClick={()=>{setBody(draft.body);setTitle(draft.title);setFeedback('');}}>Revert</Button></>}
    <Button variant="secondary" size="sm" disabled={pending||dirty||(!body.trim()&&draft.status!=='posted')} onClick={()=>run(()=>draft.status==='posted'?markDraft(draft.id):markPosted(draft.id))}>{draft.status==='posted'?'Move to drafts':'Mark posted'}</Button>
    <details className="relative ml-auto"><summary aria-label="More post actions" className="cursor-pointer rounded-md px-3 py-1 text-body hover:bg-hover">…</summary><div className="absolute right-0 z-10 rounded-lg border border-rule-soft bg-card p-1 shadow-pop"><Button variant="ghost" size="sm" className="text-flag" disabled={pending} onClick={()=>{if(confirm('Delete this draft?'))run(()=>deleteDraft(draft.id));}}>Delete draft</Button></div></details>
   </div>
   <PostPreview title={title} body={body}/>
  </div>}
 </section>;
}
