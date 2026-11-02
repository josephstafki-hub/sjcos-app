// Opt-in send backstop: hand a finished message to Gmail's own mail server
// (smtp.gmail.com, OAuth "XOAUTH2" login) when the Gmail API refuses a send
// for quota. SMTP submissions don't draw on the API's per-minute units, Gmail
// still files the message under Sent, and replies stay in their conversation
// through the In-Reply-To / References headers the message already carries.
//
// Off unless GMAIL_SMTP_FALLBACK=1, because SMTP needs the full-mailbox scope
// (https://mail.google.com/) — the mailbox has to be reconnected once with it.
// Without the scope Google answers the login with an error and the caller
// simply keeps waiting on the API instead.
//
// Plain node:tls, no dependency. Implements just enough of RFC 5321 to submit
// one message: EHLO, AUTH XOAUTH2, MAIL/RCPT/DATA, QUIT.

import tls from "node:tls";
import { randomBytes } from "node:crypto";
import { emailAddress, splitAddresses } from "./inbox-rules";

export const SMTP_SCOPE = "https://mail.google.com/";

export function smtpFallbackEnabled(): boolean {
  return process.env.GMAIL_SMTP_FALLBACK === "1";
}

/** The login was permanently refused (usually: the token lacks the
 *  full-mailbox scope). Nothing was sent. */
export class SmtpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpAuthError";
  }
}
/** Any other SMTP failure. `mayHaveSent` is true only when the connection
 *  failed after the whole message was handed over but before the server
 *  confirmed it — the one moment the message may already be on its way. */
export class SmtpError extends Error {
  readonly code: number;
  readonly mayHaveSent: boolean;
  constructor(code: number, message: string, mayHaveSent = false) {
    super(message);
    this.name = "SmtpError";
    this.code = code;
    this.mayHaveSent = mayHaveSent;
  }
}

/** Minimal duplex the client talks over (a TLS socket in production). */
export interface SmtpSocket {
  write(data: string): void;
  on(event: "data", cb: (chunk: Buffer | string) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: () => void): void;
  end(): void;
  destroy(): void;
}
export type SmtpConnect = () => Promise<SmtpSocket>;

const defaultConnect: SmtpConnect = () =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host: "smtp.gmail.com", port: 465, servername: "smtp.gmail.com" }, () => resolve(socket));
    socket.once("error", reject);
    socket.setTimeout(20_000, () => socket.destroy(new Error("Could not reach Gmail's mail server.")));
  });

/** Where smtpSend connects (swapped for a scripted fake in tests). */
export const smtpTransport: { connect: SmtpConnect } = { connect: defaultConnect };

function headerBlock(mime: string): string {
  return mime.split(/\r?\n\r?\n/, 1)[0];
}

/** The envelope recipients (To + Cc + Bcc) from the header block. Folded
 *  header lines are unfolded first. */
export function mimeRecipients(mime: string): string[] {
  const head = headerBlock(mime).replace(/\r?\n[ \t]+/g, " ");
  const out = new Set<string>();
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^(to|cc|bcc):\s*(.*)$/i);
    if (!m) continue;
    for (const part of splitAddresses(m[2])) {
      const addr = emailAddress(part).trim().toLowerCase();
      if (addr) out.add(addr);
    }
  }
  return [...out];
}

/** SMTP caps a line at 998 octets. The API takes any length, so a message
 *  with longer lines (one-line newsletter HTML) stays on the API path. */
export function smtpSafe(mime: string): boolean {
  return mime.split(/\r?\n/).every((line) => Buffer.byteLength(line) <= 998);
}

/** Give a message the headers the API would have added itself, and drop any
 *  Bcc header (Bcc recipients ride in the envelope only). Returns the message
 *  and the Message-ID it now carries (to find its thread afterwards). */
export function prepareSmtpMime(mime: string, from: string, domainHint = "sjcos.local"): { mime: string; messageId: string } {
  const split = mime.search(/\r?\n\r?\n/);
  const rawHead = split < 0 ? mime : mime.slice(0, split);
  const rest = split < 0 ? "" : mime.slice(split);
  // Unfold-aware Bcc removal: the header line plus its continuation lines.
  const head = rawHead.replace(/^Bcc:.*(?:\r?\n[ \t].*)*(?:\r?\n|$)/gim, "").replace(/\r?\n$/, "");
  const has = (name: string) => new RegExp(`^${name}:`, "im").test(head);
  const domain = from.split("@")[1] || domainHint;
  const existing = head.match(/^Message-ID:\s*(<[^>]+>)/im)?.[1];
  const messageId = existing ?? `<sjcos.${Date.now().toString(36)}.${randomBytes(6).toString("hex")}@${domain}>`;
  const extra = [
    ...(has("From") ? [] : [`From: ${from}`]),
    ...(has("Date") ? [] : [`Date: ${new Date().toUTCString().replace("GMT", "+0000")}`]),
    ...(existing ? [] : [`Message-ID: ${messageId}`]),
  ];
  return { mime: `${[...extra, head].join("\r\n")}${rest}`, messageId };
}

/** CRLF line endings + RFC 5321 dot-stuffing, terminated for DATA. */
export function smtpData(mime: string): string {
  const lines = mime.replace(/\r?\n/g, "\r\n").split("\r\n");
  if (lines.at(-1) === "") lines.pop();
  return `${lines.map((l) => (l.startsWith(".") ? `.${l}` : l)).join("\r\n")}\r\n.\r\n`;
}

function xoauth2(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString("base64");
}

/** Submit one message. Resolves once the server accepted it for delivery. */
export async function smtpSend(
  input: { user: string; accessToken: string; recipients: string[]; mime: string; timeoutMs?: number },
  connect: SmtpConnect = smtpTransport.connect,
): Promise<void> {
  if (!input.recipients.length) throw new SmtpError(0, "No recipients.");
  let socket: SmtpSocket | null = null;
  let buffer = "";
  let waiter: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;
  let failure: Error | null = null;
  let handedOver = false; // the message body + terminator have been written
  let confirmed = false;

  function fail(err: Error) {
    if (confirmed) return;
    const wrapped = handedOver && !(err instanceof SmtpError && err.code >= 400)
      ? new SmtpError(0, "Gmail's mail server didn't confirm the email — it may have been sent. Check Sent before sending again.", true)
      : err;
    failure ??= wrapped;
    waiter?.reject(failure);
    waiter = null;
    socket?.destroy();
  }
  const timer = setTimeout(() => fail(new SmtpError(0, "Gmail's mail server took too long to answer.")), input.timeoutMs ?? 60_000);

  // One reply = lines "NNN-..." ending with a "NNN ..." line.
  function drain() {
    if (!waiter) return;
    const lines = buffer.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3}(?: |$)/.test(lines[i])) {
        const text = lines.slice(0, i + 1).join("\n");
        buffer = lines.slice(i + 1).join("\r\n");
        const w = waiter;
        waiter = null;
        w.resolve({ code: Number(lines[i].slice(0, 3)), text });
        return;
      }
    }
  }
  const reply = () =>
    new Promise<{ code: number; text: string }>((resolve, reject) => {
      if (failure) return reject(failure);
      waiter = { resolve, reject };
      drain();
    });
  const expect = async (ok: number[], what: string) => {
    const r = await reply();
    if (!ok.includes(r.code)) throw new SmtpError(r.code, `${what}: ${r.text.slice(0, 200)}`);
    return r;
  };
  const command = async (line: string, ok: number[], what: string) => {
    socket!.write(`${line}\r\n`);
    return expect(ok, what);
  };

  try {
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      socket = await Promise.race([
        connect(),
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(() => reject(new SmtpError(0, "Could not reach Gmail's mail server.")), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(connectTimer);
    }
    if (failure) throw failure; // timed out while connecting
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      drain();
    });
    socket.on("error", (err) => fail(err));
    socket.on("close", () => fail(new SmtpError(0, "Gmail's mail server closed the connection.")));

    await expect([220], "Greeting");
    const ehlo = await command("EHLO sjcos", [250], "EHLO");
    socket.write(`AUTH XOAUTH2 ${xoauth2(input.user, input.accessToken)}\r\n`);
    const auth = await reply();
    if (auth.code === 334) {
      // Google's error challenge: acknowledge it, then it answers with a code.
      socket.write("\r\n");
      const final = await reply();
      if (final.code >= 500) throw new SmtpAuthError(`Gmail refused the mail-server login (${final.code}).`);
      throw new SmtpError(final.code, `Mail-server login failed for now (${final.code}).`);
    }
    if (auth.code >= 500) throw new SmtpAuthError(`Gmail refused the mail-server login (${auth.code}).`);
    if (auth.code !== 235) throw new SmtpError(auth.code, `Mail-server login failed for now (${auth.code}).`);
    const eightBit = /\b8BITMIME\b/i.test(ehlo.text) ? " BODY=8BITMIME" : "";
    await command(`MAIL FROM:<${input.user}>${eightBit}`, [250], "MAIL FROM");
    for (const r of input.recipients) await command(`RCPT TO:<${r}>`, [250, 251], `RCPT ${r}`);
    await command("DATA", [354], "DATA");
    handedOver = true;
    socket.write(smtpData(input.mime));
    await expect([250], "Message");
    confirmed = true;
    socket.write("QUIT\r\n");
    socket.end();
  } catch (err) {
    socket?.destroy();
    throw failure ?? err;
  } finally {
    clearTimeout(timer);
  }
}
