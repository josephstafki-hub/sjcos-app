"use client";

import { useState, useTransition } from "react";
import { Phone, Mail, X, Copy, Check } from "lucide-react";
import { sendNewEmailAction } from "@/lib/actions/inbox";

const BTN =
  "inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-paper-2";
const BTN_OFF =
  "inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-[12px] font-semibold text-ink-4";

/** Lead Call + Email buttons. Call reveals the number (so it's usable on a
 *  desktop, where tel: does nothing) with a copy + dial affordance. Email opens
 *  the in-app Gmail composer prefilled to the lead — not the OS mailto handler. */
export function LeadContact({
  name,
  phone,
  email,
}: {
  name: string;
  phone: string | null;
  email: string | null;
}) {
  const [showPhone, setShowPhone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compose, setCompose] = useState(false);

  function copy() {
    if (!phone) return;
    navigator.clipboard?.writeText(phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      {/* Call — reveals the number in a popover */}
      <div className="relative">
        {phone ? (
          <button type="button" onClick={() => setShowPhone((v) => !v)} className={BTN}>
            <Phone className="size-3" strokeWidth={1.5} />
            Call
          </button>
        ) : (
          <span className={BTN_OFF}>
            <Phone className="size-3" strokeWidth={1.5} />
            Call
          </span>
        )}
        {showPhone && phone && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[200px] rounded-lg border border-rule bg-card p-3 shadow-xl">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{name}</div>
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-0.5 block font-serif text-[18px] font-semibold text-ink hover:text-accent-2">
              {phone}
            </a>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md border border-rule px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-paper-2"
              >
                {copied ? <Check className="size-3 text-money" strokeWidth={2} /> : <Copy className="size-3" strokeWidth={1.5} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Email — in-app composer */}
      {email ? (
        <button type="button" onClick={() => setCompose(true)} className={BTN}>
          <Mail className="size-3" strokeWidth={1.5} />
          Email
        </button>
      ) : (
        <span className={BTN_OFF}>
          <Mail className="size-3" strokeWidth={1.5} />
          Email
        </span>
      )}

      {compose && email && (
        <ComposeModal name={name} email={email} onClose={() => setCompose(false)} />
      )}
    </>
  );
}

function ComposeModal({ name, email, onClose }: { name: string; email: string; onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, startSend] = useTransition();

  function send() {
    setError(null);
    startSend(async () => {
      const res = await sendNewEmailAction({ to: email, subject, body });
      if (res.ok) {
        setSent(true);
        setTimeout(onClose, 900);
      } else {
        setError(res.error ?? "Could not send.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-lg border border-rule bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-serif text-[17px] font-semibold text-ink">Email {name}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">To</span>
            <span className="text-ink-2">{email}</span>
          </div>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            autoFocus
            placeholder={`Hi ${name.split(" ")[0]},`}
            className="resize-y rounded-md border border-rule bg-paper px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none focus:border-accent"
          />
          {error && <div className="text-[11px] text-flag">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-rule px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!body.trim() || sending || sent}
              className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-50"
            >
              {sent ? "Sent ✓" : sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
