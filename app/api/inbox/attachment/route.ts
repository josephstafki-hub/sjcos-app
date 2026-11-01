import {getCurrentUser, can} from '@/lib/dal';
import {withMailboxFor} from '@/lib/mailbox';
import {fetchInboxAttachment} from '@/lib/gmail';

/** Deliberate click only. Never called by list/reader rendering. */
export async function GET(request: Request) {
  const user=await getCurrentUser();
  if(!user || !can(user,'inbox') || !['owner','staff'].includes(user.role))return new Response('Forbidden',{status:403});
  const url=new URL(request.url);
  const ids=['thread','message','attachment'].map(key=>url.searchParams.get(key)??'');
  if(ids.some(id=>!id||id.length>512||!/^[-\w]+$/.test(id)))return new Response('Invalid attachment',{status:400});
  try {
    const attachment=await withMailboxFor(user,()=>fetchInboxAttachment(ids[0],ids[1],ids[2]));
    const inline=/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(attachment.type)&&url.searchParams.get('download')!=='1';
    const name=attachment.name.replace(/[\r\n\x00-\x1f]/g,'').slice(0,200)||'attachment';
    const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(attachment.bytes));controller.close();}});
    return new Response(stream,{headers:{
      'Content-Type':inline?attachment.type:'application/octet-stream',
      'Content-Disposition':`${inline?'inline':'attachment'}; filename="${name.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,
      'Content-Length':String(attachment.bytes.length),
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      // Chrome's PDF viewer refuses a sandboxed response; images and downloads keep the sandbox.
      'Content-Security-Policy':inline&&attachment.type==='application/pdf'?"default-src 'none'; object-src 'self'":"default-src 'none'; sandbox",
    }});
  }catch{return new Response('Attachment unavailable. Reopen the message and try again.',{status:404});}
}
