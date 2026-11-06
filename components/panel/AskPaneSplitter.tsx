'use client';
import {useRef} from 'react';
import {GripVertical} from 'lucide-react';
import {clampChat,splitterKey} from './askPaneLayout';
/** Separate from the ordinary dock splitter: never writes dock layout.width. */
export function AskPaneSplitter({width,min,max,reset,controls,onResize,onCommit}:{
  width:number;min:number;max:number;reset:number;controls:string;onResize:(width:number)=>void;onCommit:(width:number)=>void;
}) {
  const last=useRef(width);
  const update=(next:number)=>{last.current=clampChat(next,min,max);onResize(last.current);};
  const resetWidth=()=>{update(reset);onCommit(last.current);};
  return <div role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize Chat and pane"
    aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(width)}
    className="flex w-3 shrink-0 touch-none cursor-col-resize items-center justify-center bg-paper-2 text-ink-3 hover:bg-ai-soft focus-visible:outline-2 focus-visible:outline-focus"
    onDoubleClick={resetWidth}
    onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))return;
      event.preventDefault();update(splitterKey(width,event.key,event.shiftKey,{min,max,reset}));
    }}
    onKeyUp={event=>{if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key)){event.preventDefault();onCommit(last.current);}}}
    onPointerDown={event=>{event.preventDefault();event.currentTarget.focus();last.current=width;event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.dataset.startX=String(event.clientX);event.currentTarget.dataset.startWidth=String(width);}}
    onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))update(Number(event.currentTarget.dataset.startWidth)+event.clientX-Number(event.currentTarget.dataset.startX));}}
    onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);onCommit(last.current);}}}
    onPointerCancel={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){event.currentTarget.releasePointerCapture(event.pointerId);onCommit(last.current);}}}
  ><GripVertical className="h-12 w-3" aria-hidden="true" /></div>;
}
