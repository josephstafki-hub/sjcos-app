/** Pure host policy. Kept free of React/DOM so both feature fixtures use it. */
export type PaneRef = { kind: 'canvas' | 'browser' | 'workbench'; id: string };
export type PaneMode = 'sheet' | 'dock' | 'popout';
export type PaneSnapshot = {
  thread_id: string; run_id: string | null; user_id: string;
  label: string; attention: 'none' | 'new' | 'needs_you'; revision: string;
} & (
  | { kind: 'canvas'; id: string; selected_version: number; latest_version: number; followLatest?: boolean }
  | { kind: 'browser'; id: string; task_id: string; status: string; stateLabel?:string; takeover: boolean }
  | { kind: 'workbench'; id: string; subject_id: string }
);
export const clampChat = (width: number, min: number, max: number) => Math.min(max, Math.max(min, width));
export function askPaneLayout({width, height, mode, selected, dockWidth = 420, chatWidth, safeArea = 0, stripWidth = 64}: {
  width: number; height: number; mode: PaneMode; selected: boolean; dockWidth?: number; chatWidth?: number | null; safeArea?: number; stripWidth?: number;
}) {
  const landscape = (mode === 'sheet' || mode === 'popout') && selected && height < 600 && width > height;
  const min = 340, max = Math.max(min, width - 492);
  const reset = clampChat(mode === 'dock' ? dockWidth : width * .42, min, max);
  const requested = chatWidth ?? (mode === 'dock' ? dockWidth : reset);
  const split = selected && !landscape && width >= 840 && (mode !== 'dock' || (requested >= min && requested <= max));
  const chat = split ? clampChat(requested, min, max) : 0;
  const strip = landscape ? Math.max(64, stripWidth) : 0;
  const pane = selected ? (split ? width - chat - 12 : width - strip) : 0;
  const compact = pane < 640 || height < 600;
  const stage = height - (mode === 'sheet' && !landscape ? 136 : 0) - 48 - 20 - (landscape ? 0 : 56) - 8 - safeArea;
  return {split, chat, gutter:split ? 12 : 0, pane, min, max, reset, compact, landscape, strip,
    actionColumn:landscape ? 128 : 0, stage, expanded:mode === 'dock' && selected,
    queueColumn:!selected && width >= 560, threadsColumn:!selected && width >= 880};
}
export function splitterKey(width: number, key: string, shift: boolean, bounds: {min: number; max: number; reset: number}) {
  const step = shift ? 64 : 16;
  const next = key === 'ArrowLeft' ? width-step : key === 'ArrowRight' ? width+step : key === 'Home' ? bounds.min : key === 'End' ? bounds.max : key === 'Enter' ? bounds.reset : width;
  return clampChat(next, bounds.min, bounds.max);
}
export const paneLayoutKey = (user: string, device: string) => `sjcos:ask-pane-layout:v1:${encodeURIComponent(user)}:${encodeURIComponent(device)}`;
type StorageLike = {getItem:(key:string)=>string|null; setItem:(key:string,value:string)=>void};
export function readPaneWidth(storage: StorageLike, user: string, device: string): number | null {
  try { const raw=storage.getItem(paneLayoutKey(user,device)); const n=raw === null ? NaN : JSON.parse(raw); return typeof n==='number' && Number.isFinite(n) && n>0 ? n : null; } catch {return null;}
}
export function writePaneWidth(storage: StorageLike, user: string, device: string, width: number) {
  try {if(Number.isFinite(width) && width>0) storage.setItem(paneLayoutKey(user,device),JSON.stringify(width));} catch { /* Private mode/quota: live layout still works. */ }
}
export type PaneState = {scope:string; selected:PaneRef|null; remembered:PaneRef|null; ownsEntry:boolean; history:'none'|'push'|'replace'|'back'; humanChoice:boolean};
export const initialPaneState = (scope:string):PaneState => ({scope,selected:null,remembered:null,ownsEntry:false,history:'none',humanChoice:false});
export type PaneAction =
 | {type:'scope';scope:string}
 | {type:'select';ref:PaneRef;mode:PaneMode;leaveAllowed?:boolean;cause?:'person'|'arrival'}
 | {type:'exit'|'close-operator';leaveAllowed?:boolean}
 | {type:'pop'|'rotate'|'human'}
 | {type:'reopen';authorized:boolean;mode:PaneMode};
export function paneTransition(state:PaneState, action:PaneAction):PaneState {
  if('leaveAllowed' in action && action.leaveAllowed===false) return state;
  if(action.type==='scope') return action.scope===state.scope ? state : initialPaneState(action.scope);
  if(action.type==='human') return {...state,humanChoice:true,history:'none'};
  if(action.type==='rotate') return {...state,history:'none'};
  if(action.type==='pop') return {...state,selected:null,ownsEntry:false,history:'none',humanChoice:true};
  if(action.type==='reopen') return action.authorized && state.remembered ? paneTransition(state,{type:'select',ref:state.remembered,mode:action.mode}) : {...state,selected:null,history:'none'};
  if(action.type==='select') return {...state,selected:{kind:action.ref.kind,id:action.ref.id},remembered:{kind:action.ref.kind,id:action.ref.id},humanChoice:action.cause!=='arrival',ownsEntry:action.mode!=='popout',history:action.mode==='popout'?'none':state.ownsEntry?'replace':'push'};
  return {...state,selected:null,remembered:action.type==='close-operator'?state.selected:state.remembered,ownsEntry:false,history:state.ownsEntry?'back':'replace',humanChoice:true};
}
export function topEscapeLayer<T extends {priority:number}>(layers:readonly T[]):T|null {
  return layers.reduce<T|null>((top,layer)=>!top||layer.priority>=top.priority?layer:top,null);
}
export function arrivalSelection({arrivals,selected,expanded,canFollow,humanChoice=false}: {
  arrivals:readonly {kind:PaneRef['kind'];id:string;attention:string;takeover?:boolean}[];
  selected:PaneRef|null;expanded:boolean;canFollow:boolean;humanChoice?:boolean;
}):PaneRef|null {
  if(humanChoice) return selected;
  if(!expanded) return selected;
  const urgent=arrivals.find(x=>x.kind==='browser'&&(x.takeover||x.attention==='needs_you'));
  if(urgent) return {kind:urgent.kind,id:urgent.id};
  if(selected) return selected;
  if(canFollow && arrivals.length===1 && arrivals[0].kind==='canvas') return {kind:'canvas',id:arrivals[0].id};
  return null;
}
export function tabKey(tabs:readonly string[], selected:string, key:string, vertical:boolean):string|null {
  if(key==='Home') return tabs[0]; if(key==='End') return tabs[tabs.length-1];
  const direction=key===(vertical?'ArrowDown':'ArrowRight')?1:key===(vertical?'ArrowUp':'ArrowLeft')?-1:0;
  return direction ? tabs[(tabs.indexOf(selected)+direction+tabs.length)%tabs.length] : null;
}
export const canvasAnnouncement=(label:string,version:number,follow:boolean)=>follow?`Canvas updated: ${label}, version ${version}`:`Version ${version} is ready.`;
export function paneUrl(href:string, ref:PaneRef|null) {
  const url=new URL(href,'https://ask.invalid');
  for(const key of ['canvas','browser','record']) url.searchParams.delete(key);
  if(ref) url.searchParams.set(ref.kind==='workbench'?'record':ref.kind,ref.id);
  return url.pathname+url.search+url.hash;
}
