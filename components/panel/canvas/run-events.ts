import type {EventPage} from '@/lib/canvas-api-types';
/** Initial has_more describes older history. Always check the forward high-water
 * once, then drain forward pages even after the runner has stopped. */
export async function drainCanvasPages(initial:EventPage,read:(after:string)=>Promise<EventPage>,apply:(page:EventPage)=>void,alive:()=>boolean){
 let page=initial;
 if(!alive())return;
 apply(page);
 while(alive()){
  const after=page.cursor;
  page=await read(after);
  if(!alive())return;
  apply(page);
  if(!page.has_more)return;
  if(page.cursor===after)throw Error('Canvas cursor did not advance');
 }
}
