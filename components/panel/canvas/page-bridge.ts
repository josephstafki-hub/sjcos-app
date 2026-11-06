// One-shot opaque-frame handshake. Measurements only; no source or app actions.
export function connectCanvasPage({frame,signal,onReady,onHeight,onBoundary,onFailure}:{frame:HTMLIFrameElement;signal:AbortSignal;onReady:()=>void;onHeight:(height:number,overflow:boolean)=>void;onBoundary:(direction:'escape'|'forward'|'backward')=>void;onFailure:()=>void}){
 let port:MessagePort|null=null,connected=false,ready=false,disposed=false,lastHeight=-Infinity,binding:{instance_id:string;nonce:string}|undefined;
 const timer=setTimeout(fail,10000),hex=/^[a-f0-9]{32}$/;
 function close(){if(disposed)return;disposed=true;clearTimeout(timer);port?.close();window.removeEventListener('message',receive);signal.removeEventListener('abort',close);frame.removeAttribute('src');}
 function fail(){if(disposed)return;close();onFailure();}
 function receive(event:MessageEvent){const m=event.data;
  if(disposed||connected||signal.aborted||event.source!==frame.contentWindow||event.origin!=='null'||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='instance_id,nonce,type'||m.type!=='canvas-ready'||typeof m.instance_id!=='string'||typeof m.nonce!=='string'||!hex.test(m.instance_id)||!hex.test(m.nonce))return;
  connected=true;binding={instance_id:m.instance_id,nonce:m.nonce};const {instance_id,nonce}=m,channel=new MessageChannel();port=channel.port1;window.removeEventListener('message',receive);
  port.onmessage=event=>{const data=event.data;
   if(disposed||!data||typeof data!=='object'||Array.isArray(data)||data.instance_id!==instance_id||data.nonce!==nonce||data.sequence!==0)return;
   const fields:Record<string,string[]>={ready:[],height:['height','overflow'],focus:['focused'],escape:[],boundary:['backward'],error:['code']};
   if(!Object.hasOwn(fields,data.type)||Object.keys(data).sort().join(',')!==['type','instance_id','nonce','sequence',...fields[data.type]].sort().join(','))return;
   if(data.type==='ready'&&!ready){ready=true;clearTimeout(timer);onReady();}
   if(data.type==='height'){const height=data.height;if(typeof height==='number'&&Number.isFinite(height)&&height>=0&&height<=8192&&typeof data.overflow==='boolean'&&performance.now()-lastHeight>=200){lastHeight=performance.now();onHeight(height,data.overflow);}}
   if(data.type==='escape')onBoundary('escape');
   if(data.type==='boundary'&&typeof data.backward==='boolean')onBoundary(data.backward?'backward':'forward');
   if(data.type==='error'&&data.code==='LOAD_FAILED')fail();
  };
  port.start();frame.contentWindow!.postMessage({type:'connect',instance_id,nonce},'*',[channel.port2]);
 }
 window.addEventListener('message',receive);signal.addEventListener('abort',close,{once:true});if(signal.aborted)close();
 return {close,printLayout:(print:boolean)=>port?.postMessage({type:'print-layout',...binding,sequence:1,print})};
}
