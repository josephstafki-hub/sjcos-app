"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { acceptSubDocument, rejectSubDocument } from "@/lib/actions/sub-docs";
import { runAction } from "@/lib/run-action";

/** Owner's Accept / Reject on a sub's uploaded COI. Accept asks for the expiry
 *  date Joe read on the certificate (prefilled with what the sub typed) and is
 *  the only thing that makes the COI current. Reject needs a reason, which goes
 *  to the sub in the email asking for a new one. The actions re-check owner. */
export function SubDocReview({
  slug,
  documentId,
  typedExpiry,
}: {
  slug: string;
  documentId: number;
  typedExpiry: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [expires, setExpires] = useState(typedExpiry ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const inputCls =
    "rounded-md border border-rule bg-card px-2 py-1 text-label text-ink-2 outline-none focus:border-accent";
  const btnCls =
    "inline-flex items-center gap-1 rounded-md border border-rule bg-card px-2.5 py-1 text-label font-semibold text-ink hover:bg-paper-2 disabled:opacity-50";
  const btnPrimary =
    "inline-flex items-center gap-1 rounded-md border border-ink bg-ink px-2.5 py-1 text-label font-semibold text-paper hover:bg-ink/90 disabled:opacity-50";

  function accept() {
    const fd = new FormData();
    fd.set("expires", expires);
    startTransition(async () => {
      await runAction(() => acceptSubDocument(slug, documentId, fd), {
        fallback: "Could not accept it.",
        onSuccess: () =>
          toast({
            kind: "success",
            title: "Accepted",
            message: `COI accepted · expires ${expires}`,
          }),
      });
    });
  }

  function reject() {
    const fd = new FormData();
    fd.set("reason", reason);
    startTransition(async () => {
      await runAction(() => rejectSubDocument(slug, documentId, fd), {
        fallback: "Could not reject it.",
        onSuccess: (r) => {
          setRejecting(false);
          setReason("");
          toast({
            kind: "info",
            title: "Rejected",
            message: r.notice ?? "Rejected.",
          });
        },
      });
    });
  }

  if (rejecting) {
    return (
      <div className="mt-1.5 flex flex-col gap-1.5">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why it can't be accepted — the sub sees this"
          className={`${inputCls} w-full`}
          autoFocus
        />
        <div className="flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            className={btnCls}
            disabled={pending}
            onClick={() => setRejecting(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={pending || !reason.trim()}
            onClick={reject}
          >
            <X className="size-3" strokeWidth={2} />
            {pending ? "Rejecting…" : "Reject and ask for a new one"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <label className="flex items-center gap-1 text-meta text-ink-3">
        Expires
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className={inputCls}
        />
      </label>
      <div className="flex-1" />
      <button
        type="button"
        className={btnCls}
        disabled={pending}
        onClick={() => setRejecting(true)}
      >
        Reject
      </button>
      <button
        type="button"
        className={btnPrimary}
        disabled={pending || !expires}
        onClick={accept}
      >
        <Check className="size-3" strokeWidth={2} />
        {pending ? "Accepting…" : "Accept"}
      </button>
    </div>
  );
}
