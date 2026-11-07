import 'server-only';
import {connect} from 'node:net';
import {lstat} from 'node:fs/promises';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import type {z} from 'zod';
import {WebEnvelopeV1,RPCPayloads,UUID} from './phase1-contracts.mjs';
import {canonical,digest,fail,metadataBytes,verifyRpcResponse,collectMetadataPages} from './web-transport.mjs';
import {binaryReader} from './live-view.mjs';
export type RpcMethod=keyof typeof RPCPayloads;
export type RpcPayload<M extends RpcMethod>=z.infer<(typeof RPCPayloads)[M]>;
export type RpcBinding={task_id:string|null;original_run_id:string|null;viewer_id:string|null;boot_id:string};
export type FrameBinding={task_id:string;viewer_id:string;boot_id:string;stream_id:string;stream_generation:number;context_generation:number};
export type PagedRpcMethod='read_manifest'|'read_review'|'read_answers'|'read_in_use';
export type PagePayload=(page:{cursor?:string;limit:number})=>Promise<{proof_id:string;body:Record<string,unknown>}>;
export interface WebController {
 call<M extends RpcMethod>(method:M,binding:RpcBinding,payload:RpcPayload<M>):Promise<Record<string,unknown>>;
 pages?(method:PagedRpcMethod,binding:RpcBinding,nextPayload:PagePayload):Promise<{items:unknown[];next_cursor:null;revision:number}>;
 frames(binding:FrameBinding,onFrame:(frame:unknown)=>void,onError:()=>void):Promise<()=>void>;
}
/** Parent and sockets are installation-owned; never follow symlinks. */
async function trustedSocket(path:string){
 if(!/^\/run\/sjcos-browser\/(?:control|frames)\.sock$/.test(path))fail('BROWSER_SERVICE_UNAVAILABLE');
 for(const part of ['/run','/run/sjcos-browser',path]){const s=await lstat(part);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o002)||(part===path?!s.isSocket():!s.isDirectory()))fail('BROWSER_SERVICE_UNAVAILABLE');}
}
export class UnixWebController implements WebController {
 private sequence=0;
 constructor(private requestKey:Buffer,private responseKey:Buffer,private frameKey:Buffer){if([requestKey,responseKey,frameKey].some(k=>k.length!==32))fail('BROWSER_DISABLED');if(requestKey.equals(responseKey)||requestKey.equals(frameKey)||responseKey.equals(frameKey))fail('BROWSER_DISABLED');}
 async call<M extends RpcMethod>(method:M,binding:RpcBinding,payload:RpcPayload<M>):Promise<Record<string,unknown>>{
  const now=Date.now();RPCPayloads[method].parse(payload);UUID.parse(binding.boot_id);
  const unsigned={v:1 as const,method,...binding,command_id:randomUUID(),sequence:++this.sequence,issued_at:new Date(now).toISOString(),expires_at:new Date(now+5000).toISOString(),nonce:randomUUID(),body_digest:createHash('sha256').update(canonical(payload)).digest('hex'),payload};
  const envelope=WebEnvelopeV1.parse({...unsigned,signature:createHmac('sha256',this.requestKey).update('browser-phase1-web-rpc\0').update(canonical(unsigned)).digest('hex')});
  metadataBytes(envelope);
  await trustedSocket('/run/sjcos-browser/control.sock');
  const response=await socketCall('/run/sjcos-browser/control.sock',envelope);
  return verifyRpcResponse(response,envelope,this.responseKey);
 }
 async pages(method:PagedRpcMethod,binding:RpcBinding,nextPayload:PagePayload){
  // Every page needs a fresh persisted live proof, not a replay of page one's.
  return collectMetadataPages(async(page:{cursor?:string;limit:number})=>{const payload=await nextPayload(page);const result=await this.call(method,binding,{...payload,body:{...payload.body,...page}} as RpcPayload<typeof method>);const {ok,...data}=result;void ok;return data;});
 }
 async frames(binding:FrameBinding,onFrame:(frame:unknown)=>void,onError:()=>void):Promise<()=>void>{
  await trustedSocket('/run/sjcos-browser/frames.sock');
  const socket=connect('/run/sjcos-browser/frames.sock');const issued_at=new Date().toISOString(),expires_at=new Date(Date.now()+5000).toISOString();
  const unsigned={v:1,purpose:'browser-web-frame-open',...binding,issued_at,expires_at,nonce:randomUUID()};
  const hello=Buffer.from(canonical({...unsigned,signature:digest(this.requestKey,unsigned)})),length=Buffer.alloc(4);length.writeUInt32BE(hello.length);
  let ended=false;const failed=()=>{if(ended)return;ended=true;socket.destroy();onError();};
  socket.setTimeout(2000,failed);socket.on('error',failed);socket.on('end',failed);socket.on('close',failed);
  const read=binaryReader({key:this.frameKey,binding:{...binding,kind:'frame'},onFrame,onError:failed});socket.on('data',read);
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.once('close',()=>reject(Error('BROWSER_STREAM_STALE')));socket.once('connect',()=>{socket.setTimeout(75000);socket.write(Buffer.concat([length,hello]));resolve();});});
  return ()=>{ended=true;socket.removeAllListeners();socket.destroy();};
 }
}
function socketCall(path:string,value:unknown):Promise<Record<string,unknown>>{
 return new Promise((resolve,reject)=>{const socket=connect(path);let data=Buffer.alloc(0),done=false;
 const finish=(error?:Error,result?:Record<string,unknown>)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(result!);};
 socket.setTimeout(2000,()=>finish(Error('BROWSER_SERVICE_UNAVAILABLE')));socket.on('error',()=>finish(Error('BROWSER_SERVICE_UNAVAILABLE')));socket.on('end',()=>{if(!done)finish(Error('BROWSER_SERVICE_UNAVAILABLE'));});
 socket.once('connect',()=>{try{const json=metadataBytes(value),n=Buffer.alloc(4);n.writeUInt32BE(json.length);socket.write(Buffer.concat([n,json]));}catch{finish(Error('BROWSER_SERVICE_UNAVAILABLE'));}});
 socket.on('data',chunk=>{try{if(data.length+chunk.length>32772)throw Error();data=Buffer.concat([data,chunk]);if(data.length<4)return;const n=data.readUInt32BE();if(n<1||n>32768)throw Error();if(data.length<n+4)return;if(data.length!==n+4)throw Error();finish(undefined,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(4))));}catch{finish(Error('BROWSER_SERVICE_UNAVAILABLE'));}});
 });
}
