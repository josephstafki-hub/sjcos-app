import { query } from "@/lib/db";
import { destination, plainNotice } from "@/lib/mobile-rpc/destinations";
import { mobileRead, mobileQueue } from "@/lib/mobile-rpc/reads";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return mobileRead(req, false, async user=>{
    const data=await mobileQueue(user);
    const ids=[...data.upNext,...data.waiting.items].map(i=>i.id).filter(id=>/^[0-9a-f-]{36}$/i.test(id));
    const sources=ids.length ? (await query<{id:string;thread_id:string}>(`SELECT DISTINCT ON (w.id) w.id,os.thread_id FROM work_items w JOIN obligation_sources os ON os.obligation_id=w.obligation_id WHERE w.id=ANY($1::uuid[]) AND os.provider='gmail' AND os.thread_id IS NOT NULL ORDER BY w.id,os.id DESC`,[ids])).rows : [];
    const enrich=(item:typeof data.upNext[number])=>{
      const source=sources.find(s=>s.id===item.id);
      const href=source ? `/inbox?thread=${encodeURIComponent(source.thread_id)}&view=inbox` : item.record.href??"#";
      return {...item,summary:plainNotice(item.summary),record:{...item.record,...(source?{type:"thread",id:source.thread_id,href}:{}),destination:destination(href)}};
    };
    return {...data,upNext:data.upNext.map(enrich),waiting:{...data.waiting,items:data.waiting.items.map(enrich)}};
  });
}
