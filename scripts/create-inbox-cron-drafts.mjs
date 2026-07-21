#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { google } from 'googleapis';

const tokenPath = process.env.GOOGLE_TOKEN_PATH || `${process.env.HOME}/.hermes/google_token.json`;
const clientSecretPath = process.env.GOOGLE_CLIENT_SECRET_PATH || `${process.env.HOME}/.hermes/google_client_secret.json`;
const token = JSON.parse(readFileSync(tokenPath, 'utf8'));
const secret = JSON.parse(readFileSync(clientSecretPath, 'utf8'));
const cfg = secret.installed || secret.web || secret;
const auth = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, (cfg.redirect_uris || ['http://localhost:1'])[0]);
auth.setCredentials(token);
const gmail = google.gmail({ version: 'v1', auth });

function header(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}
function enc(s) { return Buffer.from(s).toString('base64url'); }
function msgRaw({to, cc, subject, body, inReplyTo, references}) {
  const lines = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${subject}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('MIME-Version: 1.0');
  lines.push('');
  lines.push(body);
  return enc(lines.join('\r\n'));
}
async function getMsg(id) {
  return (await gmail.users.messages.get({userId:'me', id, format:'metadata', metadataHeaders:['From','To','Cc','Subject','Message-ID','References']})).data;
}
async function listDrafts() {
  const drafts=[]; let pageToken;
  do {
    const r=await gmail.users.drafts.list({userId:'me', maxResults:100, pageToken});
    for (const d of r.data.drafts || []) {
      const full=(await gmail.users.drafts.get({userId:'me', id:d.id, format:'metadata', metadataHeaders:['To','Cc','Subject']})).data;
      drafts.push({draftId:d.id, messageId:full.message.id, threadId:full.message.threadId, headers:full.message.payload.headers});
    }
    pageToken=r.data.nextPageToken;
  } while(pageToken);
  return drafts;
}
const specs = [
  {
    key: 'mahowald-client-schedule-ack',
    sourceMessageId: '19f75a411e35d6f2',
    to: 'Libby Mahowald <libbyrose527@gmail.com>',
    cc: 'Tim Mahowald <timmahowald@gmail.com>',
    subject: 'Re: Mahowald layout draft',
    body: `Hi Libby and Tim,\n\nThanks for sending those openings over. I’ll coordinate with Heather and come back with a time that works for the in-person review.\n\nThanks,\nJoe`,
  },
  {
    key: 'molly-insulation-permit-ack',
    sourceMessageId: '19f721eddad0dd43',
    to: 'Heart and Soil <heartandsoil@me.com>',
    cc: '',
    subject: 'Re: Permit for Insulation, Inspector is Morgan Veiman',
    body: `Hi Molly,\n\nThanks — that makes sense. I’ll connect with Morgan Veiman and confirm what they’ll require for the opened exterior walls before we close anything back up.\n\nThanks,\nJoe`,
  }
];
const existing = await listDrafts();
const out=[];
for (const s of specs) {
  const source = await getMsg(s.sourceMessageId);
  const hs = source.payload.headers;
  const inReplyTo = header(hs, 'Message-ID');
  const priorRefs = header(hs, 'References');
  const references = [priorRefs, inReplyTo].filter(Boolean).join(' ');
  const dup = existing.find(d => d.threadId === source.threadId && header(d.headers,'Subject') === s.subject && header(d.headers,'To') === s.to);
  if (dup) { out.push({key:s.key, action:'existing', draftId:dup.draftId, messageId:dup.messageId, threadId:source.threadId, to:s.to, cc:s.cc, subject:s.subject}); continue; }
  const created = (await gmail.users.drafts.create({userId:'me', requestBody:{message:{threadId:source.threadId, raw:msgRaw({...s, inReplyTo, references})}}})).data;
  const verify = (await gmail.users.drafts.get({userId:'me', id:created.id, format:'metadata', metadataHeaders:['To','Cc','Subject']})).data;
  out.push({key:s.key, action:'created', draftId:created.id, messageId:verify.message.id, threadId:verify.message.threadId, to:header(verify.message.payload.headers,'To'), cc:header(verify.message.payload.headers,'Cc'), subject:header(verify.message.payload.headers,'Subject')});
}
console.log(JSON.stringify(out,null,2));
