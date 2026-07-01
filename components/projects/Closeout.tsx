"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck, FileText, ScrollText, Check } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { CloseoutView } from "@/lib/closeout";
import { generateCompletionCertificate, generateLienWaiver } from "@/lib/actions/closeout";

const WAIVER_CHIP: Record<string, "money" | "accent" | "flag" | "ghost"> = {
  signed: "money",
  sent: "accent",
  declined: "flag",
  void: "ghost",
  draft: "ghost",
};

/** Project Closeout tab — generate the substantial-completion certificate and
 *  the final lien waiver, and see the generated closeout documents. */
export function Closeout({ slug, view }: { slug: string; view: CloseoutView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"cert" | "waiver" | null>(null);
  const [error, setError] = useState("");

  function generate(kind: "cert" | "waiver") {
    setError("");
    setBusy(kind);
    startTransition(async () => {
      const res = kind === "cert"
        ? await generateCompletionCertificate(slug)
        : await generateLienWaiver(slug);
      setBusy(null);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-ink bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-[#232a1e] disabled:opacity-60";

  return (
    <div className="max-w-[760px] space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="p-3.5">
          <div className="flex items-center gap-2">
            <FileCheck className="size-4 text-accent" strokeWidth={1.75} />
            <h3 className="font-serif text-[14px] font-semibold text-ink">Substantial completion</h3>
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            A certificate documenting the job reached substantial completion, with a short summary + warranty terms.
          </p>
          <button type="button" onClick={() => generate("cert")} disabled={pending} className={`${btn} mt-3`}>
            <FileText className="size-3.5" strokeWidth={1.75} />
            {busy === "cert" ? "Generating…" : "Generate certificate"}
          </button>
        </Card>

        <Card className="p-3.5">
          <div className="flex items-center gap-2">
            <ScrollText className="size-4 text-accent" strokeWidth={1.75} />
            <h3 className="font-serif text-[14px] font-semibold text-ink">Final lien waiver</h3>
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            A final waiver &amp; release of lien, sent to the client to counter-sign in their portal.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => generate("waiver")} disabled={pending} className={btn}>
              <FileText className="size-3.5" strokeWidth={1.75} />
              {busy === "waiver" ? "Generating…" : "Generate & send"}
            </button>
            {view.lienWaiverStatus && (
              <Chip kind={WAIVER_CHIP[view.lienWaiverStatus] ?? "ghost"}>
                {view.lienWaiverStatus === "signed" ? "signed" : view.lienWaiverStatus === "sent" ? "awaiting signature" : view.lienWaiverStatus}
              </Chip>
            )}
          </div>
        </Card>
      </div>

      {error && <div className="text-[12px] text-flag">{error}</div>}

      {view.outreachSent && (
        <div className="flex items-center gap-1.5 text-[12px] text-money">
          <Check className="size-3.5" strokeWidth={2} />
          Completion outreach (warranty info + review request) sent to the client.
        </div>
      )}

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Generated closeout documents
        </div>
        {view.docs.length === 0 ? (
          <Card kind="dashed" className="p-6 text-center text-[12px] text-ink-3">
            No closeout documents yet.
          </Card>
        ) : (
          <div className="space-y-2">
            {view.docs.map((d) => (
              <Card key={d.id} className="flex items-center gap-3 p-3">
                <FileText className="size-4 flex-none text-ink-3" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[13.5px] font-semibold text-ink">{d.name}</div>
                  <div className="text-[11px] text-ink-3">{d.kind} · {d.when}</div>
                </div>
                <a
                  href={`/api/files/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="flex-none font-mono text-[11px] font-semibold text-accent-2 hover:underline"
                >
                  Open
                </a>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
