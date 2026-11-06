import {previewRoute as canvasRoute} from '@/components/panel/canvas/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string;version:string}>}){return canvasRoute(params);}
