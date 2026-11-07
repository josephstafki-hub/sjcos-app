'use client';
import {useLayoutEffect,useRef} from 'react';
import {X} from 'lucide-react';
import type {AskPaneRegistration,AskPaneRenderContext} from './askPaneRegistry';
import {askFocusTargets} from './askPaneFocus';

export type AskContentPaneProps = AskPaneRenderContext & {
  id:string; registration:AskPaneRegistration; onExit:()=>void;
  /** Only an explicit entry moves focus; arrivals/rotation/version updates do not. */
  entrySerial:number;
};
/** Sole trusted content shell. Features provide slots, not another rail/modal.
 * Header 48, meta 20, actions 56 (landscape: feature-owned 128px right column).
 * Trusted content/frames unmount when this component leaves the selected view. */
export function AskContentPane({id,registration,onExit,entrySerial,...context}:AskContentPaneProps) {
  const root=useRef<HTMLElement>(null);
  const title=useRef<HTMLDivElement>(null);
  const stage=useRef<HTMLDivElement>(null);
  const actions=useRef<HTMLDivElement>(null);
  const seenEntry=useRef(0);
  const slots=registration.render(context);
  const {snapshot,mode,landscape,compact}=context;
  useLayoutEffect(()=>{
    if(!entrySerial||seenEntry.current===entrySerial||!root.current)return;
    seenEntry.current=entrySerial;
    if(registration.focusEntry)registration.focusEntry(root.current);
    else title.current?.querySelector<HTMLElement>('button,[tabindex]')?.focus();
  },[entrySerial,registration]);
  const exit=mode==='dock'?'Back to app':mode==='sheet'||!context.split?'‹ Chat':null;
  const closeLabel=`Close ${snapshot.kind==='workbench'?'record':snapshot.kind}`;
  const boundary=(before:boolean,from:EventTarget|null,sentinel:HTMLElement)=>{
    const inStage=from instanceof Node&&!!stage.current?.contains(from);
    const stageTargets=stage.current?askFocusTargets(stage.current):[];
    const target=!inStage?stageTargets[before?0:stageTargets.length-1]:null;
    if(target){target.focus();return;}
    const trap=root.current?.closest<HTMLElement>('[role="dialog"]')??document.body;
    const targets=askFocusTargets(trap),index=targets.indexOf(sentinel);
    const step=inStage?(before?-1:1):(before?1:-1);
    for(let offset=1;offset<=targets.length;offset++){
      const candidate=targets[(index+step*offset+targets.length)%targets.length];
      if(!candidate.hasAttribute('data-ask-boundary')){candidate.focus();return;}
    }
    root.current?.focus();
  };
  return <section ref={root} id={id} tabIndex={-1} role="region" aria-label={snapshot.kind==='workbench'?'Record':snapshot.kind==='canvas'?'Canvas':'Browser'}
    data-ask-pane={snapshot.kind} data-compact={compact} data-landscape={landscape}
    className="grid h-full min-h-0 min-w-0 overflow-hidden bg-paper text-body"
    style={{gridTemplateColumns:landscape?'minmax(0,1fr) 128px':'minmax(0,1fr)',gridTemplateRows:landscape?'48px 20px minmax(200px,1fr)':'48px 20px minmax(0,1fr) 56px'}}>
    {snapshot.kind==='browser'&&<style>{`
      [data-ask-pane="browser"]:has([data-browser-compact-capture="true"]) {grid-template-rows:44px 0px minmax(0,1fr) 44px !important}
      [data-ask-pane="browser"][data-landscape="true"]:has([data-browser-compact-capture="true"]) {grid-template-rows:44px 0px minmax(0,1fr) !important}
      [data-ask-pane="browser"]:has([data-browser-compact-capture="true"]) > [data-browser-shell-title] {height:44px}
      [data-ask-pane="browser"]:has([data-browser-compact-capture="true"]) > [data-browser-shell-title] > button {display:none}
      [data-ask-pane="browser"]:has([data-browser-compact-capture="true"]) > [data-browser-shell-meta] {visibility:hidden}
      [data-ask-host]:has([data-browser-compact-capture="true"]) > [data-horizontal-selector],
      #mobile-operator-sheet:has([data-browser-compact-capture="true"]) > [data-operator-chrome] {display:none}
    `}</style>}
    <div data-browser-shell-title className="col-start-1 row-start-1 flex h-12 min-w-0 items-center gap-1 border-b border-rule">
      {exit&&<button onClick={onExit} className="h-11 shrink-0 rounded px-2 text-body text-ai-2 focus-visible:outline-2 focus-visible:outline-focus">{exit}</button>}
      <div ref={title} className="min-w-0 flex-1 truncate text-subheading">
        {slots.title??<button className="h-11 max-w-full truncate px-2 font-serif text-heading" onClick={()=>root.current?.focus()}>{snapshot.label}</button>}
      </div>
      {!exit&&<button onClick={onExit} aria-label={closeLabel} className="flex size-11 shrink-0 items-center justify-center rounded hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-focus"><X className="size-4" /></button>}
    </div>
    <div data-browser-shell-meta className="col-start-1 row-start-2 flex h-5 min-w-0 items-center overflow-hidden px-2 text-meta text-ink-3">{slots.meta}</div>
    <div className="relative col-start-1 row-start-3 min-h-0 min-w-0 overflow-hidden">
      <span tabIndex={0} data-ask-boundary className="sr-only" aria-label="Start of pane content" onFocus={e=>boundary(true,e.relatedTarget,e.currentTarget)} />
      <div ref={stage} className="h-full min-h-0 min-w-0">{slots.content}</div>
      <span tabIndex={0} data-ask-boundary className="sr-only" aria-label="End of pane content" onFocus={e=>boundary(false,e.relatedTarget,e.currentTarget)} />
    </div>
    <div ref={actions} className={`min-h-0 min-w-0 ${landscape?'col-start-2 row-start-1 row-span-3 flex flex-col overflow-y-auto border-l':'col-start-1 row-start-4 flex h-14 items-center border-t'} border-rule [&_button]:min-h-12`}>
      {slots.actions}
    </div>
  </section>;
}
