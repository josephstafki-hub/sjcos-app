import {canvasHumanJson} from '@/lib/ask-canvases';
import {canvasSavePolicy} from '@/lib/canvas-exports';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request,{params}:{params:Promise<{id:string;version:string}>}){return canvasHumanJson(async()=>{const p=await params;return canvasSavePolicy(p.id,Number(p.version),new URL(req.url).searchParams.get('project')??'');});}
