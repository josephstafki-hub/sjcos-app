'use client';

import type { ReactNode } from 'react';
import type { PaneMode, PaneRef, PaneSnapshot } from './askPaneLayout';
export type { PaneMode, PaneRef, PaneSnapshot } from './askPaneLayout';

/** A fresh, server-authorized UI claim, supplied by the future feature adapter.
 * This is display context, never server authorization or a browser capability. */
export type AskPaneScope = { userId: string; threadId: string; claimToken: string };
export type AskPaneRenderContext = {
  snapshot: PaneSnapshot; mode: PaneMode; compact: boolean; landscape: boolean;
  paneWidth: number; viewportWidth: number; split: boolean; signal: AbortSignal;
  /** Call ONLY after authenticating a trusted MessagePort boundary message. */
  frameBoundary:(frame:HTMLIFrameElement,direction:'forward'|'backward'|'escape')=>void;
};
export type AskPaneSlots = { title?: ReactNode; meta?: ReactNode; content: ReactNode; actions?: ReactNode };
export type AskPaneLeaveReason='switch'|'exit'|'operator'|'navigation'|'back';
export type AskPaneLeaveGuard=(snapshot:PaneSnapshot,reason:AskPaneLeaveReason)=>Promise<boolean>;
export type AskPaneRegistration = {
  /** Refresh authorization on host activation; publish a NEW claim after Operator closes. */
  onActivate?: () => void;
  render: (context: AskPaneRenderContext) => AskPaneSlots;
  /** Trusted heading/title button only; never the remote frame. */
  focusEntry?: (region: HTMLElement) => void;
} & (
  // Browser cannot register without its own pause/release protocol.
  | {id:'browser';beforeLeave:AskPaneLeaveGuard}
  | {id:'canvas'|'workbench';beforeLeave?:AskPaneLeaveGuard}
);
export type AskPaneFeed = {
  scope: AskPaneScope | null; snapshots: readonly PaneSnapshot[];
  registrations: readonly AskPaneRegistration[]; signal: AbortSignal;
  request: {ref:PaneRef; scope:AskPaneScope; opener:HTMLElement|null; serial:number}|null;
  /** True only for a following current run with no older-version inspection or intervening human choice. */
  canFollow: boolean; loaded:boolean;
};
const listeners=new Set<()=>void>();
let controller=new AbortController();
let feed:AskPaneFeed={scope:null,snapshots:[],registrations:[],signal:controller.signal,request:null,canFollow:false,loaded:false};
const empty=feed;
const emit=()=>listeners.forEach(fn=>fn());
export const getAskPaneFeed=()=>feed;
export const getServerAskPaneFeed=()=>empty;
export const subscribeAskPanes=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};};
export const sameAskScope=(a:AskPaneScope|null,b:AskPaneScope|null)=>!!a&&!!b&&a.userId===b.userId&&a.threadId===b.threadId&&a.claimToken===b.claimToken;
export function registerAskPane(registration:AskPaneRegistration):()=>void {
  if(registration.id==='browser'&&typeof registration.beforeLeave!=='function')throw Error('Browser requires a leave guard');
  if(feed.registrations.some(x=>x.id===registration.id)) throw Error(`Ask pane already registered: ${registration.id}`);
  feed={...feed,registrations:[...feed.registrations,registration]}; emit();
  return ()=>{feed={...feed,registrations:feed.registrations.filter(x=>x!==registration)};emit();};
}
/** Call on authenticated-person/thread/claim change, before publishing metadata.
 * Old renderers receive an aborted signal; private pixels disappear on the next
 * synchronous external-store render. Clear with null on logout/revocation. */
export function setAskPaneScope(scope:AskPaneScope|null) {
  if(sameAskScope(feed.scope,scope)) return;
  controller.abort(); controller=new AbortController();
  feed={...feed,scope,snapshots:[],signal:controller.signal,request:null,canFollow:false,loaded:false};emit();
}
/** Late responses from another claim are ignored, including same-thread old requests. */
export function publishAskPaneSnapshots(scope:AskPaneScope,snapshots:readonly PaneSnapshot[],canFollow=false):boolean {
  if(!sameAskScope(scope,feed.scope)) return false;
  feed={...feed,loaded:true,snapshots:snapshots.filter(x=>x.user_id===scope.userId&&x.thread_id===scope.threadId),canFollow};emit();return true;
}
/** Only a person's Open canvas/Open browser/Inspect control calls this. Arrivals
 * publish snapshots instead; they cannot expand a resting dock or sheet. */
export function selectAskPane(scope:AskPaneScope,ref:PaneRef,opener:HTMLElement|null=null) {
  if(!sameAskScope(scope,feed.scope)) return;
  if(!feed.snapshots.some(x=>x.kind===ref.kind&&x.id===ref.id)) return;
  feed={...feed,request:{scope,ref:{kind:ref.kind,id:ref.id},opener,serial:(feed.request?.serial??0)+1}};emit();
}
export type AskEscapeLayer = { scope:AskPaneScope; priority:number; onEscape:()=>void; element?:HTMLElement };
const layers:AskEscapeLayer[]=[];
/** H3 priorities: menu 600; feature sheet 500; review 400; leave confirm 300.
 * Nested confirms use owner priority + 1. Cleanup MUST run on close/unmount. */
export function registerAskPaneOverlay(layer:AskEscapeLayer) {
  layers.push(layer);return ()=>{const i=layers.indexOf(layer);if(i>=0) layers.splice(i,1);};
}
export const askPaneOverlays=(scope:AskPaneScope|null)=>layers.filter(x=>sameAskScope(x.scope,scope));

// Tab-local IDs only. Fresh metadata must authorize every restore.
export type AskPaneMemory=PaneRef & {selected_version?:number;followLatest?:boolean};
const remembered=new Map<string,AskPaneMemory>();
const memoryKey=(scope:AskPaneScope)=>JSON.stringify([scope.userId,scope.threadId]);
export function rememberAskPane(scope:AskPaneScope,ref:PaneRef|PaneSnapshot|null) {
  if(!ref){remembered.delete(memoryKey(scope));return;}
  const memory:AskPaneMemory={kind:ref.kind,id:ref.id};
  if(ref.kind==='canvas'&&'selected_version' in ref){memory.selected_version=ref.selected_version;memory.followLatest=ref.followLatest!==false;}
  remembered.set(memoryKey(scope),memory);
}
/** Feature onActivate adapters read version/followLatest here before publishing
 * fresh authorized snapshots. No label/source/frames/control material is kept. */
export function recalledAskPane(scope:AskPaneScope) {return remembered.get(memoryKey(scope))??null;}
