import type {EventPage} from '@/lib/canvas-api-types';
import {groupCanvasEvents} from '@/components/panel/canvas/state';
type Fallback={group_id:string;run_id:string|null;canvas_id:string|null;version:number|null;at:string;line:string;action:{label:string;href:string}|null};
export function mobileCanvasFallback(page?:EventPage){
 if(!page?.availability.master)return [];
 return groupCanvasEvents(page.events).flatMap<Fallback>(e=>e.kind==='rejected'&&['too big','not supported','not allowed'].includes(e.reason)?[{group_id:e.group_id,run_id:e.run_id,canvas_id:null,version:null,at:e.at,line:`Canvas could not be created (${e.reason}). Continue with a plain-text explanation in this chat.`,action:null}]:['created','updated','restored','floor_latest','saved'].includes(e.kind)&&'version' in e&&e.canvas_id?[{
  group_id:e.group_id,run_id:e.run_id,canvas_id:e.canvas_id,version:e.version.version,at:e.at,
  line:`Canvas: ${e.version.title.replace(/[\r\n\u2028\u2029]/g,' ')} · Version ${e.version.version} — open it in the web app.`,
  action:{label:'Open in Safari',href:`/panel/canvas/${encodeURIComponent(e.canvas_id)}?v=${e.version.version}`},
 }]:[]);
}
export function appendCanvasLines(body:string,cards:ReturnType<typeof mobileCanvasFallback>){
 const lines=[...new Set(cards.map(c=>c.line))].filter(line=>!body.split('\n').includes(line));
 return [body,...lines].filter(Boolean).join('\n\n');
}
