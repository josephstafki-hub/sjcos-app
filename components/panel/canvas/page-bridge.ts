// One-shot opaque-frame handshake. Measurements only; no source or app actions.
type Measurement={height:number;overflow:boolean};
export function connectCanvasPage({frame,signal,onReady,onHeight,onBoundary,onFailure}:{frame:HTMLIFrameElement;signal:AbortSignal;onReady:()=>void;onHeight:(height:number,overflow:boolean)=>void;onBoundary:(direction:'escape'|'forward'|'backward')=>void;onFailure:()=>void}){
 let port:MessagePort|null=null,connected=false,ready=false,disposed=false,lastHeight=-Infinity,binding:{instance_id:string;nonce:string}|undefined;
 let trailing:ReturnType<typeof setTimeout>|undefined,queued:Measurement|undefined,layoutId=0;
 let printing:{id:number;resolve:(m:Measurement|null)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
 const timer=setTimeout(fail,10000),hex=/^[a-f0-9]{32}$/;
 function finishPrint(m:Measurement|null){if(!printing)return;clearTimeout(printing.timer);printing.resolve(m);printing=undefined;}
 function close(){if(disposed)return;disposed=true;clearTimeout(timer);clearTimeout(trailing);queued=undefined;finishPrint(null);port?.close();window.removeEventListener('message',receive);signal.removeEventListener('abort',close);frame.removeAttribute('src');}
 function fail(){if(disposed)return;close();onFailure();}
 function flush(){clearTimeout(trailing);trailing=undefined;if(disposed||!queued)return;const m=queued;queued=undefined;lastHeight=performance.now();onHeight(m.height,m.overflow);}
 function receive(event:MessageEvent){const m=event.data;
  if(disposed||connected||signal.aborted||event.source!==frame.contentWindow||event.origin!=='null'||!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='instance_id,nonce,type'||m.type!=='canvas-ready'||typeof m.instance_id!=='string'||typeof m.nonce!=='string'||!hex.test(m.instance_id)||!hex.test(m.nonce))return;
  connected=true;binding={instance_id:m.instance_id,nonce:m.nonce};const {instance_id,nonce}=m,channel=new MessageChannel();port=channel.port1;window.removeEventListener('message',receive);
  port.onmessage=event=>{const data=event.data;
   if(disposed||!data||typeof data!=='object'||Array.isArray(data)||data.instance_id!==instance_id||data.nonce!==nonce||data.sequence!==0)return;
   const fields:Record<string,string[]>={ready:[],height:['height','overflow'],'print-height':['height','overflow','layout_id'],focus:['focused'],escape:[],boundary:['backward'],error:['code']};
   if(!Object.hasOwn(fields,data.type)||Object.keys(data).sort().join(',')!==['type','instance_id','nonce','sequence',...fields[data.type]].sort().join(','))return;
   if(data.type==='ready'&&!ready){ready=true;clearTimeout(timer);onReady();}
   if(data.type==='height'||data.type==='print-height'){
    const height=data.height;if(typeof height!=='number'||!Number.isFinite(height)||height<0||height>8192||typeof data.overflow!=='boolean')return;
    const measurement={height,overflow:data.overflow};
    if(data.type==='print-height'){
     if(!printing||data.layout_id!==printing.id)return;
     queued=measurement;flush();finishPrint(measurement);
    }else{
     queued=measurement;const remaining=200-(performance.now()-lastHeight);
     if(remaining<=0)flush();else if(trailing===undefined)trailing=setTimeout(flush,remaining);
    }
   }
   if(data.type==='escape')onBoundary('escape');
   if(data.type==='boundary'&&typeof data.backward==='boolean')onBoundary(data.backward?'backward':'forward');
   if(data.type==='error'&&data.code==='LOAD_FAILED')fail();
  };
  port.start();frame.contentWindow!.postMessage({type:'connect',instance_id,nonce},'*',[channel.port2]);
 }
 window.addEventListener('message',receive);signal.addEventListener('abort',close,{once:true});if(signal.aborted)close();
 return {close,printLayout:(print:boolean):Promise<Measurement|null>=>{
  finishPrint(null);if(disposed||!port)return Promise.resolve(null);
  const layout_id=++layoutId;
  return new Promise(resolve=>{printing={id:layout_id,resolve,timer:setTimeout(()=>finishPrint(null),3000)};port!.postMessage({type:'print-layout',...binding,sequence:1,print,layout_id});});
 }};
}
