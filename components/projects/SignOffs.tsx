"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileSignature, Plus, X, Check, Clock, Ban, FileText } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import {
  DOC_TYPES,
  docTypeLabel,
  STATUS_LABEL,
  type SigStatus,
  type SignatureRequestView,
} from "@/lib/esign-types";
import { createSignatureRequest, voidSignatureRequest } from "@/lib/actions/esign";

const STATUS_KIND: Record<SigStatus, "money" | "accent" | "flag" | "ghost"> = {
  signed: "money",
  sent: "accent",
  declined: "flag",
  void: "ghost",
  draft: "ghost",
};

function StatusIcon({ status }: { status: SigStatus }) {
  if (status === "signed") return <Check className="size-3.5 text-money" strokeWidth={2} />;
  if (status === "declined" || status === "void") return <Ban className="size-3.5 text-ink-3" strokeWidth={1.75} />;
  return <Clock className="size-3.5 text-accent" strokeWidth={1.75} />;
}

/** Money tab · Signatures section. Lists signature requests for the project and
 *  lets the owner request a new one (sent to the client to e-sign in the portal). */
export function SignOffs({
  slug,
  requests,
  defaultSignerName = "",
  defaultSignerEmail = "",
}: {
  slug: string;
  requests: SignatureRequestView[];
  defaultSignerName?: string;
  defaultSignerEmail?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      const res = await createSignatureRequest(slug, fd);
      if (res.ok) {
        form.reset();
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function voidReq(id: number) {
    startTransition(async () => {
      await voidSignatureRequest(slug, id);
      router.refresh();
    });
  }

  const inputCls =
    "w-full rounded-md border border-rule bg-card px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none";

  return (
    <div className="max-w-[760px] space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {requests.length} document{requests.length === 1 ? "" : "s"} ·{" "}
          {requests.filter((r) => r.status === "sent").length} awaiting signature
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
        >
          {open ? <X className="size-3" strokeWidth={2} /> : <Plus className="size-3" strokeWidth={2} />}
          {open ? "Cancel" : "Request signature"}
        </button>
      </div>

      {open && (
        <Card className="p-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Title</span>
                <input name="title" required placeholder="e.g. Henderson kitchen — contract" className={inputCls} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Document type</span>
                <select name="docType" defaultValue="contract" className={inputCls}>
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Signer name</span>
                <input name="signerName" defaultValue={defaultSignerName} placeholder="Client name" className={inputCls} />
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Signer email</span>
                <input name="signerEmail" type="email" defaultValue={defaultSignerEmail} placeholder="client@email.com" className={inputCls} />
              </label>
              <label className="col-span-2 block">
                <span className="mb-1 block text-[11px] font-semibold text-ink-2">Document text</span>
                <textarea
                  name="body"
                  required
                  rows={7}
                  placeholder="Paste or write the document the client will review and sign…"
                  className={`${inputCls} resize-y font-mono text-[12px] leading-relaxed`}
                />
              </label>
            </div>
            {error && <div className="text-[12px] text-flag">{error}</div>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-2 disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send to client"}
              </button>
              <span className="text-[11px] text-ink-3">The client signs it in their portal.</span>
            </div>
          </form>
        </Card>
      )}

      {requests.length === 0 ? (
        <Card kind="dashed" className="p-8 text-center">
          <FileSignature className="mx-auto size-5 text-ink-3" strokeWidth={1.5} />
          <div className="mt-2 font-serif text-[15px] font-semibold text-ink-2">No signature requests yet</div>
          <div className="mt-1 text-[12px] text-ink-3">
            Request a signature on a contract, estimate, SOW, or change order — the client signs it in their portal.
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {requests.map((r) => (
            <Card key={r.id} className="p-3.5">
              <div className="flex items-start gap-3">
                <StatusIcon status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-serif text-[15px] font-semibold text-ink">{r.title}</span>
                    <Chip kind="ghost">{docTypeLabel(r.docType)}</Chip>
                    <Chip kind={STATUS_KIND[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                  </div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {r.status === "signed" && r.signedName ? (
                      <>Signed by {r.signedName} · {r.signedAtLabel}</>
                    ) : r.status === "declined" ? (
                      <>Declined{r.declineReason ? ` — ${r.declineReason}` : ""}</>
                    ) : r.status === "sent" ? (
                      <>Sent to {r.signerName || r.signerEmail || "client"} · {r.sentAtLabel}</>
                    ) : (
                      <>Created {r.createdAtLabel}</>
                    )}
                  </div>
                  {r.fileId && (
                    <a
                      href={`/api/portal/sign-doc/${r.id}`}
                      target="_blank"
                      rel="noopener"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-accent-2 hover:underline"
                    >
                      <FileText className="size-3" strokeWidth={1.75} /> View PDF
                    </a>
                  )}
                </div>
                {(r.status === "sent" || r.status === "draft") && (
                  <button
                    type="button"
                    onClick={() => voidReq(r.id)}
                    disabled={pending}
                    className="rounded-md border border-rule bg-card px-2 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper-2 disabled:opacity-60"
                  >
                    Void
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
