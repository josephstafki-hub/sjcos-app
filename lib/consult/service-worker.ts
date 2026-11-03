export interface PrecacheManifest {build:string;assets:{url:string;sha256:string}[]}
export async function workerMessage(worker:ServiceWorker,message:unknown,timeout=30000):Promise<{ok:boolean;code?:string;build?:string}>{
 return new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('missing_precache'));},timeout);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};worker.postMessage(message,[channel.port2]);});
}
export async function registerConsultWorker(enabled:boolean,container:ServiceWorkerContainer=navigator.serviceWorker){
 if(!enabled){const registration=await container.getRegistration('/consult/');for(const worker of [container.controller,registration?.active,registration?.waiting])if(worker)await workerMessage(worker,{type:'STOP_CACHE'});await registration?.unregister();return null;}
 return container.register('/sw.js',{scope:'/consult/',updateViaCache:'none'});
}
export async function prepareConsultShell(worker:ServiceWorker,manifest:PrecacheManifest){const result=await workerMessage(worker,{type:'PRECACHE',manifest});if(!result.ok)throw new Error(result.code??'missing_precache');return result;}
export async function verifyConsultShell(worker:ServiceWorker,manifest:PrecacheManifest){const result=await workerMessage(worker,{type:'CHECK',manifest});if(!result.ok)throw new Error(result.code??'missing_precache');return result;}
export async function activateConsultUpdate(registration:ServiceWorkerRegistration,pending:number,safelyMigrated=false){if(pending&&!safelyMigrated)return {ok:false,code:'queue_not_safe'};return registration.waiting?workerMessage(registration.waiting,{type:'ACTIVATE',safe:true}):{ok:true};}
