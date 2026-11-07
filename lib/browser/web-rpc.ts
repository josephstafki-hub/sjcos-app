import 'server-only';
import {connect} from 'node:net';
import {lstat} from 'node:fs/promises';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import type {z} from 'zod';
import {WebEnvelopeV1,RPCPayloads,UUID} from './phase1-contracts.mjs';
import {canonical,digest,equal,fail} from './web-transport.mjs';
import {binaryReader} from './live-view.mjs';
export type RpcMethod=keyof typeof RPCPayloads;
export type RpcPayload<M extends RpcMethod>=z.infer<(typeof RPCPayloads)[M]>;
export type RpcBinding={task_id:string|null;original_run_id:string|null;viewer_id:string|null;boot_id:string};
export type FrameBinding={task_id:string;viewer_id:string;boot_id:string;stream_id:string;stream_generation:number;context_generation:number};
export interface WebController {
 call<M extends RpcMethod>(method:M,binding:RpcBinding,payload:RpcPayload<M>):Promise<Record<string,unknown>>;
 frames(binding:FrameBinding,onFrame:(frame:unknown)=>void,onError:()=>void):Promise<()=>void>;
}
/** Parent and sockets are installation-owned; never follow symlinks. */
async function trustedSocket(path:string){
 if(!/^\/run\/sjcos-browser\/(?:control|frames)\.sock$/.test(path))fail('BROWSER_SERVICE_UNAVAILABLE');
 for(const part of ['/run','/run/sjcos-browser',path]){const s=await lstat(part);if(s.isSymbolicLink()||s.uid!==0||(s.mode&0o002)||(part===path?!s.isSocket():!s.isDirectory()))fail('BROWSER_SERVICE_UNAVAILABLE');}
}
export class UnixWebController implements WebController {
 private sequence=0;
 constructor(private requestKey:Buffer,private responseKey:Buffer,private frameKey:Buffer){if([requestKey,responseKey,frameKey].some(k=>k.length<32))fail('BROWSER_DISABLED');}
 async call<M extends RpcMethod>(method:M,binding:RpcBinding,payload:RpcPayload<M>):Promise<Record<string,unknown>>{
  const now=Date.now();RPCPayloads[method].parse(payload);UUID.parse(binding.boot_id);
  const unsigned={v:1 as const,method,...binding,command_id:randomUUID(),sequence:++this.sequence,issued_at:new Date(now).toISOString(),expires_at:new Date(now+5000).toISOString(),nonce:randomUUID(),body_digest:createHash('sha256').update(canonical(payload)).digest('hex'),payload};
  const envelope=WebEnvelopeV1.parse({...unsigned,signature:createHmac('sha256',this.requestKey).update('browser-phase1-web-rpc\0').update(canonical(unsigned)).digest('hex')});
  await trustedSocket('/run/sjcos-browser/control.sock');
  const response=await socketCall('/run/sjcos-browser/control.sock',envelope);
  const {signature,...data}=response;
  if(typeof signature!=='string'||!equal(signature,digest(this.responseKey,data))||data.command_id!==unsigned.command_id||data.boot_id!==binding.boot_id||data.sequence!==unsigned.sequence||Date.now()>Date.parse(envelope.expires_at)||typeof data.result!=='object'||data.result===null)fail('BROWSER_SERVICE_UNAVAILABLE');
  const result=data.result as Record<string,unknown>;if(result.ok!==true)fail(typeof result.code==='string'?result.code:'BROWSER_SERVICE_UNAVAILABLE');return result;
 }
 async frames(binding:FrameBinding,onFrame:(frame:unknown)=>void,onError:()=>void):Promise<()=>void>{
  await trustedSocket('/run/sjcos-browser/frames.sock');
  const socket=connect('/run/sjcos-browser/frames.sock');const issued_at=new Date().toISOString(),expires_at=new Date(Date.now()+5000).toISOString();
  const unsigned={v:1,purpose:'browser-web-frame-open',...binding,issued_at,expires_at,nonce:randomUUID()};
  const hello=Buffer.from(canonical({...unsigned,signature:digest(this.requestKey,unsigned)})),length=Buffer.alloc(4);length.writeUInt32BE(hello.length);
  socket.setTimeout(75000);socket.on('timeout',()=>socket.destroy());socket.on('error',onError);socket.on('end',onError);
  const read=binaryReader({key:this.frameKey,binding:{...binding,kind:'frame'},onFrame,onError:()=>{socket.destroy();onError();}});socket.on('data',read);
  await new Promise<void>((resolve,reject)=>{socket.once('error',reject);socket.once('connect',()=>{socket.write(Buffer.concat([length,hello]));resolve();});});
  return ()=>{socket.removeAllListeners();socket.destroy();};
 }
}
function socketCall(path:string,value:unknown):Promise<Record<string,unknown>>{
 return new Promise((resolve,reject)=>{const socket=connect(path);let data=Buffer.alloc(0),done=false;
 const finish=(error?:Error,result?:Record<string,unknown>)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(result!);};
 socket.setTimeout(2000,()=>finish(Error('BROWSER_SERVICE_UNAVAILABLE')));socket.on('error',()=>finish(Error('BROWSER_SERVICE_UNAVAILABLE')));socket.on('end',()=>{if(!done)finish(Error('BROWSER_SERVICE_UNAVAILABLE'));});
 socket.once('connect',()=>{const json=Buffer.from(canonical(value)),n=Buffer.alloc(4);n.writeUInt32BE(json.length);socket.write(Buffer.concat([n,json]));});
 socket.on('data',chunk=>{try{if(data.length+chunk.length>65540)throw Error();data=Buffer.concat([data,chunk]);if(data.length<4)return;const n=data.readUInt32BE();if(n<1||n>65536)throw Error();if(data.length<n+4)return;if(data.length!==n+4)throw Error();finish(undefined,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(4))));}catch{finish(Error('BROWSER_SERVICE_UNAVAILABLE'));}});
 });
}
