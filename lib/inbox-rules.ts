import {cleanEmailText} from './inbox-email-content.ts';
import type { ThreadChannel } from './types';

export interface ReplyMessage {
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  to?: string[];
  cc?: string[];
  outbound?: boolean;
  messageId?: string;
  references?: string;
}
export interface ReplyTarget {
  toEmail: string;
  toName: string;
  cc: string[];
  inReplyTo: string;
  references: string;
}

/** Split address lists without splitting quoted display names. */
export function splitAddresses(value: string): string[] {
  return (value.match(/(?:"[^"]*"|[^,])+/g) ?? []).map(s => s.trim()).filter(Boolean);
}
export function emailAddress(value: string): string {
  return (value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? value.trim()).toLowerCase();
}
export function validRecipient(value: string): boolean {
  return !/[\r\n]/.test(value) && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}
export function resolveReplyTarget(messages: ReplyMessage[], ownAddresses: string[]): ReplyTarget | null {
  const own = new Set(ownAddresses.map(emailAddress));
  for (const m of messages) if (m.outbound) own.add(emailAddress(m.fromEmail));
  const message = [...messages].reverse().find(m => !m.outbound && !own.has(emailAddress(m.fromEmail)));
  if (!message) return null;
  const rawTo = splitAddresses(message.replyTo ?? '')[0] || message.fromEmail;
  const toEmail = emailAddress(rawTo);
  if (!validRecipient(toEmail) || /[\r\n]/.test(rawTo)) return null;
  const toName = rawTo.includes('<') ? rawTo.slice(0,rawTo.indexOf('<')).trim().replace(/^"|"$/g,'') : message.fromName || toEmail;
  const cc = [...new Set([...(message.to ?? []),...(message.cc ?? [])].map(emailAddress))]
    .filter(address => validRecipient(address) && !own.has(address) && address !== toEmail);
  const inReplyTo = message.messageId?.match(/<[^<>\s]+>/)?.[0] ?? '';
  const references = [...new Set([...(message.references?.match(/<[^<>\s]+>/g) ?? []), ...(inReplyTo ? [inReplyTo] : [])])].join(' ');
  return {toEmail,toName,cc,inReplyTo,references};
}

export interface AutomationSignals {
  headers?: Record<string, string>;
  body?: string;
  labelIds?: string[];
  /** A reply chain (Re:/Fwd:, In-Reply-To, or Joe already wrote in the thread). */
  conversational?: boolean;
}
export function isAutomatedSender(email: string, category?: string, signals: AutomationSignals = {}): boolean {
  const bulkCategory = (value: string) => /^(?:CATEGORY_)?(?:promotions|social|forums)$/i.test(value);
  if (bulkCategory(category ?? '') || signals.labelIds?.some(bulkCategory)) return true;
  // Gmail files plenty of real people under Updates (a sub's "RE: COI request", a client's
  // cost question). Updates alone only counts when the mail isn't part of a conversation.
  const updates = (value: string) => /^(?:CATEGORY_)?updates$/i.test(value);
  if (!signals.conversational && (updates(category ?? '') || signals.labelIds?.some(updates))) return true;
  const h = Object.fromEntries(Object.entries(signals.headers ?? {}).map(([k,v]) => [k.toLowerCase(),v.trim()]));
  if (h['list-unsubscribe'] || h['list-id'] || /^(bulk|list|junk)$/i.test(h.precedence ?? '') ||
      (h['auto-submitted'] && h['auto-submitted'].toLowerCase() !== 'no')) return true;
  const address = emailAddress(email);
  const [local, domain = ''] = address.split('@');
  if (/(?:^|[._+\-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|e?statements?|alerts?|notify|billing|marketing|news|newsletter)(?:[._+\-]|$)/i.test(local)) return true;
  if (local === 'info' && /bank|creditunion|financial/i.test(domain)) return true;
  return /\bdo not reply\b|\bdon[’']t reply\b|\b(?:mailbox|inbox|email address) (?:is not|isn[’']t|not) monitored\b/i.test(signals.body ?? '');
}

/** Addresses that cannot take a reply at all. Narrower than isAutomatedSender:
 *  a bulk/Updates tag or a List-Unsubscribe header files a thread under Other,
 *  but Joe can still answer it. Only these addresses refuse a reply. */
export function isNoReplyAddress(email: string): boolean {
  const local = emailAddress(email).split('@')[0] ?? '';
  return /(?:^|[._+\-])(no[-_]?reply|do[-_]?not[-_]?reply|mailer[-_]?daemon|postmaster)(?:[._+\-]|$)/i.test(local);
}

export function latestInboundIndex(messages: {outbound?: boolean}[]): number {
  const index = messages.findLastIndex(m => !m.outbound);
  return index < 0 ? Math.max(0, messages.length - 1) : index;
}
export function composerExpanded(active: boolean, body: string): boolean {
  return active || Boolean(body.trim());
}

export function needsMeReason(input: {
  channel: ThreadChannel; inbound?: boolean; automated?: boolean; staff?: boolean;
  done?: boolean; draftReady?: boolean; unread?: boolean; audience?: string; isLead?: boolean; age?: string;
}): string | undefined {
  if (input.automated) return undefined;
  if (input.draftReady) return 'Draft ready to review';
  if (input.done || input.automated || input.staff || input.inbound === false) return undefined;
  if (input.inbound) {
    if (input.channel === 'site_form') return 'New website inquiry';
    const reason = input.channel === 'sub_portal' || input.audience === 'sub' ? 'Sub replied'
      : input.isLead ? 'Lead replied' : input.channel === 'client_portal' || input.audience === 'client' ? 'Client replied' : 'New message';
    return reason + (input.age ? ` · ${input.age}` : '');
  }
  return input.unread ? 'Unread' : undefined;
}

export function showThreadSubject(thread: {channel: ThreadChannel; subject: string; preview: string}): boolean {
  return thread.channel === 'email' || !thread.preview.trim().startsWith(thread.subject.trim());
}

/** GSM 03.38 basic + extension characters; others use UTF-16 SMS units. */
export function smsSegments(body: string): number {
  const basic = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  const extended = '^{}\\[~]|€\f';
  let units = 0;
  for (const c of body) {
    if (basic.includes(c)) units++;
    else if (extended.includes(c)) units += 2;
    else return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
  }
  return units <= 160 ? 1 : Math.ceil(units / 153);
}

export function inquiryReplySubject(scope: string, name: string): string {
  return `Re: Your inquiry — ${(scope || name).replace(/[\r\n]+/g, " ").slice(0,100)}`;
}

export type AutomationKind = 'Receipt' | 'Statement' | 'Payment' | 'Alert' | 'Marketing' | 'Notification';
/** Uses only the already-fetched envelope; no provider calls or AI. */
export function automationDetails(email: string, subject: string, snippet: string, body = "", mailbox = ""): {kind: AutomationKind; attention?: string} {
  const text = `${subject} ${snippet} ${body}`;
  const domain = emailAddress(email).split('@')[1] ?? '';
  const money = /squareup|square\.com|stripe|intuit|quickbooks|paypal|bank|creditunion/i.test(domain);
  const financing = /\b(?:MCA|pre[ -]approv(?:ed|al)|funding offer|financing offer|capital offer)\b/i.test(subject);
  const kind: AutomationKind = financing ? 'Marketing'
    : /payment (?:confirmation|received|successful|processed)|you (?:paid|sent)|paid (?:invoice|to)|received (?:a |your )?payment/i.test(subject) ? 'Payment'
    : /e-?statement|\bstatement\b/i.test(subject) ? 'Statement'
    : /\breceipt\b|order confirmation/i.test(subject) ? 'Receipt'
    : /\bpayment\b|\bpaid\b/i.test(subject) ? 'Payment'
    : /\breceipt\b|order confirmation/i.test(text) ? 'Receipt'
    : /e-?statement|\bstatement\b/i.test(text + ' ' + email) ? 'Statement'
    : /payment|\bdebit\b|transfer|\bbilling\b/i.test(text) || money && /capital|hold|past due/i.test(text) ? 'Payment'
    : /alert|security|COI|insurance|suspended/i.test(text) ? 'Alert'
    : /sale|discount|save on|offer|unsubscribe|promotion/i.test(text) ? 'Marketing' : 'Notification';
  // Do not turn routine success confirmations or negated warnings into demands.
  const evidence = text.replace(/\b(?:not|no longer)\s+(?:past due|on hold|suspended)\b/gi, '')
    .match(/\b(?:payment (?:has )?failed|failed payment|on hold|past due|action required|approval (?:is )?(?:needed|required)|(?:bid|estimate) (?:is )?(?:awaiting|needs?|pending) (?:your )?(?:review|approval)|(?:COI|insurance)(?: coverage| policy)? (?:is )?(?:expiring|expires|expired)|account (?:is |has been )?suspended|verify (?:your )?(?:identity|account|payment(?: method)?|email(?: address)?))\b/i)?.[0];
  const request = text.match(/\b(?:(?:your\s+)?(?:[a-z]+\s+)?(?:will|would)\s+be\s+(?:automatically\s+)?(?:marked\s+(?:as\s+)?)?complete[d]?(?:\s+automatically)?\s+(?:in|after|within)\s+\d+\s+(?:business\s+)?days?|review\s+and\s+(?:accept|approve)|(?:approve|respond)\s+by\s+[^.!?\n]{1,80}|expires\s+on\s+[^.!?\n]{1,80}|final\s+notice)\b/i)?.[0];
  const informationRequest = text.match(/\bcomplete (?:the |your )?information request(?: within(?: the next)? \d+ (?:business )?days?)?/i)?.[0];
  // A mention's author can be anyone. Only a request addressed to this account
  // is attention evidence; a notification about another account is not.
  const account = emailAddress(mailbox).split('@')[0];
  const github = /(?:^|\.)github\.com$/i.test(domain);
  const addressed = account && [...text.matchAll(/@([a-z0-9_.-]+)/gi)].some(m=>
    m[1].toLowerCase()===account.toLowerCase() &&
    /\b(?:please|review|approve|respond|accept|verify|complete)\b/i.test(text.slice(m.index!+m[0].length).split(/[@.!?\n]/,1)[0]));
  return {kind, attention: financing || github && !addressed ? undefined : informationRequest ?? evidence ?? request};
}
export function screeningEligible(input: {email: string; inbound: boolean; done: boolean; known: boolean; staff: boolean; automated?: boolean; ownAddresses: string[]; decision?: string}): boolean {
  return input.inbound && !input.done && !input.staff && !input.automated &&
    !input.ownAddresses.map(emailAddress).includes(emailAddress(input.email)) &&
    (input.decision === 'pending' || (!input.known && !input.decision));
}

/** Status is structured; stage_label is a free-text latest note. */
export function stageLabel(status: string): string {
  const words = status.replaceAll('_', ' ').trim();
  if (/^pre[ -]construction$/i.test(words)) return 'Pre-construction';
  if (/^intake$/i.test(words)) return 'New inquiry';
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

export function splitQuotedText(paras: string[]): {text: string; quote: string} {
  const text = cleanEmailText(paras.join('\n\n'));
  const match = /(?:^|\n)[ \t]*(?:On[ \t\u00a0]+[\s\S]{4,1000}?wrote:[ \t]*(?:\n|$)|From:[^\n]+\n(?:[^\n]*\n){0,2}[ \t]*Sent:|>|-{2,}\s*(?:Original|Forwarded) message)/im.exec(text);
  return match ? {text:text.slice(0,match.index).trimEnd(),quote:text.slice(match.index).trimStart()} : {text,quote:''};
}

export function substantiveSnippet(paras: string[], subject = ''): string {
  const text = splitQuotedText(paras).text
    .replace(/\[image:[^\]]*\]|https?:\/\/\S+|<https?:[^>]+>/gi, '')
    .replace(/^\s*(?:hi|hello|hey|dear|good morning|good afternoon)(?:[ \t]+[^,\n!]{1,50})?[,!][ \t]*(?:\n+)?/i, '');
  const sentences = text.replace(/([^.!?\n])\n(?!\n)/g, '$1 ').split(/\n+|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const meaningful: string[] = [];
  for (const sentence of sentences) {
    if (/^(?:sent from my|(?:best|kind) regards|regards|sincerely|cheers)\b/i.test(sentence)) break;
    if (/^(?:thank(?:s| you)|sorry|apologies|I(?:'m| am) sorry)\b/i.test(sentence)) {
      const ask=/\b(?:can you|could you|please|would you|when|how much)\b/i.exec(sentence);
      if(ask)meaningful.push(sentence.slice(ask.index));
      continue;
    }
    if (/^[\w .'-]{1,35}$/.test(sentence) && !/[?.!]/.test(sentence) && meaningful.length) continue;
    if (/^(?:\[image|image unavailable|unsubscribe|please visit|X[_ ]{3,})\b/i.test(sentence) || /^[_\W]+$/.test(sentence)) continue;
    if (/\b(?:don[’']t|do not|doesn[’']t|does not|no)\s+need\b|\b(?:don[’']t|do not)\s+reply\b|(?:something|anything) (?:went )?wrong with (?:the|this|your) email|\b(?:any )?questions (?:about|regarding)|\bif you have (?:any )?questions\b/i.test(sentence)) continue;
    meaningful.push(sentence);
  }
  // A question alone is weak evidence (quotes/marketing slogans often contain one).
  const strong = /\b(?:can you|could you|would you|please (?!visit|verify the accuracy)|we (?:need|want|hope|would like)|we[’']d (?:like|hope)|I (?:need|want)|estimate|quote|price|cost|\d[\d,]* (?:square feet|sq\.? ft)|review and (?:accept|approve)|payment .{0,30}received)\b/i;
  const requestIndex=meaningful.findIndex(s=>/\b(?:can you|could you|would you|please (?!visit|verify the accuracy)|we (?:need|want|hope|would like)|we[’']d (?:like|hope)|I (?:need|want))\b/i.test(s));
  const index = requestIndex>=0?requestIndex:meaningful.findIndex(s=>strong.test(s));
  if (index < 0) return (subject || '').slice(0,280);
  let ask = meaningful[index];
  // Keep the antecedent for "add that/this/it", even when the prior clause
  // itself names an estimate. Scope facts are useful next to the request.
  const refers = /\b(?:that|this|it)\b/i;
  if (index > 0 && refers.test(ask) && strong.test(meaningful[index-1])) ask = meaningful[index-1] + ' ' + ask;
  else if (meaningful[index+1] && strong.test(meaningful[index+1]) && (refers.test(ask) || refers.test(meaningful[index+1]))) ask = meaningful[index+1] + ' ' + ask;
  // Lead with measured scope rather than a long setup sentence on phone rows.
  const area=ask.match(/\b[\d,]+(?:\.\d+)? (?:square feet|sq\.? ft\.?)/i);
  if(area){const scope=SCOPE_WORDS.filter(word=>new RegExp(`\\b${word}s?\\b`,'i').test(ask)).slice(0,3);if(scope.length)return `${area[0]} · ${scope.join(' + ')}`;}
  return ask.slice(0,280);
}

/** General remodeling scope vocabulary (rooms/elements), used only to summarise a measured ask. */
const SCOPE_WORDS=['kitchen','bathroom','bedroom','basement','laundry','closet','deck','porch','garage','attic','stair','hallway','egress window','window','door','cabinet','floor'];

export function conversationDraftContext(messages: {fromName?:string; outbound?:boolean; body:string[]}[], focalIndex=messages.length): {text:string; count:number} {
  // Every message predates this draft, including Joe’s answer after the latest inbound.
  const earlier=messages.filter((_,index)=>index!==focalIndex).slice(-6);
  return {count:earlier.length,text:earlier.map(m=>`${m.outbound?'Joe':m.fromName||'Sender'}: ${splitQuotedText(m.body).text.slice(0,1800)}`).join('\n\n').slice(0,12000)};
}
export function channelCommitLabel(channel:ThreadChannel):string {
  return channel==='sms'?'Send text':channel==='client_portal'?'Post to client portal':channel==='sub_portal'?'Post to sub portal':'Send email';
}


/** Same definition for sidebar, smart-view count, split count and visible rows. */
export function threadNeedsMe(t: {filedOther?:boolean; automated?:boolean; attentionOverride?:boolean; attentionRequired?:boolean; newSender?:boolean; view?:string}, draftReady=false):boolean {
  return !t.filedOther && (!t.automated || Boolean(t.attentionOverride ?? t.attentionRequired)) &&
    (Boolean(t.automated) || !t.newSender) && (draftReady || t.view === 'needs_reply');
}
export function summaryEligible(messages:{body:string[]}[]):boolean {
  return messages.length >= 2 || messages.some(m=>splitQuotedText(m.body).text.trim().split(/\s+/).filter(Boolean).length>120);
}
/** Relative completion windows use the message's calendar date in Central. */
export function automationDeadline(evidence:string, receivedAt?:number):string|undefined {
  const match=/(?:complete[d]?|auto-completes?)(?: automatically)?\s+(?:in|after|within)\s+(\d+)\s+(business\s+)?days?/i.exec(evidence);
  if(!match || !receivedAt || !Number.isFinite(receivedAt))return undefined;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(receivedAt));
  const get=(t:string)=>parts.find(p=>p.type===t)!.value;
  const date=new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00Z`);
  let days=Number(match[1]);if(days>366)return undefined;
  while(days>0){date.setUTCDate(date.getUTCDate()+1);if(!match[2] || ![0,6].includes(date.getUTCDay()))days--;}
  return `Auto-completes ${date.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}`;
}

/** Evidence-only action cue, independent of sender, subject or provider. */
export function automatedActionLine(evidence:string,receivedAt?:number):string {
  const text=splitQuotedText([evidence]).text.replace(/\s+/g,' ');
  const action=/\b(?:complete|submit|provide|respond to|fill (?:in|out))\b.{0,70}\binformation request\b|\binformation request\b.{0,70}\b(?:complete|submit|provide|respond|fill)\b/i.test(text)?'Complete information request'
    : /\breview\b.{0,50}\border\b|\border\b.{0,50}\b(?:review|complete[d]?|auto-completes?)\b/i.test(text)?'Review order':'';
  if(!action)return '';
  const auto=automationDeadline(text,receivedAt);
  const absolute=/\bauto-completes?(?: automatically)?\s+(?:on\s+)?((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2})\b/i.exec(text);
  const relative=/\b(?:within|in|after)\s+(?:the next\s+)?(\d+)\s+(business\s+)?days?\b/i.exec(text);
  const deadline=auto?auto[0].toLowerCase()+auto.slice(1):absolute?`auto-completes ${absolute[1]}`:relative?`${relative[1]} ${relative[2]?'business ':''}days`:'';
  return [action,deadline].filter(Boolean).join(' · ');
}

// Updated only by a normal inbox load; nav polling never loads Gmail itself.
const loadedNeedsCounts=new Map<string,number>();
export function rememberNeedsCount(mailbox:string,count:number) {loadedNeedsCounts.set(mailbox.toLowerCase(),count);}
export function loadedNeedsCount(mailbox:string) {return loadedNeedsCounts.get(mailbox.toLowerCase()) ?? 0;}

/** Models sometimes open a reply with envelope lines ("To: …", "Subject: …") because
 *  staged approval drafts use that shape. The composer already shows the envelope, so a
 *  reply body never starts with them. Leading header lines and blank lines are dropped. */
export function stripDraftHeaders(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^\s*(?:to|cc|bcc|from|subject|re)\s*:/i.test(lines[i]))) i++;
  return lines.slice(i).join("\n").trim();
}
