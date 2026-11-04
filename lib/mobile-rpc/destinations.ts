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
  if(parts[0]==="inbox" && ["texts","sms","calls","chat"].includes(u.searchParams.get("tab")??"")) {
    const tab=u.searchParams.get("tab")!;
    return {...base,type:tab==="calls"?"call":tab==="chat"?"chat":"sms",id:u.searchParams.get("id")??u.searchParams.get("thread")??u.searchParams.get("threadId")??u.searchParams.get("room"),view:base.view??tab};
  }
  if(parts[0]==="inbox")return {...base,type:"thread",id:u.searchParams.get("thread")??u.searchParams.get("threadId")??parts[1]??null,view:base.view??"inbox"};
  if(["sms","texts","messages","calls","chat"].includes(parts[0]))return {...base,type:parts[0]==="calls"?"call":parts[0]==="chat"?"chat":"sms",id:parts[1]??u.searchParams.get("thread")??u.searchParams.get("id")??u.searchParams.get("room")??u.searchParams.get("channel"),view:parts[0]};
  return {...base,type:"web"};
}
/** Only display copy is changed; no technical details or secrets are echoed. */
export function plainNotice(text:string):string {
 // Only a real config/secret leak is rewritten: an UPPER_SNAKE env name ending in
 // a secret-ish part (case-sensitive), or an explicit error phrase. Ordinary
 // summaries that happen to contain underscores or the word "text" pass through.
 const envName=/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|TOKEN|SECRET|ID|URL|NUMBER|PROFILE|PROVIDER|PASSWORD)\b/;
 const errorPhrase=/\b(?:environment variable|env var|API key|stack trace|configuration (?:error|failed))\b/i;
 if(envName.test(text)||errorPhrase.test(text))
  return /(?:^|[^a-z])(?:sms|texting|telnyx)(?:[^a-z]|$)/i.test(text)?"Texting needs attention. Ask the owner to check the phone service settings.":/(?:^|[^a-z])(?:gmail|smtp|email connection)(?:[^a-z]|$)/i.test(text)?"Email needs attention. Ask the owner to check the email connection.":"A service needs attention. Ask the owner to check its connection in Settings on the web.";
 return text.replace(/\[UNVERIFIED\]\s*/g,"")
  .replace(/Check current status on the project's Subs tab\./gi,"Check the job's Subs section.")
  .replace(/(?:\d+-day\s+)?ack by (\d{4}-\d{2}-\d{2})/gi,(_,day:string)=>`Acknowledge by ${new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"})}`);
}
export function mobileTranscript(text:string|null,callerName:string|null,ownerIsViewer:boolean,direction:"inbound"|"outbound"="inbound"):string|null {
 // Inbound records the caller leg; outbound records the owner leg (voice-flow).
 const callerChannel=direction==="inbound"?"0":"1";
 return text?.replace(/^Channel (\d+):\s*/gim,(_,channel:string)=>`${channel===callerChannel?(callerName?.trim()||"Caller"):["0","1"].includes(channel)?(ownerIsViewer?"You":"SJ Carpentry"):`Speaker ${Number(channel)+1}`}: `)??null;
}
