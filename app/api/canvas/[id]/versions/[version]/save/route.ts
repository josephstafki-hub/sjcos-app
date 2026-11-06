import {canvasHumanJson,canvasHumanBody,canvasSameOrigin} from '@/lib/ask-canvases';
import {canvasSave} from '@/lib/canvas-exports';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request,{params}:{params:Promise<{id:string;version:string}>}){return canvasHumanJson(async()=>{canvasSameOrigin(req);const b=await canvasHumanBody(req),p=await params;return canvasSave(p.id,Number(p.version),b);});}
