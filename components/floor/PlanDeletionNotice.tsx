'use client';
import type {FloorDeletionBlock} from '@/lib/canvas-floor';
/** Only links returned by the authorized server preflight belong here. */
export function PlanDeletionNotice({notice,onClose}:{notice:FloorDeletionBlock|null;onClose:()=>void}) {
 if(!notice)return null;
 return <div role="alert" className="relative z-20 rounded-md border border-rule bg-paper p-3 text-body">
  <p>{notice.message}</p>
  {notice.links.map(link=><p key={link.href} className="mt-2"><span>{link.title} · </span><a className="underline" href={link.href}>Open canvas</a></p>)}
  <button type="button" className="mt-2 min-h-11 rounded border border-rule px-3" onClick={onClose}>Close</button>
 </div>;
}
