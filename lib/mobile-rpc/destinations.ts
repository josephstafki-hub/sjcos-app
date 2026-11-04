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
  const tabs:Record<string,"thread"|"sms"|"call"|"chat">={email:"thread",emails:"thread",mail:"thread",thread:"thread",threads:"thread",text:"sms",texts:"sms",sms:"sms",message:"sms",messages:"sms",call:"call",calls:"call",voicemail:"call",voicemails:"call",chat:"chat",chats:"chat",room:"chat",rooms:"chat",channel:"chat",channels:"chat"};
  const tabName=(v:string|null|undefined)=>tabs[(v??"").toLowerCase().replace(/[^a-z0-9]/g,"")];
  const area=parts[0];
  if(["inbox","messages","calls","chat","sms","texts","email","emails","mail"].includes(area)) {
    const pathTab=area==="inbox"?tabName(parts[1]):undefined;
    const pathId=area==="inbox"?(pathTab?parts[2]:undefined):parts[1];
    const tab=pathTab??tabName(u.searchParams.get("tab")??u.searchParams.get("view"))??(area==="inbox"?undefined:tabName(area));
    const query=(...names:string[])=>names.map(n=>u.searchParams.get(n)?.trim()).find(Boolean)??null;
    const itemId=pathId??query("id","callId","call","smsId","roomId","room","channelId","channel","conversation");
    const thread=query("thread","threadId");
    if(tab && tab!=="thread")return {...base,type:tab,id:itemId??thread};
    const emailId=thread??(tab==="thread"?(pathId??query("id")):null)??(area==="inbox"&&!pathTab&&/^[0-9a-f]{12,}$/i.test(parts[1]??"")?parts[1]:null);
    // A generic destination lets the phone retain its own tab and view fallback.
    if(!emailId)return {...base,type:"web"};
    const view=base.view&&!tabName(base.view)?base.view:"inbox";
    return {...base,type:"thread",id:emailId,view};
  }
  return {...base,type:"web"};
}
/** Only display copy is changed; no technical details or secrets are echoed. */
const envName=/\b(?:AI_PROVIDER|ANTHROPIC_API_KEY|CRON_SECRET|DATABASE_URL|GMAIL_ACCOUNT_EMAIL|GMAIL_CLIENT_ID|GMAIL_CLIENT_SECRET|GMAIL_REDIRECT_URI|GMAIL_REFRESH_TOKEN|GMAIL_RETRY_SCALE|GMAIL_SMTP_FALLBACK|GMAIL_UNITS_PER_MINUTE|HERMES_AGENT_KEY|HERMES_AGENT_SESSION_KEY|HERMES_AGENT_URL|INTUIT_CLIENT_ID|INTUIT_CLIENT_SECRET|NEXT_PUBLIC_APP_URL|QBO_REALM_ID|SESSION_SECRET|SJC_PUBLIC_URL|SMS_API_KEY|SMS_FROM_NUMBER|SMS_HELP_AUTOREPLY|SMS_MESSAGING_PROFILE_ID|TELEGRAM_API_BASE|TELEGRAM_BOT_TOKEN|TELEGRAM_OWNER_CHAT_ID|TELNYX_API_BASE|TELNYX_API_KEY|VOICE_APPLICATION_ID|VOICE_CALL_MAX_S|VOICE_RECORDING_MAX_S|VOICE_RECORDING_NOTICE|VOICE_RING_SECONDS|VOICE_TRANSCRIPTION_ENGINE|VOICE_TTS_VOICE|VOICE_VOICEMAIL_GREETING)\b/;
const errorPhrase=/\b(?:environment variable|env var|API key|stack trace|configuration (?:error|failed))\b/i;
export function plainNotice(text:string):string {
 // Rewrite known configuration names or an explicit diagnostic phrase. Ordinary
 // summaries that happen to contain underscores or the word "text" pass through.
 if(envName.test(text)||errorPhrase.test(text))
  return /(?:^|[^a-z])(?:sms|texting|telnyx)(?:[^a-z]|$)/i.test(text)?"Texting needs attention. Ask the owner to check the phone service settings.":/(?:^|[^a-z])(?:gmail|smtp|email connection)(?:[^a-z]|$)/i.test(text)?"Email needs attention. Ask the owner to check the email connection.":"A service needs attention. Ask the owner to check its connection in Settings on the web.";
 return text.replace(/\[UNVERIFIED\]\s*/g,"")
  .replace(/Check current status on the project's Subs tab\./gi,"Check the job's Subs section.")
  .replace(/(?:\d+-day\s+)?ack by (\d{4}-\d{2}-\d{2})/gi,(_,day:string)=>`Acknowledge by ${new Date(day+"T12:00:00Z").toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric"})}`);
}
/** A notification's title and subline are judged together, so both halves
 *  name the same channel: "Texting needs attention" / "Ask the owner to…". */
export function plainNoticePair(title:string,subline:string):{title:string;subline:string}{
 const joined=`${title}. ${subline}`;
 if(!(envName.test(joined)||errorPhrase.test(joined)))return {title:plainNotice(title),subline:plainNotice(subline)};
 const [first,...rest]=plainNotice(joined).split(". ");
 return {title:first.replace(/\.$/,""),subline:rest.join(". ")};
}
/** Titles get only the short first sentence of a rewritten notice
 *  ("Texting needs attention"), never the full instruction. */
export function plainTitle(text:string):string {
 const t=plainNotice(text);
 return t===text?t:t.split(". ")[0].replace(/\.$/,"");
}
export function mobileTranscript(text:string|null,callerName:string|null,ownerIsViewer:boolean,direction:"inbound"|"outbound"="inbound"):string|null {
 // Inbound records the caller leg; outbound records the owner leg (voice-flow).
 const callerChannel=direction==="inbound"?"0":"1";
 return text?.replace(/^Channel (\d+):\s*/gim,(_,channel:string)=>`${channel===callerChannel?(callerName?.trim()||"Caller"):["0","1"].includes(channel)?(ownerIsViewer?"You":"SJ Carpentry"):`Speaker ${Number(channel)+1}`}: `)??null;
}
