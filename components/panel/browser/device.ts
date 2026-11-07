/** Device hint only. Server control/private-view authorization is independent. */
export type BrowserDevice='phone'|'tablet-computer';
export function classifyBrowserDevice(screen:{width:number;height:number;native?:boolean}):BrowserDevice {
 return screen.native||!screen.width||!screen.height||Math.min(screen.width,screen.height)<600?'phone':'tablet-computer';
}
export function stableBrowserDevice(screen:{width:number;height:number;native?:boolean}) {const result=classifyBrowserDevice(screen);return (..._viewport:unknown[])=>result;}
let loaded:BrowserDevice|undefined;
export function browserDevice():BrowserDevice {
 if(typeof window==='undefined')return 'phone';
 return loaded??=classifyBrowserDevice({width:window.screen.width,height:window.screen.height,native:!!(window as Window & {ReactNativeWebView?:unknown}).ReactNativeWebView});
}
export const PHONE_INSTRUCTION='Take over on a tablet or computer. Open SJC OS on your iPad or computer, then Operator › Browser.';
