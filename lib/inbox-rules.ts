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
}
export function isAutomatedSender(email: string, category?: string, signals: AutomationSignals = {}): boolean {
  const bulkCategory = (value: string) => /^(?:CATEGORY_)?(?:promotions|updates|social|forums)$/i.test(value);
  if (bulkCategory(category ?? '') || signals.labelIds?.some(bulkCategory)) return true;
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
export function automationDetails(email: string, subject: string, snippet: string, body = ""): {kind: AutomationKind; attention?: string} {
  const text = `${subject} ${snippet} ${body}`;
  const domain = emailAddress(email).split('@')[1] ?? '';
  const money = /squareup|square\.com|stripe|intuit|quickbooks|paypal|bank|creditunion/i.test(domain);
  const kind: AutomationKind = /\breceipt\b|order confirmation/i.test(text) ? 'Receipt'
    : /e-?statement|\bstatement\b/i.test(text + ' ' + email) ? 'Statement'
    : /payment|\bdebit\b|transfer|\bbilling\b/i.test(text) || money && /capital|hold|past due/i.test(text) ? 'Payment'
    : /alert|security|COI|insurance|suspended/i.test(text) ? 'Alert'
    : /sale|discount|save on|offer|unsubscribe|promotion/i.test(text) ? 'Marketing' : 'Notification';
  // Do not turn routine success confirmations or negated warnings into demands.
  const evidence = text.replace(/\b(?:not|no longer)\s+(?:past due|on hold|suspended)\b/gi, '')
    .match(/\b(?:payment (?:has )?failed|failed payment|on hold|past due|action required|approval (?:is )?(?:needed|required)|(?:bid|estimate) (?:is )?(?:awaiting|needs?|pending) (?:your )?(?:review|approval)|(?:COI|insurance)(?: coverage| policy)? (?:is )?(?:expiring|expires|expired)|account (?:is |has been )?suspended|verify(?: (?:your )?(?:identity|account|payment|email))?)\b/i)?.[0];
  const request = text.match(/\b(?:Your order will be marked as complete automatically in \d+ days?|(?:[a-z]+ )?will be automatically completed in \d+ days?|review and (?:accept|approve)|(?:approve|respond) by [^.!?\n]{1,80}|expires on [^.!?\n]{1,80}|final notice)\b/i)?.[0];
  return {kind, attention: evidence ?? request};
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
  const text = paras.join('\n\n').replaceAll('\r', '');
  const match = /(?:^|\n)[ \t]*(?:On[ \t\u00a0]+[\s\S]{4,1000}?wrote:[ \t]*(?:\n|$)|From:[^\n]+\n(?:[^\n]*\n){0,2}[ \t]*Sent:|>|-{2,}\s*(?:Original|Forwarded) message)/im.exec(text);
  return match ? {text:text.slice(0,match.index).trimEnd(),quote:text.slice(match.index).trimStart()} : {text,quote:''};
}

export function substantiveSnippet(paras: string[], subject = ''): string {
  const text = splitQuotedText(paras).text
    .replace(/\[image:[^\]]*\]|https?:\/\/\S+|<https?:[^>]+>/gi, '')
    .replace(/^\s*(?:hi|hello|hey|dear|good morning|good afternoon)(?:[ \t]+[^,\n!]{1,50})?[,!][ \t]*(?:\n+)?/i, '');
  const sentences = text.split(/\n+|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const meaningful: string[] = [];
  for (const sentence of sentences) {
    if (/^(?:sent from my|(?:best|kind) regards|regards|sincerely|cheers)\b/i.test(sentence)) break;
    if (/^(?:thank(?:s| you)|sorry|apologies|I(?:'m| am) sorry)\b/i.test(sentence)) continue;
    if (/^[\w .'-]{1,35}$/.test(sentence) && !/[?.!]/.test(sentence) && meaningful.length) continue;
    if (/^(?:\[image|image unavailable|unsubscribe)\b/i.test(sentence)) continue;
    meaningful.push(sentence);
  }
  const ask = meaningful.find(s=>/\?|\b(?:can you|could you|please|would you|need|when|how much|estimate|quote)\b/i.test(s));
  return (ask || subject || meaningful[0] || '').slice(0,280);
}

export function conversationDraftContext(messages: {fromName?:string; outbound?:boolean; body:string[]}[], focalIndex=messages.length): {text:string; count:number} {
  // Every message predates this draft, including Joe’s answer after the latest inbound.
  const earlier=messages.filter((_,index)=>index!==focalIndex).slice(-6);
  return {count:earlier.length,text:earlier.map(m=>`${m.outbound?'Joe':m.fromName||'Sender'}: ${splitQuotedText(m.body).text.slice(0,1800)}`).join('\n\n').slice(0,12000)};
}
export function channelCommitLabel(channel:ThreadChannel):string {
  return channel==='sms'?'Send text':channel==='client_portal'?'Post to client portal':channel==='sub_portal'?'Post to sub portal':'Send email';
}
