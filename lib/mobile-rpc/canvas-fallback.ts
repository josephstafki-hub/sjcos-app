import type {EventPage} from '@/lib/canvas-api-types';
import {groupCanvasEvents} from '@/components/panel/canvas/state';
export function mobileCanvasFallback(page?:EventPage){
 if(!page?.availability.master)return [];
 return groupCanvasEvents(page.events).flatMap(e=>['created','updated','restored','floor_latest','saved'].includes(e.kind)&&'version' in e&&e.canvas_id?[{
  group_id:e.group_id,run_id:e.run_id,canvas_id:e.canvas_id,version:e.version.version,at:e.at,
  line:`Canvas: ${e.version.title.replace(/[\r\n\u2028\u2029]/g,' ')} · Version ${e.version.version} — open it in the web app.`,
  action:{label:'Open in Safari',href:`/panel/canvas/${encodeURIComponent(e.canvas_id)}?v=${e.version.version}`},
 }]:[]);
}
export function appendCanvasLines(body:string,cards:ReturnType<typeof mobileCanvasFallback>){
 const lines=[...new Set(cards.map(c=>c.line))].filter(line=>!body.split('\n').includes(line));
 return [body,...lines].filter(Boolean).join('\n\n');
}
