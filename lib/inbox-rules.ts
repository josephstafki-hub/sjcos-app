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
