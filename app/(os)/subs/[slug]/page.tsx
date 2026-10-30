import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone, Sparkles, Check } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { AiBubble, Card, Chip, Eyebrow, Field } from "@/components/ui";
import type { ChipKind } from "@/components/ui/Chip";
import { AssignToJobButton } from "@/components/subs/AssignToJobButton";
import { getScheduleProjects } from "@/lib/schedule";
import { PageHeader } from "@/components/ui";
import { DirectoryRecordMenu } from "@/components/subs/DirectoryRecordMenu";
import { RemoveAssignmentButton } from "@/components/subs/RemoveAssignmentButton";
import { RestoreAssignmentButton } from "@/components/subs/RestoreAssignmentButton";
import { SubSummary } from "@/components/subs/SubSummary";
import { SubTabs } from "@/components/subs/SubTabs";
import { SubNotes } from "@/components/subs/SubNotes";
import { SubDocReview } from "@/components/subs/SubDocReview";
import { getSub } from "@/lib/subs";
import { can, getCurrentUser } from "@/lib/dal";
import type { JobDot } from "@/lib/subs";
import { getSubLogs, getSubInvoices } from "@/lib/sub-portal";
import { runDirect } from "@/lib/commands/db";
import { subPaperworkForOwner, type OwnerSubDocument } from "@/lib/sub-docs";
import { SUB_DOC_LABEL } from "@/lib/sub-doc-types";

// sub_invoices.amount is CENTS (Phase 5.0).
const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents || 0) / 100,
  );
const SUB_INVOICE_CHIP = {
  submitted: "info",
  approved: "accent",
  paid: "money",
} as const;

/** Review state of an uploaded document, as a chip. A W-9 / agreement that was
 *  simply received reads as on file (no chip) — only a COI needs Joe's OK. */
function docStatusChip(
  d: OwnerSubDocument,
): { kind: ChipKind; label: string } | null {
  switch (d.status) {
    case "under_review":
      return { kind: "info", label: "waiting for review" };
    case "received":
      return d.docType === "coi"
        ? { kind: "ghost", label: "not reviewed" }
        : null;
    case "accepted":
      return { kind: "money", label: "accepted" };
    case "rejected":
      return { kind: "flag", label: "rejected" };
    case "expired":
      return { kind: "flag", label: "expired" };
    case "superseded":
      return { kind: "ghost", label: "replaced" };
  }
}

const DOT: Record<JobDot, string> = {
  accent: "bg-accent",
  money: "bg-money",
  ghost: "bg-ink-4",
};

export default async function SubDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sub = await getSub(slug);
  if (!sub) notFound();
  // A22 money fence: the sub's rate card / Pricing tab need the `money` area.
  const user = await getCurrentUser();
  const showMoney = can(user, "money");
  // Accepting / rejecting a sub's paperwork is Joe's call (the actions re-check).
  const isOwner = user?.role === "owner";

  // Real records the sub posted from their portal (logs + submitted invoices),
  // and their paperwork with its review state.
  const [subLogs, subInvoices, paperwork, projects] = await Promise.all([
    getSubLogs(slug),
    getSubInvoices(slug),
    subPaperworkForOwner(runDirect, slug),
    getScheduleProjects(),
  ]);
  const subDocs = paperwork.documents;
  const coiToReview = subDocs.some(
    (d) => d.docType === "coi" && d.status === "under_review",
  );

  const overview = (
    <div className="grid grid-cols-1 gap-4 @4xl/page:grid-cols-2">
      {/* Reliability + AI summary */}
      <Card className="p-3.5">
        <h3 className="mb-2.5 font-serif text-heading font-semibold text-ink">
          Reliability · {sub.jobsCount} completed jobs
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {sub.reliability.map((r) => (
            <Field key={r.label} label={r.label} value={r.value} />
          ))}
        </div>
        <div className="my-3 border-t border-dashed border-rule" />
        <Eyebrow muted>AI summary</Eyebrow>
        <SubSummary slug={slug} />
      </Card>

      {/* Recent jobs */}
      <Card className="p-3.5">
        <h3 className="mb-2 font-serif text-heading font-semibold text-ink">
          Recent jobs
        </h3>
        {sub.recentJobs.length > 0 ? (
          <div className="flex flex-col">
            {sub.recentJobs.map((j, i) => (
              <div
                key={j.name}
                className={`flex items-center gap-2 py-1.5 ${i ? "border-t border-rule-soft" : ""}`}
              >
                <span
                  className={`size-2 flex-none rounded-full ${DOT[j.dot]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-serif text-body font-semibold text-ink">
                    <Link
                      href={`/projects/${j.projectSlug}`}
                      className="hover:underline"
                    >
                      {j.name}
                    </Link>
                  </div>
                  <div className="text-meta text-ink-3">{j.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-body text-ink-3">No recent jobs logged yet.</div>
        )}
      </Card>

      {/* Sidebar: paperwork, rate, tax */}
      <div className="flex flex-col gap-3">
        <Card className="p-3">
          <Eyebrow muted>Paperwork</Eyebrow>
          <div className="mt-2 flex flex-col gap-1.5">
            {sub.paperwork.map((p) => (
              <div key={p.label} className="flex items-center gap-2">
                <Check
                  className={`size-3 flex-none ${p.ok ? "text-money" : "invisible"}`}
                  strokeWidth={2}
                />
                <span className="flex-1 text-body text-ink-2">{p.label}</span>
                <span
                  className={`text-meta ${p.ok ? "text-ink-3" : "text-ink-4"}`}
                >
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {showMoney && (
          <Card className="p-3">
            <Eyebrow muted>Rate</Eyebrow>
            <div
              className={`mt-1 text-ink ${sub.rate.amount ? "font-serif text-kpi" : "text-body text-ink-3"}`}
            >
              {sub.rate.amount || "Not recorded"}
              {sub.rate.unit && (
                <span className="text-subheading text-ink-3">
                  {sub.rate.unit}
                </span>
              )}
            </div>
            {sub.rate.note && (
              <div className="mt-1.5 text-meta text-ink-3">{sub.rate.note}</div>
            )}
          </Card>
        )}

        {sub.taxNote && (
          <Card kind="ai" className="p-2.5">
            <div className="flex items-start gap-2">
              <Sparkles
                className="mt-0.5 size-3 flex-none text-ai-2"
                strokeWidth={1.5}
              />
              <span className="text-meta leading-snug text-ai-2">
                {sub.taxNote}
              </span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );

  // ── Jobs panel — full recent-jobs history ──────────────────────────────────
  const jobsPanel = (
    <div className="flex max-w-[680px] flex-col gap-3.5">
      {sub.recentJobs.length > 0 ? (
        <Card className="overflow-visible p-0">
          <div className="border-b border-rule bg-paper-2 px-4 py-2.5 text-label font-medium text-ink-3">
            {sub.assignmentCount} assignment
            {sub.assignmentCount === 1 ? "" : "s"} with SJ Carpentry
          </div>
          {sub.recentJobs.map((j, i) => (
            <div
              key={`${j.name}-${i}`}
              className={`flex items-center gap-2.5 px-4 py-3 ${i ? "border-t border-rule-soft" : ""}`}
            >
              <span className={`size-2 flex-none rounded-full ${DOT[j.dot]}`} />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-body font-semibold text-ink">
                  {j.name}
                </div>
                <div className="text-meta text-ink-3">{j.detail}</div>
              </div>
              <RemoveAssignmentButton
                projectSlug={j.projectSlug}
                subSlug={slug}
              />
            </div>
          ))}
        </Card>
      ) : (
        <Card kind="dashed" className="p-8 text-center">
          <div className="font-serif text-heading font-semibold text-ink-2">
            No jobs yet
          </div>
          <div className="mt-1 text-body text-ink-3">
            Assign this sub to a job to start their history.
          </div>
        </Card>
      )}

      {sub.removedJobs.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 font-serif text-heading">Removed assignments</h2>
          <div className="divide-y divide-rule-soft">
            {sub.removedJobs.map((j) => (
              <div
                key={j.projectSlug}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span className="text-body">{j.name}</span>
                <RestoreAssignmentButton
                  projectSlug={j.projectSlug}
                  subSlug={slug}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
      {subInvoices.length > 0 && (
        <Card className="p-3.5">
          <Eyebrow muted>Submitted invoices · from the portal</Eyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {subInvoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-2 border-t border-rule-soft pt-2 first:border-t-0 first:pt-0"
              >
                <span className="tabular-nums text-body text-ink">
                  {usd(inv.amount)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink-2">
                    {inv.note || "Final invoice"}
                  </div>
                  <div className="text-meta text-ink-3">
                    {inv.when}
                    {inv.projectName ? ` · ${inv.projectName}` : ""}
                  </div>
                </div>
                <Chip kind={SUB_INVOICE_CHIP[inv.status]} dot>
                  {inv.status}
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      )}

      {subLogs.length > 0 && (
        <Card className="p-3.5">
          <Eyebrow muted>Daily logs · from the portal</Eyebrow>
          <div className="mt-2 flex flex-col gap-2.5">
            {subLogs.map((l) => (
              <div key={l.id} className="border-l-2 border-rule pl-2.5">
                <div className="text-label font-medium text-ink-3">
                  {l.when}
                  {l.hasPhoto ? " · 📷" : ""}
                  {l.projectName ? ` · ${l.projectName}` : ""}
                </div>
                {l.body && (
                  <p className="mt-0.5 text-body leading-snug text-ink">
                    {l.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );

  // ── Paperwork panel — compliance checklist + real uploaded documents ────────
  const paperworkPanel = (
    <div className="flex max-w-[520px] flex-col gap-3.5">
      <Card className="p-3.5">
        <Eyebrow muted>Paperwork on file</Eyebrow>
        <div className="mt-2.5 flex flex-col gap-2">
          {sub.paperwork.map((p) => (
            <div
              key={p.label}
              className="flex items-center gap-2 border-t border-rule-soft pt-2 first:border-t-0 first:pt-0"
            >
              <Check
                className={`size-3.5 flex-none ${p.ok ? "text-money" : "invisible"}`}
                strokeWidth={2}
              />
              <span className="flex-1 text-body text-ink">{p.label}</span>
              <span
                className={`text-meta ${p.ok ? "text-ink-3" : "text-flag"}`}
              >
                {p.ok ? p.value : `${p.value} · needed`}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {subDocs.length > 0 && (
        <Card className="p-3.5">
          <Eyebrow muted>Uploaded documents · from the portal</Eyebrow>
          <div className="mt-2.5 flex flex-col gap-2">
            {subDocs.map((d) => {
              const chip = docStatusChip(d);
              const reviewable =
                d.docType === "coi" &&
                (d.status === "under_review" || d.status === "received");
              return (
                <div
                  key={d.id}
                  className="border-t border-rule-soft pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-body text-ink">
                      {SUB_DOC_LABEL[d.docType] ?? "Document"}
                    </span>
                    {chip && (
                      <Chip kind={chip.kind} dot>
                        {chip.label}
                      </Chip>
                    )}
                    {d.expiresLabel && (
                      <Chip kind="ghost">exp {d.expiresLabel}</Chip>
                    )}
                    {d.fileId ? (
                      <a
                        href={`/api/files/${d.fileId}`}
                        target="_blank"
                        rel="noopener"
                        className="text-meta font-semibold text-accent-2 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-meta text-ink-3">{d.when}</span>
                    )}
                  </div>
                  {d.status === "rejected" && d.reviewNote && (
                    <div className="mt-0.5 text-meta text-ink-3">
                      {d.reviewNote}
                    </div>
                  )}
                  {reviewable &&
                    (isOwner ? (
                      <>
                        <div className="mt-0.5 text-meta text-ink-3">
                          {d.expiresAt
                            ? "The date is what the sub typed. Check the certificate, then accept it with the date it shows."
                            : "Check the certificate, then accept it with the expiry date it shows."}
                        </div>
                        <SubDocReview
                          slug={slug}
                          documentId={d.id}
                          typedExpiry={d.expiresAt}
                        />
                      </>
                    ) : (
                      <div className="mt-0.5 text-meta text-ink-3">
                        Not current until Joe accepts it.
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );

  // ── Pricing panel — rate card + 1099 note ──────────────────────────────────
  const pricingPanel = (
    <div className="grid max-w-[680px] grid-cols-1 gap-3.5 @xl/page:grid-cols-2">
      <Card className="p-3.5">
        <Eyebrow muted>Rate</Eyebrow>
        <div
          className={`mt-1 text-ink ${sub.rate.amount ? "font-serif text-kpi" : "text-body text-ink-3"}`}
        >
          {sub.rate.amount || "Not recorded"}
          {sub.rate.unit && (
            <span className="text-heading text-ink-3">{sub.rate.unit}</span>
          )}
        </div>
        {sub.rate.note && (
          <div className="mt-2 text-body text-ink-3">{sub.rate.note}</div>
        )}
      </Card>
      {sub.taxNote && (
        <Card kind="ai" className="p-3">
          <div className="flex items-start gap-2">
            <Sparkles
              className="mt-0.5 size-3.5 flex-none text-ai-2"
              strokeWidth={1.5}
            />
            <span className="text-body leading-snug text-ai-2">
              {sub.taxNote}
            </span>
          </div>
        </Card>
      )}
    </div>
  );

  // ── Notes panel — editable owner notes + AI summary ────────────────────────
  const notesPanel = (
    <div className="flex max-w-[680px] flex-col gap-3.5">
      <SubNotes slug={sub.slug} notes={sub.notes} />
      <div>
        <Eyebrow muted>AI summary</Eyebrow>
        <SubSummary slug={slug} />
      </div>
    </div>
  );

  const panels: Record<string, ReactNode> = {
    Overview: overview,
    Jobs: jobsPanel,
    Paperwork: paperworkPanel,
    ...(showMoney ? { Pricing: pricingPanel } : {}),
    Notes: notesPanel,
  };

  return (
    <Shell breadcrumb={`SUBS › ${sub.name.toUpperCase()}`}>
      <div className="mx-auto max-w-[1100px] px-4 pb-14 pt-6 @2xl/page:px-7">
        <PageHeader
          variant="record"
          title={sub.name}
          badge={
            <div className="flex flex-wrap gap-2">
              {sub.archived && <Chip>Archived</Chip>}
              <Chip
                kind={
                  paperwork.coiStatus === "current"
                    ? "ok"
                    : paperwork.coiStatus === "expiring"
                      ? "warn"
                      : "flag"
                }
              >
                {paperwork.coiStatus === "current"
                  ? "COI current"
                  : paperwork.coiStatus === "expiring"
                    ? "COI expiring"
                    : paperwork.coiStatus === "expired"
                      ? "COI expired"
                      : "COI missing"}
              </Chip>
              <Chip kind={sub.w9 === "missing" ? "flag" : "ok"}>
                {sub.w9 === "missing" ? "W-9 missing" : "W-9 on file"}
              </Chip>
              {coiToReview && <Chip kind="info">COI to review</Chip>}
            </div>
          }
          meta={
            <>
              <span className="block text-body text-ink-2">{sub.rawTrade}</span>
              <span className="break-words">{sub.contact}</span>
            </>
          }
          actions={
            <>
              {sub.phone && (
                <a
                  href={`tel:${sub.phone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rule bg-card px-3 text-body font-semibold hover:bg-hover"
                >
                  <Phone className="size-3.5" />
                  Call
                </a>
              )}
              {!sub.archived && (
                <AssignToJobButton
                  subSlug={slug}
                  defaultRole={sub.rawTrade}
                  projects={projects.map((p) => ({
                    slug: p.slug,
                    name: p.name,
                  }))}
                />
              )}
              <DirectoryRecordMenu
                table="subs"
                slug={slug}
                name={sub.name}
                trade={sub.rawTrade}
                email={sub.email ?? ""}
                phone={sub.phone ?? ""}
                rate={showMoney ? sub.rawRate : undefined}
                archived={sub.archived}
              />
            </>
          }
        />
        {sub.archived && (
          <p className="mt-4 rounded-md bg-neutral-soft px-3 py-2 text-body text-ink-2">
            Archived · assignments and paperwork are preserved. Use the actions
            menu to restore this sub.
          </p>
        )}

        <SubTabs panels={panels} jobsCount={sub.assignmentCount} />
      </div>
    </Shell>
  );
}
