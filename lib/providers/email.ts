// Email provider (Gmail API through lib/gmail.ts sendNewEmail).
//
// Payload is JSON-safe: attachments are references (a files row id or an
// uploads storage path) that the transport resolves to bytes at send time —
// the intent row never carries a PDF. Reconciliation searches the account's
// Sent mail for the exact recipient + subject after the attempt started:
// Gmail gives us no idempotency key, so "did it go out?" is answered from
// the provider's own record, never guessed.
//
// Requested change (status file): lib/gmail.ts sendNewEmail returns void, so
// the Gmail message id cannot be recorded; a `headers`/return-id extension
// there would let us stamp X-SJC-Op and reconcile by rfc822msgid.

import { classifyTransportError, NotTransmittedError, outboundDisabled, recordFakeSend, type Provider, type ProviderContext, type ProviderResult, type ReconcileOutcome } from "./types.ts";

export interface EmailAttachmentRef {
  filename: string;
  mimeType: string;
  /** files.id — resolved through files.storage_path. */
  fileId?: string | null;
  /** Direct path under uploads/ (already validated by the stager). */
  storagePath?: string | null;
}

export interface EmailPayload {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  attachments?: EmailAttachmentRef[];
  [k: string]: unknown;
}

export interface EmailTransportMessage {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: { filename: string; mimeType: string; content: Buffer }[];
}

export interface EmailTransport {
  configured(): boolean;
  send(msg: EmailTransportMessage): Promise<{ id?: string | null }>;
  /** Sent-mail lookup for reconciliation: newest matching outbound message after `sinceMs`. */
  findSent?(q: { to: string; subject: string; sinceMs: number }): Promise<{ id: string; date: number } | null>;
  /** Resolve an attachment reference to bytes; throws NotTransmittedError when missing. */
  loadAttachment?(ref: EmailAttachmentRef): Promise<Buffer>;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function makeEmailProvider(transport: EmailTransport = defaultTransport): Provider<EmailPayload> {
  return {
    name: "email",
    async send(payload, ctx): Promise<ProviderResult> {
      const to = String(payload.to ?? "").trim();
      if (!EMAIL_RE.test(to)) return { responseClass: "permanent", error: `"${to || "(empty)"}" is not a valid email address.`, transmitted: false };
      if (!String(payload.bodyText ?? "").trim() && !payload.bodyHtml) return { responseClass: "permanent", error: "Email body is empty.", transmitted: false };
      if (outboundDisabled()) return recordFakeSend("email", payload, ctx);
      if (!transport.configured()) return { responseClass: "permanent", error: "Gmail is not connected.", transmitted: false };
      let attachments: EmailTransportMessage["attachments"];
      try {
        attachments = await loadAttachments(transport, payload.attachments ?? []);
      } catch (err) {
        return { responseClass: "permanent", error: (err as Error).message, transmitted: false };
      }
      try {
        const out = await transport.send({ to, subject: payload.subject ?? "", bodyText: payload.bodyText ?? "", bodyHtml: payload.bodyHtml ?? undefined, attachments });
        return { responseClass: "accepted", providerRef: out?.id ?? null, providerState: "sent", transmitted: true };
      } catch (err) {
        return classifyTransportError(err);
      }
    },
    async reconcile(intent): Promise<ReconcileOutcome> {
      if (outboundDisabled()) return { state: "unknown", note: "outbound disabled; nothing to reconcile against" };
      if (!transport.findSent) return { state: "unknown", note: "transport cannot search sent mail" };
      const since = intent.attemptedAt ? new Date(intent.attemptedAt).getTime() - 5 * 60_000 : Date.now() - 24 * 3600_000;
      try {
        const hit = await transport.findSent({ to: intent.payload.to, subject: intent.payload.subject ?? "", sinceMs: since });
        if (hit) return { state: "confirmed", providerRef: hit.id, providerState: "sent", note: "found in Sent mail" };
        // Gmail's Sent view is consistent within minutes. Only after a clear
        // window do we call the absence proof enough to try again.
        const ageMs = intent.attemptedAt ? Date.now() - new Date(intent.attemptedAt).getTime() : 0;
        if (ageMs > 15 * 60_000) return { state: "pending", note: "not in Sent mail 15 minutes after the attempt; safe to retry" };
        return { state: "unknown", note: "not in Sent mail yet; checking again later" };
      } catch (err) {
        return { state: "unknown", note: `sent-mail lookup failed: ${(err as Error).message}` };
      }
    },
  };
}

async function loadAttachments(transport: EmailTransport, refs: EmailAttachmentRef[]): Promise<EmailTransportMessage["attachments"]> {
  if (!refs.length) return undefined;
  if (!transport.loadAttachment) throw new NotTransmittedError("This transport cannot load attachments.", true);
  const out: { filename: string; mimeType: string; content: Buffer }[] = [];
  for (const ref of refs) out.push({ filename: ref.filename, mimeType: ref.mimeType || "application/octet-stream", content: await transport.loadAttachment(ref) });
  return out;
}

/** Real transport: lib/gmail.ts + uploads on disk. Loaded lazily so the pure
 *  module (and node --test) never touches Next-only code. */
const defaultTransport: EmailTransport = {
  configured() {
    // Evaluated lazily inside send(); before that, assume configured so the
    // real check happens with the module loaded.
    return true;
  },
  async send(msg) {
    const gmail = await import("../gmail");
    if (!gmail.gmailConfigured()) throw new NotTransmittedError("Gmail is not connected.", true);
    await gmail.sendNewEmail({ to: msg.to, subject: msg.subject, bodyText: msg.bodyText, bodyHtml: msg.bodyHtml, attachments: msg.attachments });
    return { id: null };
  },
  async findSent(q) {
    const gmail = await import("../gmail");
    if (!gmail.gmailConfigured()) return null;
    const subject = q.subject.replace(/"/g, "").slice(0, 120);
    const rows = await gmail.fetchThreadMetadata({ max: 10, since: q.sinceMs, q: `in:sent to:${q.to}${subject ? ` subject:"${subject}"` : ""}` });
    const hit = rows.find((r) => r.outbound && r.toLine.toLowerCase().includes(q.to.toLowerCase()));
    return hit ? { id: hit.id, date: hit.date } : null;
  },
  async loadAttachment(ref) {
    const [{ readFile }, path, { UPLOAD_DIR }] = await Promise.all([import("node:fs/promises"), import("node:path"), import("../uploads")]);
    let storagePath = ref.storagePath ?? null;
    if (!storagePath && ref.fileId) {
      const { queryOne } = await import("../db");
      const row = await queryOne<{ storage_path: string | null }>(`SELECT storage_path FROM files WHERE id = $1`, [ref.fileId]);
      storagePath = row?.storage_path ?? null;
    }
    if (!storagePath) throw new NotTransmittedError(`Attachment "${ref.filename}" has no stored file.`, true);
    try {
      return await readFile(path.join(UPLOAD_DIR, storagePath));
    } catch {
      throw new NotTransmittedError(`Attachment "${ref.filename}" is missing from storage.`, true);
    }
  },
};
