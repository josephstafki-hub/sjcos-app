export interface MobileDestination {
  type:"project"|"lead"|"sub"|"vendor"|"thread"|"sms"|"call"|"chat"|"approval"|"web";
  id:string|null; slug:string|null; section:string|null; focus:string|null; view:string|null; key:string|null; href:string;
}
export function destination(href:string,ref?:string|null):MobileDestination {
  const u=new URL(href,"http://mobile.local"); const parts=u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const base={id:null,slug:null,focus:u.searchParams.get("focus"),section:u.searchParams.get("section")??u.searchParams.get("tab"),view:u.searchParams.get("view"),key:null,href};
  if(ref&&/^(decision|work_item|grant):/.test(ref))return {...base,type:"approval",key:ref};
  const records={projects:"project",leads:"lead",subs:"sub",vendors:"vendor"} as const;
  if(parts[0] in records)return {...base,type:records[parts[0] as keyof typeof records],slug:parts[1]??null,id:parts[1]??null};
  if(parts[0]==="inbox")return {...base,type:"thread",id:u.searchParams.get("thread")??u.searchParams.get("threadId")??parts[1]??null,view:base.view??"inbox"};
  if(["sms","texts","messages","calls","chat"].includes(parts[0]))return {...base,type:parts[0]==="calls"?"call":parts[0]==="chat"?"chat":"sms",id:parts[1]??u.searchParams.get("thread")??u.searchParams.get("id")??u.searchParams.get("room")??u.searchParams.get("channel"),view:parts[0]};
  return {...base,type:"web"};
}
export const plainNotice=(text:string)=> /missing.*(?:SMS_|TELNYX_)|SMS_.*missing/i.test(text) ? "Texting isn't set up yet. Open Settings on the web." : text.replace(/\[UNVERIFIED\]\s*/g,"");
