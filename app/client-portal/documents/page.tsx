import { ChevronDown } from "lucide-react";
import { Card, Chip, Eyebrow } from "@/components/ui";
import type { ChipKind } from "@/components/ui";
import { portalSlug } from "@/lib/client-portal";
import { getClientSignatures } from "@/lib/esign";
import { getProjectEstimates, type EstimateDetail } from "@/lib/estimates";
import { getProjectChangeOrders } from "@/lib/change-orders";
import { usd } from "@/lib/money";
import { ClientSignDocs } from "@/components/portal/ClientSignDocs";

// Client-portal documents: one place for everything that needs (or carries) a
// signature — contracts, estimates, change orders, and any other doc Joe
// sends — plus readable detail on estimates and change orders. Signing and
// declining go through the e-sign engine (signature_requests); approving an
// estimate or CO happens by signing its linked request.
export default async function PortalDocumentsPage() {
  const slug = await portalSlug();

  const [signDocs, estimates, changeOrders] = slug
    ? await Promise.all([
        getClientSignatures(slug),
        getProjectEstimates(slug),
        getProjectChangeOrders(slug),
      ])
    : [[], [], []];

  // Clients never see internal drafts.
  const clientEstimates = estimates.filter((e) => e.status !== "draft");
  const clientCOs = changeOrders.filter((c) => c.status !== "draft");
  const toSign = signDocs.filter((d) => d.status === "sent").length;

  return (
    <main className="mx-auto w-full max-w-3xl px-9 py-7">
      <Eyebrow>Documents</Eyebrow>
      <h1 className="mt-1 font-serif text-[26px] font-medium leading-tight text-accent-2">
        {toSign > 0
          ? `${toSign} document${toSign > 1 ? "s" : ""} waiting on your signature.`
          : "Everything we've put in writing."}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        Estimates, contracts, and change orders live here. Signing is the approval —
        type your name, and the project record updates on Joe&apos;s side instantly.
      </p>

      <div className="my-5 border-t border-rule" />
      <div id="documents" className="scroll-mt-4">
        <Eyebrow muted>To sign · history</Eyebrow>
        <ClientSignDocs docs={signDocs} />
      </div>

      {clientEstimates.length > 0 && (
        <>
          <div className="my-5 border-t border-rule" />
          <Eyebrow muted>Estimates</Eyebrow>
          <div className="mt-2 flex flex-col gap-2.5">
            {clientEstimates.map((e) => (
              <EstimateCard key={e.id} estimate={e} />
            ))}
          </div>
        </>
      )}

      {clientCOs.length > 0 && (
        <>
          <div className="my-5 border-t border-rule" />
          <Eyebrow muted>Change orders</Eyebrow>
          <div className="mt-2 flex flex-col gap-2.5">
            {clientCOs.map((co) => (
              <Card key={co.id} className="p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-serif text-[13px] font-semibold text-ink">
                    {co.title}
                  </span>
                  <span className="font-mono text-[12px] font-semibold text-ink-2">
                    {co.priceLabel}
                  </span>
                  <StatusChip status={co.status} />
                </div>
                {co.description && (
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-ink-2">
                    {co.description}
                  </p>
                )}
                <div className="mt-1 font-mono text-[10px] text-ink-3">
                  {co.createdAtLabel}
                  {co.status === "sent" && " · sign it in the list above"}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

const STATUS_CHIP: Record<string, { kind: ChipKind; label: string }> = {
  sent: { kind: "info", label: "awaiting your signature" },
  approved: { kind: "money", label: "approved" },
  declined: { kind: "flag", label: "declined" },
};

function StatusChip({ status }: { status: string }) {
  const c = STATUS_CHIP[status] ?? { kind: "ghost" as ChipKind, label: status };
  return (
    <Chip kind={c.kind} dot>
      {c.label}
    </Chip>
  );
}

function EstimateCard({ estimate: e }: { estimate: EstimateDetail }) {
  // Lines arrive ordered by section — group for display.
  const sections = new Map<string, EstimateDetail["lines"]>();
  for (const l of e.lines) {
    const key = l.section || "General";
    const list = sections.get(key);
    if (list) list.push(l);
    else sections.set(key, [l]);
  }

  return (
    <Card className="p-2.5">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 font-serif text-[13px] font-semibold text-ink">
            {e.title}
          </span>
          <span className="font-mono text-[12px] font-semibold text-ink-2">{usd(e.total)}</span>
          <StatusChip status={e.status} />
          <ChevronDown
            className="size-3.5 flex-none text-ink-3 transition-transform group-open:rotate-180"
            strokeWidth={1.75}
          />
        </summary>

        <div className="mt-2.5 border-t border-rule-soft pt-2.5">
          {[...sections.entries()].map(([name, lines]) => (
            <div key={name} className="mb-2.5">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                {name}
              </div>
              <div className="flex flex-col gap-1">
                {lines.map((l) => (
                  <div key={l.id} className="flex items-baseline gap-2 text-[11.5px]">
                    <span className="min-w-0 flex-1 text-ink-2">{l.description}</span>
                    <span className="flex-none font-mono text-[10px] text-ink-3">
                      {l.qty} {l.unit}
                    </span>
                    <span className="w-[76px] flex-none text-right font-mono text-ink-2">
                      {usd(l.extended)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-0.5 border-t border-rule-soft pt-1.5">
            <TotalRow label="Subtotal" value={usd(e.subtotal)} />
            {e.markupTotal > 0 && <TotalRow label="Overhead & margin" value={usd(e.markupTotal)} />}
            <TotalRow label="Total" value={usd(e.total)} strong />
          </div>

          {e.drawSchedule && e.drawSchedule.length > 0 && (
            <div className="mt-2.5 border-t border-rule-soft pt-1.5">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">
                Payment schedule
              </div>
              <div className="flex flex-col gap-0.5">
                {e.drawSchedule.map((d, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                    <span className="min-w-0 flex-1 text-ink-2">{d.label}</span>
                    <span className="flex-none font-mono text-[10px] text-ink-3">{d.percent}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-2 font-mono text-[10px] text-ink-3">
            {e.createdAtLabel}
            {e.status === "sent" && " · approve by signing it in the list above"}
          </div>
        </div>
      </details>
    </Card>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 text-[11.5px]">
      <span className={`flex-1 ${strong ? "font-semibold text-ink" : "text-ink-3"}`}>{label}</span>
      <span className={`font-mono ${strong ? "font-semibold text-ink" : "text-ink-3"}`}>{value}</span>
    </div>
  );
}
