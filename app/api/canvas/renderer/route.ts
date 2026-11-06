import {authorizeRenderer,canvasRoute,rendererDocument} from '@/components/panel/canvas/server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(){return canvasRoute(async()=>{await authorizeRenderer();const document=await rendererDocument();return new Response(document.html,{headers:{...document.headers,Vary:'Cookie, Authorization'}});});}
