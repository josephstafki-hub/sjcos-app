import {notFound,redirect} from 'next/navigation';
import {canvasGet,canvasFailure} from '@/lib/ask-canvases';
import {CanvasViewer} from '@/components/panel/canvas/CanvasViewer';
export const dynamic='force-dynamic';
export default async function CanvasPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{v?:string}>}){
 const {id}=await params,{v}=await searchParams;
 try{
  const data=await canvasGet(id,v?{version:Number(v)}:{});
  return <CanvasViewer initial={data}/>;
 }catch(e){const f=canvasFailure(e);if(f.code==='AUTH_REQUIRED')redirect(`/login?returnTo=${encodeURIComponent(`/panel/canvas/${id}${v?`?v=${v}`:''}`)}`);if(f.code==='CANVAS_UNAVAILABLE'||f.code==='INVALID_INPUT')notFound();return <main className="p-6" role="status">{f.message}</main>;}
}
