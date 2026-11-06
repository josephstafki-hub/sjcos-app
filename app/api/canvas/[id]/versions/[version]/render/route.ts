import {renderRoute as canvasRoute} from '@/components/panel/canvas/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string;version:string}>}){return canvasRoute(request,params);}
