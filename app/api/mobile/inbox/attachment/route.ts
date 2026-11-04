import { commsRead, CommsReadError } from "@/lib/mobile-rpc/comms-reads";
import { withMailboxFor } from "@/lib/mailbox";
import { fetchInboxAttachment } from "@/lib/gmail";
export async function GET(req:Request) {
  return commsRead(req,"inbox",async user=>{
    if(!["owner","staff"].includes(user.role))throw new CommsReadError("Forbidden",403);
    const q=new URL(req.url).searchParams;
    const ids=["thread","message","attachment"].map(k=>q.get(k)??"");
    if(ids.some(id=>!/^[-\w]{1,512}$/.test(id)))throw new CommsReadError("Invalid attachment.");
    try {
      const a=await withMailboxFor(user,()=>fetchInboxAttachment(ids[0],ids[1],ids[2]));
      const inline=/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.type)&&q.get("download")!=="1";
      const name=a.name.replace(/[\r\n\x00-\x1f]/g,"").slice(0,200)||"attachment";
      return new Response(new Uint8Array(a.bytes),{headers:{"Content-Type":inline?a.type:"application/octet-stream","Content-Disposition":`${inline?"inline":"attachment"}; filename="${name.replace(/[^a-zA-Z0-9._ -]/g,"_")}"`,"Content-Length":String(a.bytes.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":inline&&a.type==="application/pdf"?"default-src 'none'; object-src 'self'":"default-src 'none'; sandbox"}});
    }catch{throw new CommsReadError("Attachment unavailable. Reopen the message and try again.",404);}
  });
}
