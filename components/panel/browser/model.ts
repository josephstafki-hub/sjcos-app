export type BrowserState='off'|'unsupported'|'empty'|'queued'|'queue_full'|'queue_expired'|'offer'|'offer_expired'|'starting'|'loading'|'working'|'taking_over'|'controlling'|'other_device'|'done'|'paused_private'|'paused'|'read_review'|'resource_review'|'write_blocked'|'final_blocked'|'pause_failed'|'disconnected'|'reconnected'|'absent'|'turn_ended'|'owner_paused'|'idle_closed'|'crashed'|'latched'|'auth_expired'|'access_removed'|'closed'|'unknown'|'service_unavailable';
export type BrowserDialog='takeover'|'fresh'|'leave'|'sites'|'pause_owner'|'replace'|'menu'|null;
export type BrowserModel={state:BrowserState;origin:string;phone:boolean;ownerName:string;personName:string;projectLabel?:string|null;width:number;landscape?:boolean;privatePage?:boolean;privateConsented?:boolean;ownerView?:boolean;ownerPaused?:boolean;watchingOwner?:boolean;frameUrl?:string;livePaused?:boolean;capture?:boolean;compactCapture?:boolean;zoom?:boolean;dialog?:BrowserDialog;queuePosition?:number|null;idleSeconds?:number;sites?:string[];areas?:string[];readUrls?:string[];readExpired?:boolean;busy?:boolean;error?:string;destination?:string;windowCount?:number;answers?:{id:string;revision:number;label:string;value:string;source_message_id:string}[];inUse?:{task_id:string;person_label:string;task_kind:string;project_label:string|null;state:string;revision:number}[];isOwner?:boolean;ownConfirmSuppressed?:boolean;hasTask?:boolean;addressReady?:boolean};
export const browserCopy:Record<BrowserState,string>={
 off:"Browser isn't available yet.",unsupported:'Browser works with Claude in this version.',empty:'Open a website with the agent. You can watch and take over.',queued:"Browser is busy. You're number 2 in line.",queue_full:'Browser is busy and the line is full. Try again in a few minutes.',queue_expired:'You left the line after 5 minutes.',offer:'Browser is ready. Open within 30 seconds.',offer_expired:'You missed your turn.',starting:'Opening browser…',loading:'Loading city.example…',working:'Agent is working',taking_over:'Finishing the last step…',controlling:"You're in control. The agent is paused.",other_device:"You're in control on your other device.",done:"The agent can't read this page anymore.",paused_private:"Paused. The agent can't read this page.",paused:'Browser is paused.',read_review:'Read this page?',resource_review:'This page needs these files',write_blocked:'This version can only read pages. This button sends information to the site.',final_blocked:'This version stops here. Nothing was submitted.',pause_failed:"Couldn't pause the browser. Keep this screen open, or stop the browser.",disconnected:'Connection lost. Browser paused.',reconnected:'Connected. Review the page before continuing.',absent:'You left the browser. The agent paused.',turn_ended:'Agent turn finished. Browser is paused.',owner_paused:'Joe paused the agent.',idle_closed:'Browser closed after 5 minutes without activity.',crashed:'Browser stopped. Check the site before repeating a final step.',latched:'Browser stopped because the server is busy. Your saved files are safe.',auth_expired:'Sign in again to continue.',access_removed:'Your access changed. Browser stopped.',closed:'Browser closed.',unknown:'The site may have received it. Check the site before trying again.',service_unavailable:"Couldn't connect to the browser."};
export const blankBrowserStates=new Set<BrowserState>(['off','empty','unsupported','queued','queue_full','queue_expired','offer','offer_expired','starting','disconnected','idle_closed','crashed','latched','auth_expired','access_removed','closed']);
export function browserStatus(m:BrowserModel){
 if(['final_blocked','write_blocked','read_review','resource_review','unknown','crashed','latched','auth_expired','access_removed','closed','idle_closed'].includes(m.state))return m.state==='write_blocked'&&m.phone?"This version reads public pages only. Sending information isn't available yet.":browserCopy[m.state];
 if(m.ownerPaused)return `Agent paused. ${m.personName} can tap Continue.`;
 if(m.ownerView&&m.privatePage)return m.privateConsented?`Private — only you and ${m.personName} see this page.`:`${m.personName} took over. The agent can't see this page.`;
 if(m.state==='queued')return `Browser is busy. You're number ${m.queuePosition??2} in line.`;
 if(m.state==='owner_paused')return `${m.ownerName} paused the agent.`;
 if(m.state==='loading')return `Loading ${m.origin}…`;
 if(m.state==='write_blocked'&&m.phone)return "This version reads public pages only. Sending information isn't available yet.";
 return browserCopy[m.state];
}
export function afterBrowserControl(m:BrowserModel,action:string):BrowserModel {
 if(action==='done')return {...m,state:'done',capture:false,privatePage:true};
 if(action==='keep_paused')return {...m,state:'paused_private',capture:false,privatePage:true};
 return m;
}
export function browserModel(input:{task:{private?:boolean;control?:string;state?:string};hasControl:boolean}):Pick<BrowserModel,'state'|'privatePage'> {
 const {task,hasControl}=input;
 const state:BrowserState=task.state==='closed'?'closed':task.state==='failed'?'crashed':task.state==='queued'?'queued':task.state==='starting'?'starting':task.control==='person'?hasControl?'controlling':'other_device':task.private?'paused_private':task.state==='paused'?'paused':'working';
 return {state,privatePage:task.private};
}
/** Coordinates relative to contain/letterboxing. Local zoom is never remote input. */
export function letterboxPoint(rect:{left:number;top:number;width:number;height:number},x:number,y:number) {
 const scale=Math.min(rect.width/1280,rect.height/800);if(scale<=0)return null;
 const px=(x-rect.left-(rect.width-1280*scale)/2)/scale,py=(y-rect.top-(rect.height-800*scale)/2)/scale;
 return px>=0&&py>=0&&px<1280&&py<800?{x:px,y:py}:null;
}
