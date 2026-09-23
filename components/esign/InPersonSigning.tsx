"use client";

// The in-person signing screen (app/sign/[id]). Joe opens it on his iPad, hands
// the device over, and the client reads + signs right there. Deliberately
// spare: no app chrome, big touch targets, the document first and the pad
// second. The binding write is signInPersonAction (owner session + witness).

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eraser, FileText, PenLine, ShieldCheck } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import { CONSENT_STATEMENT, docTypeLabel, type SignatureRequestView } from "@/lib/esign-types";
import { signInPersonAction } from "@/lib/actions/esign";
import { runAction } from "@/lib/run-action";
import { SignaturePad, type SignaturePadHandle } from "@/components/esign/SignaturePad";

export function InPersonSigning({
  request,
  scopeName,
  backHref,
  witnessName,
}: {
  request: SignatureRequestView;
  scopeName: string;
  backHref: string;
  /** The logged-in owner/staff member presenting the device. */
  witnessName: string;
}) {
  const router = useRouter();
  const padRef = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(request.signerName ?? "");
  const [consent, setConsent] = useState(false);
  const [inked, setInked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState<{ name: string; at: Date } | null>(null);
  const [pending, startTransition] = useTransition();

  const docHref = request.fileId ? `/api/portal/sign-doc/${request.id}` : null;
  const backLabel = scopeName ? `Back to ${scopeName}` : "Back";

  function sign() {
    setError(null);
    const signedName = name.trim();
    if (!signedName) return setError("Enter the signer's full name.");
    const data = padRef.current?.toDataUrl() ?? null;
    if (!data) return setError("Draw the signature in the box to sign.");
    if (!consent) return setError("Tick the box to agree to sign electronically.");
    const fd = new FormData();
    fd.set("signedName", signedName);
    fd.set("consent", "on");
    fd.set("signatureData", data);
    startTransition(async () => {
      const res = await runAction(() => signInPersonAction(request.id, fd), { fallback: "Couldn't record the signature." });
      if (!res.ok) return setError(res.error);
      setJustSigned({ name: signedName, at: new Date() });
      router.refresh();
    });
  }

  const signedNow = justSigned ?? (request.status === "signed" && request.signedName
    ? { name: request.signedName, at: null }
    : null);

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="flex items-center gap-3 border-b border-rule bg-card px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href={backHref}
          className="inline-flex h-10 flex-none items-center gap-1.5 rounded-md border border-rule bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-paper-2"
          style={{ touchAction: "manipulation" }}
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          <span className="hidden sm:inline">{backLabel}</span>
        </Link>
        <div className="min-w-0 flex-1">
          <Eyebrow>Sign in person{scopeName ? ` · ${scopeName}` : ""}</Eyebrow>
          <h1 className="truncate font-serif text-[19px] font-semibold leading-tight text-ink sm:text-[22px]">
            {request.title}
          </h1>
        </div>
        <Chip kind="accent">{docTypeLabel(request.docType)}</Chip>
      </header>

      {signedNow ? (
        <SignedState
          title={request.title}
          name={signedNow.name}
          at={signedNow.at}
          atLabel={request.signedAtLabel}
          witnessName={request.witnessName ?? witnessName}
          docHref={docHref}
          backHref={backHref}
          backLabel={backLabel}
        />
      ) : request.status !== "sent" ? (
        <ClosedState status={request.status} reason={request.declineReason} backHref={backHref} backLabel={backLabel} />
      ) : (
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-5">
          {/* The document — read it here; "Open" gives the full native viewer
              (iPad Safari shows only the first page of a framed PDF). */}
          <section className="min-w-0">
            {docHref ? (
              <>
                <iframe
                  src={`${docHref}#toolbar=1&view=FitH`}
                  title={request.title}
                  className="h-[52dvh] w-full rounded-lg border border-rule bg-card lg:h-[calc(100dvh-8.5rem)]"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
                  <a
                    href={docHref}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-accent bg-accent-soft px-3 text-[13px] font-semibold text-accent-2 hover:bg-accent-soft/70"
                    style={{ touchAction: "manipulation" }}
                  >
                    <FileText className="size-4" strokeWidth={1.75} />
                    Open full document
                  </a>
                  <span>Opens in a new tab so every page can be read before signing.</span>
                </div>
              </>
            ) : (
              <div className="max-h-[52dvh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-rule bg-card p-4 font-mono text-[12px] leading-relaxed text-ink lg:max-h-[calc(100dvh-8.5rem)]">
                {request.body}
              </div>
            )}
          </section>

          {/* The pad */}
          <aside className="mt-4 lg:mt-0">
            <Card kind="accent" className="p-4">
              <div className="flex items-start gap-2.5">
                <PenLine className="mt-0.5 size-4 flex-none text-accent" strokeWidth={1.75} />
                <div className="min-w-0">
                  <div className="font-serif text-[16px] font-semibold text-ink">
                    {request.signerName ? `${request.signerName}, ` : ""}please review and sign
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
                    Read the {docTypeLabel(request.docType).toLowerCase()} on the left, then sign in the box
                    with your finger or a stylus. {witnessName} is presenting this device and will be recorded as
                    witness.
                  </p>
                </div>
              </div>

              <label className="mt-3.5 block">
                <span className="mb-1 block text-[11.5px] font-semibold text-ink-2">Signer&rsquo;s full name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full legal name"
                  autoComplete="off"
                  autoCapitalize="words"
                  className="h-11 w-full rounded-md border border-rule bg-card px-3 font-serif text-[17px] text-ink focus:border-accent focus:outline-none"
                />
              </label>

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold text-ink-2">Signature</span>
                  <button
                    type="button"
                    onClick={() => padRef.current?.clear()}
                    disabled={pending || !inked}
                    className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-ink-3 hover:text-ink disabled:opacity-40"
                    style={{ touchAction: "manipulation" }}
                  >
                    <Eraser className="size-3.5" strokeWidth={1.75} />
                    Clear
                  </button>
                </div>
                <SignaturePad ref={padRef} height={200} onChange={(e) => setInked(!e)} />
              </div>

              <label className="mt-3 flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-2">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 size-5 flex-none accent-[var(--color-accent,#4a5d3a)]"
                />
                <span>{CONSENT_STATEMENT.in_person}</span>
              </label>

              {error && <div className="mt-2 text-[12px] font-semibold text-flag">{error}</div>}

              <button
                type="button"
                onClick={sign}
                disabled={pending}
                className="mt-3.5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-money bg-money text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
                style={{ touchAction: "manipulation" }}
              >
                <Check className="size-4" strokeWidth={2.5} />
                {pending ? "Recording signature…" : "Sign document"}
              </button>

              <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
                <ShieldCheck className="mt-0.5 size-3.5 flex-none" strokeWidth={1.75} />
                <span>
                  Your signature, the time, this device, and the witness are recorded on a Certificate of
                  Electronic Signature attached to the signed copy, which is also available in your client portal.
                </span>
              </p>
            </Card>
          </aside>
        </main>
      )}
    </div>
  );
}

function SignedState({
  title,
  name,
  at,
  atLabel,
  witnessName,
  docHref,
  backHref,
  backLabel,
}: {
  title: string;
  name: string;
  at: Date | null;
  atLabel: string | null;
  witnessName: string;
  docHref: string | null;
  backHref: string;
  backLabel: string;
}) {
  const when = at
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Chicago",
        timeZoneName: "short",
      }).format(at)
    : atLabel;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-14 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-money-soft text-money">
        <Check className="size-8" strokeWidth={2.5} />
      </div>
      <h2 className="mt-4 font-serif text-[28px] font-medium leading-tight text-accent-2">Signed. Thank you.</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">{name}</span> signed &ldquo;{title}&rdquo;
        {when ? ` on ${when}` : ""}, witnessed by {witnessName}. A copy with the signature certificate is in the
        client portal.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {docHref && (
          <a
            href={docHref}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center gap-1.5 rounded-md border border-accent bg-accent-soft px-4 text-[13px] font-semibold text-accent-2 hover:bg-accent-soft/70"
            style={{ touchAction: "manipulation" }}
          >
            <FileText className="size-4" strokeWidth={1.75} />
            View signed PDF
          </a>
        )}
        <Link
          href={backHref}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-ink bg-ink px-4 text-[13px] font-semibold text-paper hover:bg-[#232a1e]"
          style={{ touchAction: "manipulation" }}
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          {backLabel}
        </Link>
      </div>
    </main>
  );
}

function ClosedState({
  status,
  reason,
  backHref,
  backLabel,
}: {
  status: SignatureRequestView["status"];
  reason: string | null;
  backHref: string;
  backLabel: string;
}) {
  const copy =
    status === "declined"
      ? `This document was declined${reason ? ` — “${reason}”` : ""}. Revise it and send or present a new version.`
      : status === "void"
        ? "This request was voided. Send or prepare a new version from the project's Documents tab."
        : "This document hasn't been prepared for signing yet. Send it, or use “Sign in person” on the document.";
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-14 text-center">
      <h2 className="font-serif text-[24px] font-medium leading-tight text-ink">Not ready to sign</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{copy}</p>
      <Link
        href={backHref}
        className="mt-6 inline-flex h-11 items-center gap-1.5 rounded-md border border-ink bg-ink px-4 text-[13px] font-semibold text-paper hover:bg-[#232a1e]"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        {backLabel}
      </Link>
    </main>
  );
}
