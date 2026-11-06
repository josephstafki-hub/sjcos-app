// Parent half of the opaque renderer's one-shot MessageChannel. No app actions
// travel over this channel; callbacks remain in the trusted host.
type Rendered = {svg:string;width:number;height:number};
type Failure = 'LOAD_TIMEOUT'|'RENDER_TIMEOUT'|'RENDER_FAILED';
export function connectCanvasRenderer({frame,id,version,source,signal,onRendered,onHeight,onEscape,onFailure}:{
 frame:HTMLIFrameElement;id:string;version:number;source:string;signal:AbortSignal;
 onRendered:(drawing:Rendered)=>void;onHeight:(height:number)=>void;onEscape:()=>void;onFailure:(code:Failure)=>void;
}){
 let connected=false,disposed=false,done=false,requested=false,lastHeight=-Infinity;
 let port:MessagePort|null=null;
 const hex=/^[a-f0-9]{32}$/;
 const close=()=>{clearTimeout(watchdog);port?.close();port=null;frame.removeAttribute('src');window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
 const fail=(code:Failure)=>{
  if(disposed||done)return;
  done=true;disposed=true;
  // Fixed diagnostic only: never log IDs, source, SVG, parser errors or tokens.
  console.warn(code==='LOAD_TIMEOUT'?'CANVAS_HANDSHAKE_TIMEOUT':code==='RENDER_TIMEOUT'?'CANVAS_RENDER_TIMEOUT':'CANVAS_RENDER_FAILED');
  close();onFailure(code);
 };
 let watchdog=setTimeout(()=>fail('LOAD_TIMEOUT'),10000);
 const allowed:Record<string,string[]>={ready:[],height:['height','overflow'],focus:['focused'],escape:[],error:['code'],rendered:['canvas_id','version','svg','width','height']};
 function receive(event:MessageEvent){
  const m=event.data;
  if(disposed||signal.aborted||connected||event.source!==frame.contentWindow||event.origin!=='null'||!m||typeof m!=='object'||Array.isArray(m)||m.type!=='canvas-ready'||typeof m.instance_id!=='string'||!hex.test(m.instance_id)||typeof m.nonce!=='string'||!hex.test(m.nonce)||Object.keys(m).sort().join(',')!=='instance_id,nonce,type')return;
  connected=true;const {instance_id,nonce}=m;const channel=new MessageChannel();port=channel.port1;
  channel.port1.onmessage=ev=>{
   const data=ev.data,now=performance.now();
   if(disposed||signal.aborted||!data||typeof data!=='object'||Array.isArray(data)||data.instance_id!==instance_id||data.nonce!==nonce||![0,1].includes(data.sequence)||!Object.hasOwn(allowed,data.type))return;
   if(Object.keys(data).some(k=>!['type','instance_id','nonce','sequence',...allowed[data.type]].includes(k)))return;
   if(data.type==='ready'&&data.sequence===0&&!requested){requested=true;clearTimeout(watchdog);watchdog=setTimeout(()=>fail('RENDER_TIMEOUT'),3000);channel.port1.postMessage({type:'render',instance_id,nonce,sequence:1,canvas_id:id,version,source});}
   if(data.type==='escape')onEscape();
   if(data.type==='height'&&Number.isFinite(data.height)&&data.height>=0&&data.height<=8192&&typeof data.overflow==='boolean'){if(now-lastHeight<200)return;lastHeight=now;if(done)onHeight(data.height);}
   if(data.type==='error'&&data.sequence===1&&requested&&data.code==='RENDER_FAILED')fail('RENDER_FAILED');
   if(data.type==='rendered'&&!done&&requested&&data.sequence===1&&data.canvas_id===id&&data.version===version&&typeof data.svg==='string'&&new TextEncoder().encode(data.svg).length<=524288&&[data.width,data.height].every(n=>Number.isFinite(n)&&n>0&&n<=8192)){
    done=true;clearTimeout(watchdog);onRendered({svg:data.svg,width:data.width,height:data.height});
   }
  };
  channel.port1.start();frame.contentWindow!.postMessage({type:'connect',instance_id,nonce},'*',[channel.port2]);
 }
 function abort(){if(disposed)return;disposed=true;close();}
 window.addEventListener('message',receive);
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)abort();
 return abort;
}
