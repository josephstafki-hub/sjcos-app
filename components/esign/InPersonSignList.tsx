import Link from "next/link";
import { FileSignature, FileText, PenLine, Tablet } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import { docTypeLabel, type SignatureRequestView } from "@/lib/esign-types";

/** Owner-side "Sign in person" section (project + lead Documents tab): every
 *  document currently awaiting a signature — template drafts, estimates,
 *  change orders, lien waivers alike — each one tap away from the in-person
 *  screen, plus the recent in-person signings for the record. Server-safe:
 *  no hooks, plain links. */
export function InPersonSignList({ requests }: { requests: SignatureRequestView[] }) {
  const pending = requests.filter((r) => r.status === "sent");
  const recent = requests.filter((r) => r.status === "signed" && r.signedMethod === "in_person").slice(0, 6);

  return (
    <div className="space-y-4">
      <Card kind="soft" className="p-3.5">
        <div className="flex items-start gap-3">
          <Tablet className="mt-0.5 size-4 flex-none text-accent" strokeWidth={1.75} />
          <div className="min-w-0">
            <div className="font-serif text-[15px] font-semibold text-ink">Sign in person</div>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
              Sitting with the client? Open a document below on this device — the iPad is ideal — hand it over,
              and they sign right here with a finger or stylus. It&rsquo;s the same legal record as signing from
              their portal (consent, timestamp, device, certificate), with you noted as the witness.
            </p>
          </div>
        </div>
      </Card>

      {pending.length === 0 ? (
        <div className="text-[12px] leading-relaxed text-ink-3">
          Nothing is waiting for a signature right now. Prepare a document in one of the sections above and use
          its &ldquo;Sign in person&rdquo; button, or come back here once something has been sent.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pending.map((r) => (
            <Card key={r.id} className="p-3">
              <div className="flex items-center gap-3">
                <FileSignature className="size-4 flex-none text-accent" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-[14px] font-semibold text-ink">{r.title}</div>
                  <div className="mt-0.5 text-[11px] text-ink-3">
                    {docTypeLabel(r.docType)} · for {r.signerName || "the client"}
                    {r.sentAtLabel ? ` · waiting since ${r.sentAtLabel}` : ""}
                  </div>
                </div>
                <Link
                  href={`/sign/${r.id}`}
                  className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md border border-ink bg-ink px-3 text-[12px] font-semibold text-paper hover:bg-[#232a1e]"
                >
                  <PenLine className="size-3.5" strokeWidth={2} />
                  Sign in person
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Signed in person</div>
          <div className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-ink-2">{r.title}</span>
                <span className="flex-none text-ink-3">
                  {r.signedName}
                  {r.signedAtLabel ? ` · ${r.signedAtLabel}` : ""}
                  {r.witnessName ? ` · witnessed by ${r.witnessName}` : ""}
                </span>
                {r.fileId && (
                  <a
                    href={`/api/portal/sign-doc/${r.id}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex flex-none items-center gap-1 font-semibold text-accent-2 hover:underline"
                  >
                    <FileText className="size-3" strokeWidth={1.75} />
                    PDF
                  </a>
                )}
                <Chip kind="money">signed</Chip>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
