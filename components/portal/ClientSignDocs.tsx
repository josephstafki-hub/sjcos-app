"use client";

import { useState, useTransition } from "react";
import { Check, FileSignature, ChevronDown } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { docTypeLabel, type SignatureRequestView } from "@/lib/esign-types";
import { signSignatureRequest, declineSignatureRequest } from "@/lib/actions/esign";

/** Client-portal "Documents to sign" section. Pending requests expand into a
 *  review-and-sign panel (read the document, consent, type name → Sign), with a
 *  decline path. Signed/declined items show as history. */
export function ClientSignDocs({ docs }: { docs: SignatureRequestView[] }) {
  const pending = docs.filter((d) => d.status === "sent");
  const history = docs.filter((d) => d.status !== "sent");

  if (docs.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-3">No documents to sign right now.</div>;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {pending.map((d) => (
        <SignCard key={d.id} doc={d} />
      ))}
      {history.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-[12px]">
          <Check
            className={`size-3 flex-none ${d.status === "signed" ? "text-money" : "text-ink-3"}`}
            strokeWidth={2}
          />
          <span className="min-w-0 flex-1 truncate text-ink-2">{d.title}</span>
          <Chip kind={d.status === "signed" ? "money" : "ghost"}>
            {d.status === "signed" ? "signed" : "declined"}
          </Chip>
        </div>
      ))}
    </div>
  );
}

function SignCard({ doc }: { doc: SignatureRequestView }) {
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [name, setName] = useState(doc.signerName ?? "");
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sign() {
    setError(null);
    if (!name.trim()) return setError("Type your full name to sign.");
    if (!consent) return setError("Please check the box to agree to sign electronically.");
    const fd = new FormData();
    fd.set("signedName", name.trim());
    fd.set("consent", "on");
    startTransition(async () => {
      const res = await signSignatureRequest(doc.id, fd);
      if (!res.ok) setError(res.error);
      // success → revalidatePath refreshes the server component
    });
  }

  function decline() {
    const fd = new FormData();
    fd.set("reason", reason.trim());
    startTransition(async () => {
      const res = await declineSignatureRequest(doc.id, fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Card kind="accent" className="p-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <FileSignature className="size-3.5 flex-none text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[13px] font-semibold text-ink">{doc.title}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {docTypeLabel(doc.docType)} · needs your signature
          </span>
        </span>
        <ChevronDown className={`size-3.5 flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="mt-2.5 border-t border-rule-soft pt-2.5">
          <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-rule bg-card p-2.5 font-mono text-[11px] leading-relaxed text-ink">
            {doc.body}
          </div>

          {!declining ? (
            <>
              <label className="mt-2.5 block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Type your full name to sign</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-md border border-rule bg-card px-2.5 py-1.5 font-serif text-[15px] italic text-ink focus:border-accent focus:outline-none"
                />
              </label>
              <label className="mt-2 flex items-start gap-2 text-[11px] text-ink-2">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I agree that typing my name and clicking Sign constitutes my legal electronic signature on this document.
                </span>
              </label>
              {error && <div className="mt-1.5 text-[11px] text-flag">{error}</div>}
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={sign}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-money bg-money px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                  {pending ? "Signing…" : "Sign"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeclining(true)}
                  disabled={pending}
                  className="text-[11px] font-semibold text-ink-3 hover:text-ink-2 disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </>
          ) : (
            <div className="mt-2.5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Reason for declining (optional)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Let Joe know what needs to change…"
                  className="w-full resize-y rounded-md border border-rule bg-card px-2.5 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none"
                />
              </label>
              {error && <div className="mt-1.5 text-[11px] text-flag">{error}</div>}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={decline}
                  disabled={pending}
                  className="rounded-md border border-flag bg-flag px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? "Sending…" : "Submit decline"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeclining(false)}
                  disabled={pending}
                  className="text-[11px] font-semibold text-ink-3 hover:text-ink-2"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
