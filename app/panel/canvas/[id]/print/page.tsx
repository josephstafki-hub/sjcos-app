import {notFound,redirect} from 'next/navigation';
import {PagePrint} from '@/components/panel/canvas/PagePrint';
import {canvasGet,canvasFailure} from '@/lib/ask-canvases';
export const dynamic='force-dynamic';
export default async function CanvasPrintPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{v?:string}>}){
 const {id}=await params,{v}=await searchParams;
 try{
  const data=await canvasGet(id,v?{version:Number(v)}:{});
  if(data.canvas.kind==='page'&&data.availability.pages&&data.availability.exports)return <main className="mx-auto max-w-5xl p-6 text-body"><h1 className="font-serif text-heading">{data.selected.title}</h1><p>Version {data.selected.version} · Internal draft · {data.selected.created_at.slice(0,10)}</p><p>{data.selected.summary}</p><PagePrint id={id} version={data.selected.version} title={data.selected.title}/></main>;
  // No unvalidated SVG, cross-origin print(), or modal sandbox exception. The
  // immutable static derivative and device acceptance gate arrive with 0108.
  return <main className="mx-auto max-w-3xl p-6 text-body"><h1 className="font-serif text-heading">{data.selected.title}</h1><p>Version {data.selected.version} · Internal draft</p><p>{data.selected.summary}</p><p role="status">Printing isn&apos;t available yet. Download the diagram code, or open the canvas.</p><a className="inline-flex min-h-11 items-center" href={`/panel/canvas/${id}?v=${data.selected.version}`}>Open canvas</a>{data.capabilities.code&&<a className="ml-4 inline-flex min-h-11 items-center" href={`/api/canvas/${id}/versions/${data.selected.version}/download?format=mmd`} download>Diagram code (.mmd)</a>}</main>;
 }catch(e){const f=canvasFailure(e);if(f.code==='AUTH_REQUIRED')redirect(`/login?returnTo=${encodeURIComponent(`/panel/canvas/${id}/print${v?`?v=${v}`:''}`)}`);if(f.code==='CANVAS_UNAVAILABLE'||f.code==='INVALID_INPUT')notFound();return <main role="status" className="p-6">{f.message}</main>;}
}
