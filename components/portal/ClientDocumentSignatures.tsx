"use client";

import { useState } from "react";
import { Button, Card, Eyebrow } from "@/components/ui";
import { ClientSignDocs } from "./ClientSignDocs";
import { docTypeLabel, type SignatureRequestView } from "@/lib/esign-types";
import type { PortalSignatureReview } from "@/lib/portal-signature-review";
import { signatureSections } from "@/lib/portal-presentation";

/** Success belongs to this signing visit. A fresh visit starts with folded history. */
export function ClientDocumentSignatures({ docs, reviews, preview }: {
  docs: SignatureRequestView[];
  reviews: Record<number, PortalSignatureReview>;
  preview: boolean;
}) {
  const [justSignedId, setJustSignedId] = useState<number | null>(null);
  const { pending, justSigned, history } = signatureSections(docs, justSignedId);
  return <>
    <section id="documents" className="mt-5 scroll-mt-4 border-t border-rule pt-4">
      <Eyebrow muted>To sign</Eyebrow>
      {pending.length ? <ClientSignDocs docs={pending} reviews={reviews} preview={preview} onSigned={setJustSignedId} />
        : <p className="mt-2 text-body text-ink-2">No documents waiting on your signature. New requests from Joe will appear here.</p>}
    </section>
    {justSigned && <Card className="mt-5 p-4" role="status">
      <h2 className="font-serif text-heading font-semibold">{docTypeLabel(justSigned.docType)} signed</h2>
      <p className="mt-2 text-body text-ink-2">{justSigned.title} · Signed {justSigned.signedAtLabel ?? "— date not recorded"}{justSigned.signedName ? ` by ${justSigned.signedName}` : ""}.</p>
      {reviews[justSigned.id]?.hasSignedCopy ? <div className="mt-3 flex flex-wrap gap-3">
        <Button href={`/api/portal/sign-doc/${justSigned.id}`} target="_blank" rel="noopener">View signed copy</Button>
        <Button variant="secondary" href={`/api/portal/sign-doc/${justSigned.id}?download=1`} download>Download signed copy</Button>
      </div> : <p className="mt-3 text-body text-ink-3">Your signature is recorded. The signed PDF is not available yet. <a href="/client-portal/messages" className="underline">Ask Joe for a copy.</a></p>}
    </Card>}
    <details className="mt-6 border-t border-rule-soft pt-2">
      <summary className="min-h-11 cursor-pointer py-3 text-subheading font-semibold">History · {history.length} document{history.length === 1 ? "" : "s"}</summary>
      {history.length ? <ClientSignDocs docs={history} reviews={reviews} preview={preview} />
        : <p className="mt-2 text-body text-ink-2">Signed and declined documents will appear here for reference.</p>}
    </details>
  </>;
}
