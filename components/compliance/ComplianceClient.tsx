"use client";
import { Fragment, useState, useTransition, type ReactNode } from "react";
import { CalendarCheck, ChevronDown, Sparkles } from "lucide-react";
import {
  AiBubble,
  Button,
  PageHeader,
  Segmented,
  KpiTile,
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableHeader,
  TableRow,
  TableCell,
  TablePrimaryCell,
  EmptyState,
  Chip,
} from "@/components/ui";
import type { ComplianceWindowCard, TimelineRow } from "@/lib/compliance";
import {
  resolveComplianceItem,
  reopenComplianceItem,
  queueRenewalRequests,
  summarizeCompliance,
} from "@/lib/actions/compliance";
import { runAction } from "@/lib/run-action";
const FILTER_KINDS: Record<string, string[]> = {
  COI: ["coi"],
  Licenses: ["license"],
  Tax: ["tax"],
  Insurance: ["insurance"],
};
const KIND_LABELS: Record<string, string> = {
  coi: "COI",
  license: "License",
  tax: "Tax",
  insurance: "Insurance",
  other: "Other",
};
export function ComplianceClient({
  eyebrow,
  filters,
  windows,
  timeline,
  history: historyRows = [],
  aiSlot,
}: {
  eyebrow: string;
  filters: string[];
  windows: ComplianceWindowCard[];
  timeline: TimelineRow[];
  history?: TimelineRow[];
  aiSlot?: ReactNode;
}) {
  const [summary, setSummary] = useState("");
  const [history, setHistory] = useState(false);
  const [active, setActive] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const matches = (kind: string) =>
    !FILTER_KINDS[active] || FILTER_KINDS[active].includes(kind);
  const shown = (history ? historyRows : timeline).filter((r) =>
    matches(r.kind),
  );
  return (
    <>
      <PageHeader
        title="Compliance"
        meta={eyebrow}
        actions={
          <>
            <Button
              variant="ghost"
              className="text-ai-2"
              icon={Sparkles}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await runAction(() => summarizeCompliance());
                  if (r.ok) setSummary(r.summary);
                })
              }
            >
              Summarize
            </Button>
            <CollectRenewalsButton />
          </>
        }
        filters={
          <Segmented
            aria-label="Compliance filter"
            value={active}
            onChange={setActive}
            options={filters.map((f) => ({ value: f, label: f }))}
          />
        }
      />
      <div className="mt-6 grid grid-cols-2 gap-3 @xl/page:grid-cols-3">
        {windows.map((w, n) => {
          const count = w.items.filter((i) => matches(i.kind)).length;
          return (
            <KpiTile
              key={w.label}
              label={["Urgent · 0–14 days", "15–30 days", "31–90 days"][n]}
              value={count}
              tone={count ? (w.urgent ? "flag" : "warn") : "default"}
              meta={count === 1 ? "item to review" : "items to review"}
            />
          );
        })}
      </div>
      {summary && <AiBubble className="mt-4">{summary}</AiBubble>}
      {aiSlot}
      <section id="compliance-timeline" className="mt-6 scroll-mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-serif text-heading">
            {history ? "Resolved items" : "Year ahead · timeline"}
          </h2>
          <Button
            variant="ghost"
            onClick={() => {
              setHistory(!history);
              setExpanded(null);
            }}
          >
            {history ? "View timeline" : "View resolved"}
          </Button>
        </div>
        <TableWrapper>
          <Table>
            <TableHead>
              <tr>
                <TableHeader>Renewal & next step</TableHeader>
                <TableHeader>Due</TableHeader>
                <TableHeader className="@max-3xl/page:hidden">Type</TableHeader>
                <TableHeader>
                  <span className="sr-only">Details</span>
                </TableHeader>
              </tr>
            </TableHead>
            <TableBody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <TableRow>
                    <TablePrimaryCell meta={r.who}>
                      <button
                        className="text-left hover:underline"
                        onClick={() =>
                          setExpanded(expanded === r.id ? null : r.id)
                        }
                        aria-expanded={expanded === r.id}
                      >
                        {r.what}
                      </button>
                      <p className="mt-1 text-meta font-normal text-ink-3">
                        {r.step}
                      </p>
                    </TablePrimaryCell>
                    <TableCell
                      className={r.dot === "flag" ? "text-flag" : "text-ink-2"}
                    >
                      {r.date}
                    </TableCell>
                    <TableCell className="@max-3xl/page:hidden">
                      <Chip kind={r.dot === "flag" ? "warn" : "neutral"}>
                        {KIND_LABELS[r.kind] ?? "Other"}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        icon={ChevronDown}
                        iconOnly
                        aria-label={`Details for ${r.what}`}
                        title="Show details"
                        onClick={() =>
                          setExpanded(expanded === r.id ? null : r.id)
                        }
                      />
                    </TableCell>
                  </TableRow>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={4} className="bg-paper-2/50 px-4 py-3">
                        <p className="text-body text-ink-2">
                          {r.notes || r.step}
                        </p>
                        <div className="mt-3">
                          {!history && r.kind === "insurance" ? (
                            <Button
                              href="#insurance-policies"
                              variant="secondary"
                            >
                              Update policy below
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={pending}
                              onClick={() =>
                                start(async () => {
                                  await runAction(async () => {
                                    if (history)
                                      await reopenComplianceItem(r.id);
                                    else await resolveComplianceItem(r.id);
                                    return { ok: true };
                                  });
                                })
                              }
                            >
                              {history ? "Reopen item" : "Mark resolved"}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          {!shown.length && (
            <EmptyState
              compact
              icon={CalendarCheck}
              title={
                history
                  ? "No resolved items in this view"
                  : "No renewals in this view"
              }
              description="Tracked license, tax, COI and insurance renewal dates appear here. Add an insurance policy below or choose another filter."
            />
          )}
        </TableWrapper>
      </section>
    </>
  );
}
function CollectRenewalsButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={pending}
        onClick={() => {
          setNote("");
          start(async () => {
            const r = await runAction(() => queueRenewalRequests());
            if (r.ok)
              setNote(
                r.queued
                  ? `${r.queued} queued to Engine`
                  : r.alreadyQueued
                    ? "Renewals already queued"
                    : "No renewals due in the next 45 days",
              );
          });
        }}
      >
        {pending ? "Queueing…" : "Collect renewals"}
      </Button>
      {note && (
        <span role="status" className="text-meta text-ink-3">
          {note}
        </span>
      )}
    </div>
  );
}
