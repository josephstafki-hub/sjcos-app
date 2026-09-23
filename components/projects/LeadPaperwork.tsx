// "From the lead" — the paperwork a job carried over from its lead stage, shown
// read-only under the project's Documents tab: the Phase 1 rough estimate
// (lead_estimates) and every lead-scoped document (pre-con agreement, formal
// estimate PDF, …) with its status and PDF. Those rows stay keyed by lead_slug
// after conversion, so without this section they vanished from view the moment
// a lead became a project. Editing still happens on the lead page — the link at
// the top opens it.

import Link from "next/link";
import { FileDown, ExternalLink } from "lucide-react";
import { Card, Chip } from "@/components/ui";
import type { LeadPaperwork as LeadPaperworkData } from "@/lib/leads";
import type { DraftView } from "@/lib/doc-drafts";

const STATUS_KIND: Record<string, "money" | "accent" | "flag" | "ghost"> = {
  signed: "money",
  submitted: "accent",
  rendered: "ghost",
  draft: "ghost",
  void: "ghost",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  rendered: "Rendered",
  submitted: "Sent for signature",
  signed: "Signed",
  void: "Voided",
};

export function LeadPaperwork({ paperwork, drafts }: { paperwork: LeadPaperworkData; drafts: DraftView[] }) {
  const { leadSlug, leadName, roughEstimate } = paperwork;
  const leadHref = `/leads/${leadSlug}`;
  const live = drafts.filter((d) => d.status !== "void");
  const voided = drafts.length - live.length;
  const nothing = !roughEstimate && live.length === 0;

  return (
    <div className="max-w-[820px] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-[17px] font-semibold text-ink">From the lead</h3>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            {leadName} · lead stage
          </div>
          <div className="mt-1 text-[12px] text-ink-3">
            Paperwork from before this job was a project. It is read-only here; open the lead to change or resend it.
          </div>
        </div>
        <Link
          href={`${leadHref}?tab=Documents`}
          className="inline-flex flex-none items-center gap-1 rounded-md border border-rule px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-paper-2"
        >
          Open lead <ExternalLink className="size-3" strokeWidth={1.75} />
        </Link>
      </div>

      {nothing && (
        <Card kind="dashed" className="p-6 text-center">
          <div className="font-serif text-[15px] font-semibold text-ink-2">Nothing from the lead stage</div>
          <div className="mt-1 text-[12px] text-ink-3">No rough estimate or pre-con agreement was drafted on the lead.</div>
        </Card>
      )}

      {roughEstimate && (
        <Card className="p-3.5">
          <div className="flex items-center gap-2">
            <h4 className="flex-1 font-serif text-[15px] font-semibold text-ink">Phase 1 rough estimate</h4>
            <Chip kind={roughEstimate.status === "sent" ? "accent" : "ghost"}>{roughEstimate.sentLabel}</Chip>
            <a
              href={`/api/leads/${leadSlug}/rough-estimate`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent-2 hover:underline"
            >
              <FileDown className="size-3" strokeWidth={1.75} /> PDF
            </a>
          </div>
          <div className="mt-2.5 flex flex-col">
            {roughEstimate.lines.map((line, i) => (
              <div
                key={`${line.label}-${i}`}
                className={`flex items-start justify-between gap-4 py-1 ${i ? "border-t border-dashed border-rule-soft" : ""}`}
              >
                <span className="min-w-0 break-words text-[13px] text-ink-2">{line.label}</span>
                <span className="min-w-0 break-words text-right font-mono text-[12px] text-ink-2">{line.value}</span>
              </div>
            ))}
            <div className="mt-1.5 flex items-start justify-between gap-4 border-t-2 border-ink-2 pt-2">
              <span className="min-w-0 break-words font-serif text-[15px] font-semibold text-ink">Rough total</span>
              <span className="min-w-0 break-words text-right font-mono text-[15px] font-semibold text-accent-2">
                {roughEstimate.total || "—"}
              </span>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-ink-3">
            The formal estimate for this job lives in Money › Estimate. This is the early range sent while it was still a lead.
          </div>
        </Card>
      )}

      {live.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            Lead documents · {live.length}
            {voided ? ` · ${voided} voided` : ""}
          </div>
          {live.map((d, i) => {
            const pdfHref = d.pdf_file_id ? `/api/files/${d.pdf_file_id}` : `/api/doc-drafts/${d.id}/preview`;
            return (
              <div key={d.id} className={`flex items-start gap-3 px-4 py-2.5 ${i ? "border-t border-rule-soft" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{d.title}</span>
                    <Chip kind={STATUS_KIND[d.status] ?? "ghost"}>{STATUS_LABEL[d.status] ?? d.status}</Chip>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-3">
                    {d.manifest.title} · {d.createdAtLabel}
                    {d.status === "signed" && d.signedName
                      ? ` · Signed by ${d.signedName}${d.signedAtLabel ? ` on ${d.signedAtLabel}` : ""}`
                      : d.status === "submitted"
                        ? ` · Sent to ${d.signerName}${d.sentAtLabel ? ` · ${d.sentAtLabel}` : ""}`
                        : ""}
                    {d.declineReason ? ` · Declined: ${d.declineReason}` : ""}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-3 text-[12px]">
                  <a
                    href={pdfHref}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline"
                  >
                    <FileDown className="size-3" strokeWidth={1.75} /> PDF
                  </a>
                  {d.docx_file_id && (
                    <a
                      href={`/api/files/${d.docx_file_id}`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 font-semibold text-accent-2 hover:underline"
                    >
                      <FileDown className="size-3" strokeWidth={1.75} /> DOCX
                    </a>
                  )}
                  <Link href={`${leadHref}?tab=Documents&focus=draft-${d.id}`} className="text-ink-3 hover:text-ink-2">
                    Edit on lead
                  </Link>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
