"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, FileSignature, ChevronDown, FileText, PenLine, Eraser } from "lucide-react";
import type { PortalSignatureReview } from "@/lib/portal-signature-review";
import { Card, Chip } from "@/components/ui";
import { CONSENT_STATEMENT, docTypeLabel, STATUS_LABEL, type SignatureRequestView } from "@/lib/esign-types";
import { signSignatureRequest, declineSignatureRequest } from "@/lib/actions/esign";
import { runAction } from "@/lib/run-action";
import { SignaturePad, type SignaturePadHandle } from "@/components/esign/SignaturePad";

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

/** Client-portal "Documents to sign" section. Pending requests expand into a
 *  review-and-sign panel (read the document, consent, type name → Sign), with a
 *  decline path. Signed/declined items show as history. */
export function ClientSignDocs({ docs, reviews = {}, preview = false, onSigned }: { onSigned?: (id: number) => void; preview?: boolean; docs: SignatureRequestView[]; reviews?: Record<number, PortalSignatureReview> }) {
  const pending = docs.filter((d) => d.status === "sent");
  const history = docs.filter((d) => d.status !== "sent");

  if (docs.length === 0) {
    return <div className="mt-2 text-label text-ink-3">No documents to sign right now.</div>;
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {pending.map((d) => (
        <SignCard key={d.id} doc={d} review={reviews[d.id]} preview={preview} onSigned={onSigned} />
      ))}
      {history.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-3 border-b border-rule-soft py-3 text-body">
          <Check className={`size-3 flex-none ${d.status === "signed" ? "text-money" : "text-ink-3"}`} strokeWidth={2} />
          <span className="min-w-0 basis-full text-ink-2">{d.title}
            <span className="mt-1 block text-meta text-ink-3">{d.status === "signed" ? `Signed ${d.signedAtLabel ?? "— date not recorded"} · ${reviews[d.id]?.hasSignedCopy ? "Signed copy" : "Signature recorded; signed PDF unavailable"}` : `${STATUS_LABEL[d.status]} · ${d.sentAtLabel ? `Sent ${d.sentAtLabel}` : `Created ${d.createdAtLabel}`}`}</span>
          </span>
          {d.fileId && <a href={`/api/portal/sign-doc/${d.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-2 hover:underline"><FileText className="size-3" strokeWidth={1.75} />{reviews[d.id]?.hasSignedCopy ? "View signed copy" : "View reference PDF"}</a>}
          {reviews[d.id]?.hasSignedCopy && <a href={`/api/portal/sign-doc/${d.id}?download=1`} download className="inline-flex min-h-11 items-center font-semibold text-accent-2 hover:underline">Download signed copy</a>}
          <Chip kind={d.status === "signed" ? "money" : "ghost"}>{STATUS_LABEL[d.status]}</Chip>
        </div>
      ))}
    </div>
  );
}

function SignCard({ doc, review, preview, onSigned }: { onSigned?: (id: number) => void; doc: SignatureRequestView; review?: PortalSignatureReview; preview: boolean }) {
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [name, setName] = useState(doc.signerName ?? "");
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Optional hand-drawn signature. The typed name stays the required part
  // (that's what the record has always keyed on); ink, when present, is what
  // gets stamped on the executed copy.
  const padRef = useRef<SignaturePadHandle>(null);
  const [showPad, setShowPad] = useState(false);
  const [inked, setInked] = useState(false);

  const [jump, setJump] = useState(false);
  useEffect(() => {
    if (!jump || !open) return;
    const section = document.getElementById(`signing-${doc.id}`);
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
    setJump(false);
  }, [jump, open, doc.id]);

  function sign() {
    if (preview) return;
    setError(null);
    if (!name.trim()) return setError("Type your full name to sign.");
    if (!consent) return setError("Please check the box to agree to sign electronically.");
    const fd = new FormData();
    fd.set("signedName", name.trim());
    fd.set("consent", "on");
    const drawn = showPad ? padRef.current?.toDataUrl() : null;
    if (drawn) fd.set("signatureData", drawn);
    startTransition(async () => {
      const res = await runAction(() => signSignatureRequest(doc.id, fd));
      if (!res.ok) setError(res.error);
      else onSigned?.(doc.id);
      // revalidatePath refreshes the server component with the signed record
    });
  }

  function decline() {
    if (preview) return;
    const fd = new FormData();
    fd.set("reason", reason.trim());
    startTransition(async () => {
      const res = await runAction(() => declineSignatureRequest(doc.id, fd));
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Card kind="accent" className="p-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <FileSignature className="size-3.5 flex-none text-accent" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block text-subheading font-semibold text-ink">{doc.title}</span>
          <span className="font-sans text-meta text-ink-3">
            {docTypeLabel(doc.docType)} · needs your signature
          </span>
        </span>
        <ChevronDown className={`size-3.5 flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </button>

      <div className="mt-2 space-y-1 text-body text-ink-2">
        <p>{review?.version ? `Template version ${review.version} · ` : ""}{doc.sentAtLabel ? `Sent ${doc.sentAtLabel}` : `Created ${doc.createdAtLabel}`}</p>
        <p className="font-semibold tabular-nums">Amount: {review?.amountCents != null ? usd(review.amountCents) : "See document — no separate amount recorded"}</p>
        <p>Signing records your legal electronic signature on this {docTypeLabel(doc.docType).toLowerCase()}{doc.docType === "estimate" || doc.docType === "change_order" ? " and approves it in the project record" : ""}. Review its scope, terms and payment obligations first.</p>
      </div>
      <a href={`#signing-${doc.id}`} onClick={() => { setOpen(true); setDeclining(false); setJump(true); }} className="mt-3 mr-3 inline-flex min-h-11 items-center text-body font-semibold text-accent-2 underline">Go to signing</a>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-ink px-3 text-label font-semibold text-paper">{open ? "Close review" : "Review & sign"}</button>

      {open && (
        <div className="mt-2.5 border-t border-rule-soft pt-2.5">
          {doc.fileId ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <a href={`/api/portal/sign-doc/${doc.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-body font-semibold text-accent-2">Open full screen</a>
                <a href={`/api/portal/sign-doc/${doc.id}?download=1`} download className="inline-flex min-h-11 items-center rounded-md border border-rule px-3 text-body font-semibold text-accent-2">Download</a>
              </div>
              <iframe src={`/api/portal/sign-doc/${doc.id}#toolbar=1`} title={doc.title} className="h-[480px] w-full rounded border border-rule bg-card" />
            </>
          ) : (
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-rule bg-card p-2.5 font-sans text-meta leading-relaxed text-ink">
              {doc.body}
            </div>
          )}

          {!declining ? (
            <div id={`signing-${doc.id}`} tabIndex={-1} className="scroll-mt-4">
              <h3 className="mt-4 text-subheading font-semibold">Your signature</h3>
              {preview && <p className="mt-2 text-body text-ink-3">Owner preview. The client signs from their own portal.</p>}
              <label className="mt-2.5 block">
                <span className="mb-1 block text-meta font-semibold text-ink-2">Type your full name to sign</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-md border border-rule bg-card px-2.5 py-1.5 font-serif text-subheading italic text-ink focus:border-accent focus:outline-none"
                />
              </label>
              {showPad ? (
                <div className="mt-2.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-meta font-semibold text-ink-2">Draw your signature (optional)</span>
                    <button
                      type="button"
                      onClick={() => padRef.current?.clear()}
                      disabled={pending || !inked}
                      className="inline-flex items-center gap-1 text-meta font-semibold text-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      <Eraser className="size-3" strokeWidth={1.75} />
                      Clear
                    </button>
                  </div>
                  <SignaturePad ref={padRef} height={160} onChange={(e) => setInked(!e)} />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPad(true)}
                  className="mt-2 inline-flex items-center gap-1 text-meta font-semibold text-accent-2 hover:underline"
                >
                  <PenLine className="size-3" strokeWidth={2} />
                  Draw your signature too (optional)
                </button>
              )}
              <label className="mt-2 flex items-start gap-2 text-meta text-ink-2">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>{CONSENT_STATEMENT[showPad && inked ? "drawn" : "typed"]}</span>
              </label>
              {error && <div className="mt-1.5 text-meta text-flag">{error}</div>}
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={sign}
                  disabled={pending || preview}
                  className="inline-flex items-center gap-1 rounded-md border border-money bg-money px-3 py-1.5 text-label font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  <Check className="size-3" strokeWidth={2.5} />
                  {pending ? "Signing…" : "Sign"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeclining(true)}
                  disabled={pending || preview}
                  className="text-meta font-semibold text-ink-3 hover:text-ink-2 disabled:opacity-60"
                >
                  Decline
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5">
              <label className="block">
                <span className="mb-1 block text-meta font-semibold text-ink-2">Reason for declining (optional)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Let Joe know what needs to change…"
                  className="w-full resize-y rounded-md border border-rule bg-card px-2.5 py-1.5 text-label text-ink focus:border-accent focus:outline-none"
                />
              </label>
              {error && <div className="mt-1.5 text-meta text-flag">{error}</div>}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={decline}
                  disabled={pending || preview}
                  className="rounded-md border border-flag bg-flag px-3 py-1.5 text-label font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {pending ? "Sending…" : "Submit decline"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeclining(false)}
                  disabled={pending || preview}
                  className="text-meta font-semibold text-ink-3 hover:text-ink-2"
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
