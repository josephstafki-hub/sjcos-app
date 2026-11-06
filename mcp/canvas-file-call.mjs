import {createPrivateBridgeContext} from '../lib/ask-private-transport.mjs';
/** Construct once next to canvasCall; never accepts HTTP ALS principalPayload. */
export function createCanvasFileCall({transportKind,env=process.env,httpActive=()=>false,internalCall}){
 const captured=createPrivateBridgeContext({transportKind,env,httpActive});
 const denied={ok:false,code:'CANVAS_UNAVAILABLE'};
 return async(action,input)=>{
 const ctx=captured();if(!ctx)return denied;
 const {conversation_id,...context}=ctx;
 try{
 const admission=await internalCall('/api/internal/canvas',{action:'admit',input:{conversation_id},context});
 if(!admission?.ok)return denied;
 return await internalCall('/api/internal/canvas-files',{action,input,context});
 }catch{return denied;}
 };
}
