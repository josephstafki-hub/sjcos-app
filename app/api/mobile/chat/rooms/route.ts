import { commsRead, chatData } from "@/lib/mobile-rpc/comms-reads";
import { query } from "@/lib/db";
export async function GET(req: Request) {
 return commsRead(req,"chat",async user=>{
  const data=await chatData(user);
  const visible=[...data.channels.map(r=>({...r,kind:"channel"})),...data.rooms.map(r=>({...r,kind:"job"})),...data.directs.map(r=>({...r,kind:"direct"}))];
  const {rows}=await query<{channel_key:string;id:string;body:string;created_at:Date}>(`SELECT DISTINCT ON (channel_key) channel_key,id::text,body,created_at FROM chat_messages WHERE channel_key=ANY($1::text[]) ORDER BY channel_key,id DESC`,[visible.map(r=>r.key)]);
  const last=new Map(rows.map(r=>[r.channel_key,r]));
  return {rooms:visible.map(r=>{const m=last.get(r.key);return {id:r.key,name:r.name,kind:r.kind,label:r.kind==="job"?"Job room":r.kind==="direct"?"Direct message":"Channel",unread:r.unread??0,lastMessage:m?{id:m.id,body:m.body,time:new Date(m.created_at).toISOString()}:null,allowedActions:["chat.send","chat.read"]};})};
 });
}
